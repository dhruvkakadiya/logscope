#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(sensor_drv, LOG_LEVEL_DBG);

static int read_count = 0;

void simulate_sensor_activity(void)
{
	read_count++;

	LOG_DBG("Starting sensor read cycle %d", read_count);
	LOG_INF("Temperature: %d.%02d C", 22 + (read_count % 5),
		(read_count * 17) % 100);
	LOG_INF("Humidity: %d%%", 45 + (read_count % 20));

	if (read_count % 7 == 0) {
		LOG_WRN("Sensor read took longer than expected: %d ms",
			150 + (read_count * 3) % 200);
	}

	if (read_count % 13 == 0) {
		LOG_ERR("Sensor CRC mismatch on read %d (expected 0x%04x, got 0x%04x)",
			read_count, 0xABCD, 0xABCE);
	}
}
