/*
 * LogScope Bluetooth LE HCI Demo — nRF54L15 DK (Stress Test)
 *
 * Rich logging demo with:
 * - Multiple simulated modules (sensor, flash, crypto, ble_mgr)
 * - All severity levels cycling at different intervals
 * - Custom GATT service (read/write/notify)
 * - Burst mode (write 0x01 to command characteristic)
 * - Sensor notifications every 2s when subscribed
 * - HCI traces on RTT Channel 1
 *
 * Build:
 *   source samples/nrf54l15-ble-hci-demo/setup-env.sh
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-ble-hci-demo --build-dir build-hci -p
 *   west flash --build-dir build-hci
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/sys/byteorder.h>

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* ── Custom GATT Service UUIDs ──────────────────────────────── */

/* Service: 12345678-1234-5678-1234-56789abcdef0 */
static struct bt_uuid_128 logscope_svc_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef0));

/* Read characteristic: ...def1 */
static struct bt_uuid_128 info_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef1));

/* Write characteristic (command): ...def2 */
static struct bt_uuid_128 cmd_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef2));

/* Notify characteristic (sensor data): ...def3 */
static struct bt_uuid_128 sensor_char_uuid = BT_UUID_INIT_128(
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef3));

/* ── State ──────────────────────────────────────────────────── */
static struct bt_conn *current_conn;
static bool notify_enabled;
static uint32_t sensor_value;
static int burst_remaining;

/* ── Advertising data ───────────────────────────────────────── */
static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL,
		BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef0)),
};

static const struct bt_data sd[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME,
		sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

/* ── GATT: Read characteristic (device info) ────────────────── */
static ssize_t read_info(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			 void *buf, uint16_t len, uint16_t offset)
{
	const char *info = "LogScope Demo v2 | nRF54L15 DK | Novel Bits";

	LOG_DBG("[ble_mgr] GATT read: info characteristic");
	return bt_gatt_attr_read(conn, attr, buf, len, offset, info, strlen(info));
}

/* ── GATT: Write characteristic (command) ───────────────────── */
static ssize_t write_cmd(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			 const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
	if (len < 1) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
	}

	uint8_t cmd = ((const uint8_t *)buf)[0];

	switch (cmd) {
	case 0x01:
		LOG_WRN("Burst mode triggered via GATT write (50 messages)");
		burst_remaining = 50;
		break;
	case 0x02:
		LOG_INF("Reset sensor counter via GATT write");
		sensor_value = 0;
		break;
	case 0x03:
		LOG_INF("[flash_mgr] Manual flash erase triggered via GATT");
		LOG_DBG("[flash_mgr] Erasing sector 0x00080000...");
		k_sleep(K_MSEC(5));
		LOG_INF("[flash_mgr] Flash erase complete (sector 0x00080000)");
		break;
	default:
		LOG_WRN("Unknown command byte: 0x%02x", cmd);
		break;
	}

	return len;
}

/* ── GATT: Notify characteristic (sensor data) ──────────────── */
static void sensor_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
	notify_enabled = (value == BT_GATT_CCC_NOTIFY);
	LOG_INF("[ble_mgr] Sensor notifications %s",
		notify_enabled ? "enabled" : "disabled");
}

/* ── GATT Service Registration ──────────────────────────────── */
BT_GATT_SERVICE_DEFINE(logscope_svc,
	BT_GATT_PRIMARY_SERVICE(&logscope_svc_uuid),

	/* Info characteristic (read) */
	BT_GATT_CHARACTERISTIC(&info_char_uuid.uuid,
		BT_GATT_CHRC_READ,
		BT_GATT_PERM_READ,
		read_info, NULL, NULL),

	/* Command characteristic (write) */
	BT_GATT_CHARACTERISTIC(&cmd_char_uuid.uuid,
		BT_GATT_CHRC_WRITE,
		BT_GATT_PERM_WRITE,
		NULL, write_cmd, NULL),

	/* Sensor characteristic (notify) */
	BT_GATT_CHARACTERISTIC(&sensor_char_uuid.uuid,
		BT_GATT_CHRC_NOTIFY,
		BT_GATT_PERM_NONE,
		NULL, NULL, NULL),
	BT_GATT_CCC(sensor_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
);

/* ── Connection callbacks ───────────────────────────────────── */
static void connected(struct bt_conn *conn, uint8_t err)
{
	char addr[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));

	if (err) {
		LOG_ERR("Connection failed (addr %s, err 0x%02x %s)",
			addr, err, bt_hci_err_to_str(err));
		return;
	}

	LOG_INF("Connected: %s", addr);
	LOG_DBG("[ble_mgr] Connection established, requesting PHY update");
	current_conn = bt_conn_ref(conn);
	notify_enabled = false;
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	char addr[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));
	LOG_INF("Disconnected: %s (reason 0x%02x %s)",
		addr, reason, bt_hci_err_to_str(reason));

	if (current_conn) {
		bt_conn_unref(current_conn);
		current_conn = NULL;
	}
	notify_enabled = false;

	int ret = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
				  sd, ARRAY_SIZE(sd));
	if (ret) {
		LOG_ERR("Re-advertising failed (err %d)", ret);
	} else {
		LOG_INF("Re-advertising started");
	}
}

static void le_param_updated(struct bt_conn *conn, uint16_t interval,
			     uint16_t latency, uint16_t timeout)
{
	LOG_INF("[ble_mgr] Connection params updated: interval %d (%.2f ms), latency %d, timeout %d",
		interval, interval * 1.25, latency, timeout);
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.le_param_updated = le_param_updated,
};

/* ── Simulated module logging ───────────────────────────────── */

static void log_sensor_reading(int cycle)
{
	sensor_value += 17 + (cycle % 7);
	int16_t temp = 2200 + (cycle % 50) - 25;  /* 22.00C +/- noise */
	uint16_t humidity = 4500 + (cycle % 100);  /* 45.00% +/- noise */
	int16_t accel_x = (cycle * 3) % 200 - 100;
	int16_t accel_y = (cycle * 7) % 200 - 100;
	int16_t accel_z = 980 + (cycle % 20) - 10;

	LOG_DBG("[sensor_drv] Temp: %d.%02dC, Humidity: %d.%02d%%, Accel: (%d, %d, %d) mg",
		temp / 100, temp % 100, humidity / 100, humidity % 100,
		accel_x, accel_y, accel_z);
}

static void log_flash_activity(int cycle)
{
	uint32_t addr = 0x00080000 + (cycle * 256) % 0x10000;

	if (cycle % 15 == 0) {
		LOG_WRN("[flash_mgr] Flash wear level high on sector 0x%08x (writes: %d)",
			addr & 0xFFFF0000, 8500 + cycle);
	}
	if (cycle % 30 == 0) {
		LOG_ERR("[flash_mgr] Flash write failed at 0x%08x (timeout after 50ms)", addr);
	}
	if (cycle % 5 == 0) {
		LOG_DBG("[flash_mgr] Write 256B to 0x%08x (queue depth: %d)", addr, cycle % 8);
	}
}

static void log_crypto_activity(int cycle)
{
	if (cycle % 4 == 0) {
		LOG_DBG("[crypto_mgr] AES-128-CCM encrypt: 64B payload, nonce=0x%08x", cycle * 0x1234);
	}
	if (cycle % 30 == 0) {
		LOG_ERR("[crypto_mgr] MAC verification failed (expected: 0x%08x, got: 0x%08x)",
			0xDEADBEEF, 0xBADC0FFE);
	}
	if (cycle % 15 == 0) {
		LOG_WRN("[crypto_mgr] Key rotation due: current key age %d hours", 12 + cycle / 15);
	}
}

static void log_ble_manager(int cycle)
{
	if (cycle % 10 == 0 && current_conn) {
		LOG_DBG("[ble_mgr] RSSI check scheduled for connection 0x0040");
	}
	if (cycle % 20 == 0) {
		LOG_INF("[ble_mgr] Advertising data updated (TX power: %d dBm)", -4 + (cycle % 3));
	}
}

static void send_sensor_notification(void)
{
	if (!current_conn || !notify_enabled) {
		return;
	}

	uint8_t data[4];
	sys_put_le32(sensor_value, data);

	int err = bt_gatt_notify(current_conn, &logscope_svc.attrs[7], data, sizeof(data));
	if (err) {
		LOG_WRN("[ble_mgr] Sensor notification failed (err %d)", err);
	} else {
		LOG_DBG("[ble_mgr] Sensor notification sent: value=%u", sensor_value);
	}
}

static void run_burst(void)
{
	static const char *modules[] = {"sensor_drv", "ble_mgr", "flash_mgr", "crypto_mgr", "app"};
	int idx = burst_remaining % 5;

	switch (burst_remaining % 4) {
	case 0:
		LOG_ERR("[%s] BURST #%d: Simulated critical error (code 0x%02x)",
			modules[idx], 50 - burst_remaining, burst_remaining);
		break;
	case 1:
		LOG_WRN("[%s] BURST #%d: Simulated warning condition",
			modules[idx], 50 - burst_remaining);
		break;
	case 2:
		LOG_INF("[%s] BURST #%d: Simulated state change event",
			modules[idx], 50 - burst_remaining);
		break;
	case 3:
		LOG_DBG("[%s] BURST #%d: Simulated verbose trace data (0x%08x)",
			modules[idx], 50 - burst_remaining, burst_remaining * 0xABCD);
		break;
	}

	burst_remaining--;
	if (burst_remaining == 0) {
		LOG_INF("Burst mode complete (50 messages sent)");
	}
}

/* ── Main ───────────────────────────────────────────────────── */
int main(void)
{
	int err;

	LOG_INF("LogScope Bluetooth LE HCI Demo starting (stress test)");
	LOG_INF("HCI traces streaming to RTT Channel 1");
	LOG_INF("[sensor_drv] Initializing temperature + humidity + accelerometer");
	LOG_INF("[flash_mgr] Flash subsystem ready (NOR, 1MB, sector size 4KB)");
	LOG_INF("[crypto_mgr] Hardware crypto engine initialized (AES-128-CCM)");

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("Bluetooth init failed (err %d)", err);
		return 0;
	}

	LOG_INF("Bluetooth initialized");

	err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
			      sd, ARRAY_SIZE(sd));
	if (err) {
		LOG_ERR("Advertising failed to start (err %d)", err);
		return 0;
	}

	LOG_INF("Advertising as \"%s\"", CONFIG_BT_DEVICE_NAME);
	LOG_INF("GATT service registered: read + write + notify characteristics");

	int cycle = 0;

	while (1) {
		cycle++;

		/* Burst mode: rapid-fire logging */
		if (burst_remaining > 0) {
			run_burst();
			k_sleep(K_MSEC(20));
			continue;
		}

		/* Sensor readings every 2 seconds */
		if (cycle % 2 == 0) {
			log_sensor_reading(cycle);
			send_sensor_notification();
		}

		/* Flash activity every cycle (mix of DBG/WRN/ERR at different rates) */
		log_flash_activity(cycle);

		/* Crypto activity */
		log_crypto_activity(cycle);

		/* Bluetooth LE manager activity */
		log_ble_manager(cycle);

		/* Heartbeat every 5 seconds */
		if (cycle % 5 == 0) {
			if (current_conn) {
				LOG_INF("Heartbeat %d: connected, uptime %lld ms",
					cycle, k_uptime_get());
			} else {
				LOG_INF("Heartbeat %d: advertising, uptime %lld ms",
					cycle, k_uptime_get());
			}
		}

		k_sleep(K_SECONDS(1));
	}

	return 0;
}
