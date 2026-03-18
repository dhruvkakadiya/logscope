/*
 * LogScope BLE HCI Demo — nRF54L15 DK
 *
 * Advertises as "LogScope Demo", accepts connections, and generates
 * real Bluetooth LE HCI traffic. With CONFIG_BT_DEBUG_MONITOR_RTT=y,
 * all HCI commands and events are streamed to RTT Channel 1 for
 * LogScope to display interleaved with application logs.
 *
 * Build:
 *   source samples/nrf54l15-ble-hci-demo/setup-env.sh
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-ble-hci-demo --build-dir build-hci
 *   west flash --build-dir build-hci
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/bluetooth/gatt.h>

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* Advertising data */
static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA_BYTES(BT_DATA_UUID16_ALL, BT_UUID_16_ENCODE(BT_UUID_DIS_VAL)),
};

static const struct bt_data sd[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME,
		sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

/* Connection tracking */
static struct bt_conn *current_conn;

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
	current_conn = bt_conn_ref(conn);
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

	/* Restart advertising after disconnect */
	int err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
				  sd, ARRAY_SIZE(sd));
	if (err) {
		LOG_ERR("Re-advertising failed (err %d)", err);
	} else {
		LOG_INF("Re-advertising started");
	}
}

static void le_param_updated(struct bt_conn *conn, uint16_t interval,
			     uint16_t latency, uint16_t timeout)
{
	LOG_INF("Connection params updated: interval %d, latency %d, timeout %d",
		interval, latency, timeout);
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.le_param_updated = le_param_updated,
};

int main(void)
{
	int err;

	LOG_INF("LogScope BLE HCI Demo starting");
	LOG_INF("HCI traces streaming to RTT Channel 1");

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

	/* Heartbeat loop */
	int cycle = 0;
	while (1) {
		cycle++;

		if (cycle % 10 == 0) {
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
