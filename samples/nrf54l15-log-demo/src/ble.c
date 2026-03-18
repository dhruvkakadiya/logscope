#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(ble_conn, LOG_LEVEL_DBG);

static bool connected = false;
static int adv_count = 0;

void simulate_ble_activity(void)
{
	adv_count++;

	if (!connected && adv_count % 5 == 0) {
		connected = true;
		LOG_INF("Connected to AA:BB:CC:DD:EE:%02X (interval: %d ms)",
			adv_count % 256, 30 + (adv_count % 20) * 5);
		LOG_DBG("MTU exchange: requesting 247 bytes");
		LOG_INF("MTU updated to 247");
		LOG_DBG("PHY update: requesting 2M PHY");
		LOG_INF("PHY updated to 2M");
	} else if (connected && adv_count % 11 == 0) {
		LOG_WRN("Connection timeout — supervision expired");
		LOG_INF("Disconnected (reason: 0x08)");
		connected = false;
	} else if (connected) {
		LOG_DBG("Notification sent: %d bytes", 20 + (adv_count % 200));
	} else {
		LOG_DBG("Advertising: interval %d ms", 100 + (adv_count % 50) * 10);
	}
}
