# Deep HCI Parsing — v0.2 Design Spec

## Overview

Add expandable HCI rows to LogScope's log viewer. Clicking an HCI row expands it in-place to show decoded packet fields and an optional raw hex dump. This transforms LogScope from showing "TX CMD LE Set PHY (7B)" to showing every parameter decoded with human-readable labels and values.

## UX Design

### Three Detail Levels (Inline Expand)

1. **Collapsed (default)**: One-liner with key decoded params inline
   - `RX EVT LE Connection Complete (addr: 74:A4:90:C7:D3:27, interval: 24, latency: 0)`
   - Clickable — cursor changes to pointer, subtle expand indicator (▶)

2. **Expanded (click)**: Structured key-value field table below the summary line
   - Background slightly tinted (purple at 6% opacity for HCI)
   - Fields in a two-column layout: field name (dimmed) | value (bright)
   - Important values colored (addresses in blue, errors in red, PHY values highlighted)
   - Expand indicator changes to (▼)

3. **Raw hex (toggle inside expanded)**: Collapsible hex dump of raw packet bytes
   - "▶ Show raw hex (N bytes)" toggle at bottom of expanded section
   - Classic hex dump format: offset | hex bytes | ASCII

### Interaction Rules

- Click collapsed row → expand
- Click expanded row header → collapse
- Only one row expanded at a time (clicking a new row collapses the previous)
- Keyboard: Enter/Space to toggle when row is focused
- Right-click on any field → copy value to clipboard

### Collapsed Row Enhancement

Currently HCI rows show: `TX CMD LE Set PHY (7B)`. After deep parsing, collapsed rows include key decoded parameters inline:

| Packet Type | Collapsed Summary Example |
|-------------|--------------------------|
| HCI Command | `TX CMD LE Create Connection (addr: 74:A4:90:C7:D3:27, interval: 24-40)` |
| HCI Event | `RX EVT LE Connection Complete (handle: 0x0040, status: Success)` |
| Command Complete | `RX EVT Command Complete: LE Set PHY (status: Success)` |
| Command Status | `RX EVT Command Status: LE Create Connection (status: 0x00)` |
| ACL TX/RX | `TX ACL handle:0x0040 L2CAP→ATT Write Request (handle: 0x0012)` |
| Disconnection | `RX EVT Disconnection Complete (handle: 0x0040, reason: Remote User Terminated)` |

## Architecture

### New Files

- `src/parser/hci-decoders.ts` — Pure functions that decode raw bytes into structured fields
  - `decodeCommand(opcode: number, payload: Buffer): DecodedPacket`
  - `decodeEvent(eventCode: number, payload: Buffer): DecodedPacket`
  - `decodeAcl(payload: Buffer): DecodedPacket`
  - Each returns `{ summary: string, fields: DecodedField[], layers?: DecodedLayer[] }`

- `src/parser/hci-field-types.ts` — Value formatters and lookup tables
  - Address formatting, PHY names, error code descriptions
  - Reuses Bluetooth Spec MCP for accurate definitions during development

### Modified Files

- `src/parser/hci-parser.ts` — Call decoders, store results in `LogEntry.metadata.decoded`
- `src/parser/types.ts` — Add `DecodedPacket`, `DecodedField`, `DecodedLayer` types
- `src/ui/webview-provider.ts` — Include `raw` and `decoded` in serialized HCI entries
- `src/ui/webview/main.ts` — Expandable row creation, click handlers, hex dump rendering
- `src/ui/webview/styles.css` — Expanded row styling, field table, hex dump

### Data Types

```typescript
interface DecodedField {
  name: string;      // "Connection Handle", "TX PHY"
  value: string;     // "0x0040", "2M"
  color?: string;    // optional highlight color
}

interface DecodedLayer {
  name: string;      // "L2CAP", "ATT", "SMP"
  fields: DecodedField[];
}

interface DecodedPacket {
  summary: string;           // Key params for collapsed one-liner
  fields: DecodedField[];    // Top-level HCI fields
  layers?: DecodedLayer[];   // Protocol layers (for ACL: L2CAP → ATT)
}
```

### Serialized Entry Change

HCI entries get two additional optional fields over IPC:

```typescript
interface SerializedEntry {
  timestamp: number;
  severity: string;
  module: string;
  message: string;
  source: string;
  // New: only present for HCI entries
  raw?: number[];
  decoded?: DecodedPacket;
}
```

### Design Philosophy

**LogScope is a quick-look debugging tool, not a protocol analyzer.** Show developers what they need to understand what's happening — status, handles, addresses, connection params, GATT operations. For deep packet forensics, users export to Wireshark via pcap.

- **Essential fields only** — developer-relevant params with human-readable conversions (e.g., interval 24 = 30ms). Skip spec internals like clock accuracy, subevent codes.
- **Flat ACL decoding** — jump straight to ATT/GATT operation. Show "Write Request to handle 0x0012" not L2CAP framing details.
- **Errors stand out** — non-zero status codes highlighted in red with human-readable reason.

### Decoding Scope (v0.2)

#### HCI Commands — Essential Parameters
- LE Create Connection (0x200D): peer address, interval range, latency, timeout
- LE Set Advertising Parameters (0x2006): interval, type, own/peer address
- LE Set Advertising Data (0x2008): AD structures (flags, name, UUIDs)
- LE Set PHY (0x2032): TX/RX PHY, coding preference
- LE Read Remote Features (0x2016): connection handle
- Disconnect (0x0406): handle, reason

#### HCI Events — Essential Parameters
- Command Complete (0x0E): return opcode, status
- Command Status (0x0F): status, opcode
- LE Connection Complete (0x01): status, handle, role, address, interval, latency, timeout
- LE Advertising Report (0x02): address, RSSI, AD data
- LE PHY Update Complete (0x0C): TX/RX PHY
- Disconnection Complete (0x05): handle, reason
- LE Enhanced Connection Complete (0x0A): status, handle, role, address, params
- LE Data Length Change (0x07): max TX/RX octets/time

#### ACL — Flat Decode to ATT/GATT
- Skip L2CAP details (just note CID for context)
- ATT opcodes: Read Request/Response, Write Request/Command, Notifications, Find By Type, Exchange MTU
- Show attribute handles, UUIDs, MTU values
- For SMP: show pairing method, key distribution

#### Status Codes
- All HCI error codes decoded to human-readable strings
- Non-zero status highlighted in red

### Performance

- Decoding happens in the extension host (Node.js), not the webview
- Decoded results cached in LogEntry.metadata — no re-parsing on expand
- Raw bytes sent as `number[]` (small: typically 5-50 bytes per HCI packet)
- Only HCI entries carry the extra payload — regular log entries unchanged

## Testing

- Unit tests for each decoder function with known packet payloads
- Test with real capture data from the BLE HCI demo firmware
- Verify collapsed summaries are accurate for all supported packet types
- Verify expand/collapse interaction doesn't break scrolling or filtering
