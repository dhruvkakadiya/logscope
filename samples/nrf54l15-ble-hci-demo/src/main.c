/*
 * LogScope Bluetooth LE HCI Demo — nRF54L15 DK (Stress Test)
 *
 * Rich logging demo with proper Zephyr log modules:
 * - app (main), sensor_drv, flash_mgr, crypto_mgr, ble_mgr
 * - All severity levels cycling at different intervals
 * - Custom GATT service (read/write/notify)
 * - Burst mode (write 0x01 to command characteristic)
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
#include "modules.h"

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* Shared burst state (accessed by ble_mgr.c) */
int burst_remaining;

/* Forward declarations from ble_mgr.c */
extern struct bt_conn *ble_mgr_get_conn(void);
extern void ble_mgr_set_conn(struct bt_conn *conn);

/* ── Advertising data ───────────────────────────────────────── */
/* 128-bit UUID as byte array for advertising data */
static const uint8_t logscope_svc_uuid_ad[] = {
	BT_UUID_128_ENCODE(0x12345678, 0x1234, 0x5678, 0x1234, 0x56789abcdef0)
};

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA(BT_DATA_UUID128_ALL, logscope_svc_uuid_ad, sizeof(logscope_svc_uuid_ad)),
};

static const struct bt_data sd[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME,
		sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

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
	ble_mgr_set_conn(conn);
	ble_mgr_on_connected();
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	char addr[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));
	LOG_INF("Disconnected: %s (reason 0x%02x %s)",
		addr, reason, bt_hci_err_to_str(reason));

	ble_mgr_set_conn(NULL);
	ble_mgr_on_disconnected();

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
	LOG_INF("Connection params updated: interval %d (%.2f ms), latency %d, timeout %d",
		interval, interval * 1.25, latency, timeout);
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.le_param_updated = le_param_updated,
};

/* ── Burst mode ─────────────────────────────────────────────── */
void burst_run(int *remaining)
{
	static const char *labels[] = {"sensor", "ble", "flash", "crypto", "app"};
	int idx = *remaining % 5;

	switch (*remaining % 4) {
	case 0:
		LOG_ERR("BURST #%d [%s]: Simulated critical error (code 0x%02x)",
			50 - *remaining, labels[idx], *remaining);
		break;
	case 1:
		LOG_WRN("BURST #%d [%s]: Simulated warning condition",
			50 - *remaining, labels[idx]);
		break;
	case 2:
		LOG_INF("BURST #%d [%s]: Simulated state change event",
			50 - *remaining, labels[idx]);
		break;
	case 3:
		LOG_DBG("BURST #%d [%s]: Simulated verbose trace data (0x%08x)",
			50 - *remaining, labels[idx], *remaining * 0xABCD);
		break;
	}

	(*remaining)--;
	if (*remaining == 0) {
		LOG_INF("Burst mode complete (50 messages sent)");
	}
}

/* ── Main ───────────────────────────────────────────────────── */
int main(void)
{
	int err;

	LOG_INF("LogScope Bluetooth LE HCI Demo starting (stress test)");
	LOG_INF("HCI traces streaming to RTT Channel 1");

	/* Initialize modules */
	sensor_drv_init();
	flash_mgr_init();
	crypto_mgr_init();

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
	ble_mgr_init();

	int cycle = 0;

	while (1) {
		cycle++;

		/* Burst mode: rapid-fire logging */
		if (burst_remaining > 0) {
			burst_run(&burst_remaining);
			k_sleep(K_MSEC(20));
			continue;
		}

		/* Sensor readings every 2 seconds */
		if (cycle % 2 == 0) {
			sensor_drv_read(cycle);
			ble_mgr_send_notification(sensor_drv_get_value());
		}

		/* Flash activity */
		flash_mgr_tick(cycle);

		/* Crypto activity */
		crypto_mgr_tick(cycle);

		/* Bluetooth LE manager activity */
		ble_mgr_tick(cycle);

		/* Heartbeat every 5 seconds */
		if (cycle % 5 == 0) {
			if (ble_mgr_get_conn()) {
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
