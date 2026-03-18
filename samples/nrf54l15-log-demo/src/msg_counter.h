#ifndef MSG_COUNTER_H
#define MSG_COUNTER_H

#include <zephyr/sys/atomic.h>

/* Global message sequence number — incremented before each LOG_* call.
 * Compare the highest seq seen on UART vs RTT to measure dropped messages. */
extern atomic_t msg_seq;

/* Wrapper macros that prepend [seq:N] to every log message */
#define SEQ_LOG_DBG(fmt, ...) LOG_DBG("[seq:%d] " fmt, (int)atomic_inc(&msg_seq), ##__VA_ARGS__)
#define SEQ_LOG_INF(fmt, ...) LOG_INF("[seq:%d] " fmt, (int)atomic_inc(&msg_seq), ##__VA_ARGS__)
#define SEQ_LOG_WRN(fmt, ...) LOG_WRN("[seq:%d] " fmt, (int)atomic_inc(&msg_seq), ##__VA_ARGS__)
#define SEQ_LOG_ERR(fmt, ...) LOG_ERR("[seq:%d] " fmt, (int)atomic_inc(&msg_seq), ##__VA_ARGS__)

#endif
