# Zephyr BT Monitor Protocol — Binary Packet Format

## Kconfig Options

```
CONFIG_BT_DEBUG_MONITOR_RTT=y           # Send HCI over RTT
CONFIG_USE_SEGGER_RTT=y                 # Required
CONFIG_SEGGER_RTT_MAX_NUM_UP_BUFFERS=2  # Must be >= 2
```

RTT-specific:
- `CONFIG_BT_DEBUG_MONITOR_RTT_BUFFER=1` — RTT up-buffer index (default 1)
- `CONFIG_BT_DEBUG_MONITOR_RTT_BUFFER_NAME="btmonitor"` — buffer name
- `CONFIG_BT_DEBUG_MONITOR_RTT_BUFFER_SIZE=1024` — buffer size
- Mode: `SEGGER_RTT_MODE_NO_BLOCK_SKIP` (silent drop on full)

## Packet Wire Format

No sync/framing bytes. Parse sequentially using data_len.

```
Offset  Size  Field      Description
------  ----  ---------  -----------
0       2     data_len   LE16: bytes after this field = 4 + hdr_len + payload_len
2       2     opcode     LE16: packet type
4       1     flags      Always 0x00
5       1     hdr_len    Length of extended header
6       N     ext[]      Extended header (N = hdr_len)
6+N     M     payload    Packet data (M = data_len - 4 - hdr_len)
```

## Opcodes

| Value | Name | Payload |
|-------|------|---------|
| 0 | NEW_INDEX | type(1) + bus(1) + bdaddr(6) + name(8) |
| 1 | DEL_INDEX | — |
| 2 | COMMAND_PKT | Raw HCI command (no H4 byte) |
| 3 | EVENT_PKT | Raw HCI event (no H4 byte) |
| 4 | ACL_TX_PKT | Raw ACL data TX |
| 5 | ACL_RX_PKT | Raw ACL data RX |
| 6 | SCO_TX_PKT | Raw SCO data TX |
| 7 | SCO_RX_PKT | Raw SCO data RX |
| 8 | OPEN_INDEX | — |
| 9 | CLOSE_INDEX | — |
| 12 | SYSTEM_NOTE | Null-terminated string |
| 13 | USER_LOGGING | priority(1) + ident_len(1) + ident + message |
| 18 | ISO_TX_PKT | Raw ISO data TX |
| 19 | ISO_RX_PKT | Raw ISO data RX |

## Extended Header

Always starts with 5-byte timestamp: type=8 + 4-byte LE timestamp at 100us resolution (1/10th ms).
Optionally followed by 2-byte drop counter entries.

## Timestamp

- Resolution: 100 microseconds (10000 Hz)
- Convert: `seconds = ts32 / 10000.0`
- Little-endian on ARM
- Wraps at ~119.3 hours

## Parser Notes

1. No framing — must parse sequentially; lost sync requires heuristic recovery
2. Payload size = `data_len - 4 - hdr_len`
3. First packets are typically NEW_INDEX then OPEN_INDEX
4. Protocol matches BlueZ btsnoop monitor format (BTSNOOP_FORMAT_MONITOR = 2001)
5. HCI payloads are raw (no H4 type byte prefix)
