#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include "msg_counter.h"

LOG_MODULE_REGISTER(flash_mgr, LOG_LEVEL_DBG);

static int write_count = 0;

void simulate_storage_activity(void)
{
	write_count++;

	if (write_count % 3 == 0) {
		SEQ_LOG_INF("Flash write: page 0x%05x, %d bytes",
			0x70000 + (write_count * 0x1000) % 0x10000,
			64 + (write_count * 7) % 192);
		SEQ_LOG_DBG("Write complete in %d us", 800 + (write_count * 13) % 400);
	}

	if (write_count % 10 == 0) {
		SEQ_LOG_INF("Flash GC: reclaimed %d bytes from sector %d",
			4096, write_count / 10);
	}

	if (write_count % 25 == 0) {
		SEQ_LOG_WRN("Flash wear level high on sector %d: %d/%d erase cycles",
			write_count / 25, 9500, 10000);
	}
}
