/*
 * DevScope Log Demo — nRF54L15 DK
 *
 * Generates log messages from multiple modules at all severity levels.
 * Connect DevScope to RTT (localhost:19021) to see structured output.
 *
 * Build:
 *   cd /Users/mafaneh/Projects/tools/devscope
 *   source samples/nrf54l15-log-demo/setup-env.sh
 *   west build -b nrf54l15dk/nrf54l15/cpuapp samples/nrf54l15-log-demo --build-dir build
 *   west flash --build-dir build
 *
 * DevScope connects to the RTT telnet server at localhost:19021.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(app, LOG_LEVEL_DBG);

/* Subsystem entry points (each in its own file with its own log module) */
void simulate_sensor_activity(void);
void simulate_ble_activity(void);
void simulate_storage_activity(void);

int main(void)
{
	LOG_INF("DevScope Log Demo started on nRF54L15 DK");
	LOG_INF("Connect DevScope to RTT at localhost:19021");
	LOG_DBG("Log level: DEBUG (all messages visible)");

	int cycle = 0;

	while (1) {
		cycle++;

		/* Main app heartbeat */
		if (cycle % 10 == 0) {
			LOG_INF("Heartbeat: cycle %d, uptime %lld ms",
				cycle, k_uptime_get());
		}

		/* Simulate subsystem activity at different rates */
		simulate_sensor_activity();

		if (cycle % 2 == 0) {
			simulate_ble_activity();
		}

		if (cycle % 3 == 0) {
			simulate_storage_activity();
		}

		k_sleep(K_SECONDS(1));
	}

	return 0;
}
