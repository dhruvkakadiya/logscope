# Deep HCI Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expandable HCI rows with decoded packet fields and raw hex dump to LogScope's log viewer.

**Architecture:** New decoder module (`hci-decoders.ts`) with pure functions that take raw bytes + opcode and return structured fields. HCI parser calls decoders, stores results in LogEntry metadata. Webview serialization includes raw bytes + decoded fields for HCI entries only. Webview renders expandable rows with click-to-expand field tables and hex dump toggle.

**Tech Stack:** TypeScript, VS Code WebView API, Jest for tests

**Spec:** `docs/superpowers/specs/2026-03-18-deep-hci-parsing-design.md`

---

### Task 1: Add types and HCI error code lookup

**Files:**
- Modify: `src/parser/types.ts`
- Create: `src/parser/hci-field-types.ts`
- Test: `test/parser/hci-field-types.test.ts`

- [ ] **Step 1: Add DecodedPacket types to types.ts**

Add after the `LogEntry` interface:

```typescript
export interface DecodedField {
  name: string;
  value: string;
  color?: string;
}

export interface DecodedPacket {
  summary: string;
  fields: DecodedField[];
}
```

- [ ] **Step 2: Create hci-field-types.ts with formatters and lookup tables**

Pure utility functions:
- `formatAddress(buf: Buffer, offset: number): string` — format 6-byte LE address as `XX:XX:XX:XX:XX:XX`
- `formatAddressType(type: number): string` — `0x00` → "Public", `0x01` → "Random"
- `formatPhyName(phy: number): string` — `1` → "1M", `2` → "2M", `3` → "Coded"
- `formatRole(role: number): string` — `0x00` → "Central", `0x01` → "Peripheral"
- `formatInterval(raw: number): string` — `24 (30.00 ms)` (multiply by 1.25)
- `formatTimeout(raw: number): string` — `72 (720 ms)` (multiply by 10)
- `hciErrorCode(code: number): string` — lookup table for ~30 common error codes (0x00=Success through 0x3E)
- `formatDisconnectReason(reason: number): string` — same table, different label context
- `attOpcodeName(opcode: number): string` — ATT opcode lookup (~15 common ones)

- [ ] **Step 3: Write tests for formatters**

Test key conversions: address formatting, interval math, error code lookup, PHY names.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/parser/hci-field-types.test.ts`

- [ ] **Step 5: Commit**

```
feat: add HCI field types, formatters, and error code lookup
```

---

### Task 2: Create HCI decoders for commands and events

**Files:**
- Create: `src/parser/hci-decoders.ts`
- Test: `test/parser/hci-decoders.test.ts`

- [ ] **Step 1: Create hci-decoders.ts with command decoders**

Export three main functions:
- `decodeCommand(cmdOpcode: number, payload: Buffer): DecodedPacket | null`
- `decodeEvent(eventCode: number, payload: Buffer): DecodedPacket | null`
- `decodeAcl(payload: Buffer): DecodedPacket | null`

Command decoders (payload starts at byte 3 — after opcode(2) + paramLen(1)):
- `0x0406` Disconnect: handle(2), reason(1)
- `0x200D` LE Create Connection: scanInterval(2), scanWindow(2), filterPolicy(1), peerAddrType(1), peerAddr(6), ownAddrType(1), connIntervalMin(2), connIntervalMax(2), latency(2), timeout(2)
- `0x2006` LE Set Advertising Parameters: advIntervalMin(2), advIntervalMax(2), advType(1), ownAddrType(1), peerAddrType(1), peerAddr(6)
- `0x2032` LE Set PHY: handle(2), allPhys(1), txPhy(1), rxPhy(1), phyOptions(2)

For unrecognized commands, return null (parser falls back to existing summary).

- [ ] **Step 2: Add event decoders**

Event decoders (payload starts at byte 2 — after eventCode(1) + paramLen(1)):
- `0x05` Disconnection Complete: status(1), handle(2), reason(1)
- `0x0E` Command Complete: numPackets(1), opcode(2), status(1) — use commandName() for opcode
- `0x0F` Command Status: status(1), numPackets(1), opcode(2)
- `0x3E/0x01` LE Connection Complete: status(1), handle(2), role(1), peerAddrType(1), peerAddr(6), interval(2), latency(2), timeout(2)
- `0x3E/0x02` LE Advertising Report: numReports(1), then per report: eventType(1), addrType(1), addr(6), dataLen(1), data(N), rssi(1)
- `0x3E/0x07` LE Data Length Change: handle(2), maxTxOctets(2), maxTxTime(2), maxRxOctets(2), maxRxTime(2)
- `0x3E/0x0A` LE Enhanced Connection Complete: same as Connection Complete + localRPA(6) + peerRPA(6)
- `0x3E/0x0C` LE PHY Update Complete: status(1), handle(2), txPhy(1), rxPhy(1)

For LE Meta events, check subevent byte at payload[2] (offset 0 within the LE Meta event parameters).

- [ ] **Step 3: Add flat ACL decoder**

ACL payload format: handle(2, lower 12 bits), PB+BC flags(upper 4 bits of first 2 bytes), dataLen(2), then L2CAP: length(2), CID(2), then if CID=0x0004 (ATT): attOpcode(1), then opcode-specific fields.

Decode flat to ATT:
- `0x02` Exchange MTU Request: clientMTU(2)
- `0x03` Exchange MTU Response: serverMTU(2)
- `0x04` Find Information Request: startHandle(2), endHandle(2)
- `0x08` Read By Type Request: startHandle(2), endHandle(2), uuid(2 or 16)
- `0x0A` Read Request: handle(2)
- `0x0B` Read Response: show data length
- `0x10` Find By Type Value Request: startHandle(2), endHandle(2), uuid(2), value
- `0x12` Write Request: handle(2), value (show first bytes)
- `0x1B` Handle Value Notification: handle(2), value (show first bytes)
- `0x52` Write Command: handle(2), value (show first bytes)

Summary format: `handle:0x0040 ATT Write Request (handle: 0x0012)`

- [ ] **Step 4: Write tests with real packet bytes**

Test each decoder with known packet payloads. Use hex strings from the Bluetooth spec examples or captured from the demo firmware.

- [ ] **Step 5: Run tests, verify pass**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/parser/hci-decoders.test.ts`

- [ ] **Step 6: Commit**

```
feat: add HCI command, event, and ACL decoders
```

---

### Task 3: Integrate decoders into HCI parser and serialization

**Files:**
- Modify: `src/parser/hci-parser.ts`
- Modify: `src/ui/webview-provider.ts`

- [ ] **Step 1: Call decoders in hci-parser.ts makeEntry()**

In the `makeEntry()` method, after building the basic message, call the appropriate decoder:
- For OP_COMMAND: `decoded = decodeCommand(cmdOpcode, payload)`
- For OP_EVENT: `decoded = decodeEvent(evtCode, payload)`
- For OP_ACL_TX/RX: `decoded = decodeAcl(payload)`

Store in metadata: `metadata.decoded = decoded`

If decoder returns a summary, use it to enhance the collapsed message line (replace the generic `(NB)` suffix with key params).

- [ ] **Step 2: Update webview-provider.ts addEntries() to include raw + decoded for HCI**

In the `addEntries()` method, when `e.source === "hci"`, include extra fields:

```typescript
const serialized: any = {
  timestamp: e.timestamp,
  severity: e.severity,
  module: e.module,
  message: e.message,
  source: e.source,
};
if (e.source === "hci") {
  if (e.raw) serialized.raw = Array.from(e.raw);
  if (e.metadata?.decoded) serialized.decoded = e.metadata.decoded;
}
this.pendingEntries.push(serialized);
```

- [ ] **Step 3: Build and verify no runtime errors**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`

- [ ] **Step 4: Commit**

```
feat: integrate HCI decoders into parser and serialization pipeline
```

---

### Task 4: Expandable HCI rows in the webview

**Files:**
- Modify: `src/ui/webview/main.ts`
- Modify: `src/ui/webview/styles.css`

- [ ] **Step 1: Update createRow() for HCI entries**

For HCI entries with decoded data:
- Add `tabindex="0"` for keyboard accessibility
- Add expand indicator `▶` at end of message
- Store decoded data and raw bytes on the row element
- Add click handler that toggles expansion

```typescript
if (entry.source === "hci" && entry.decoded) {
  row.classList.add("hci-expandable");
  row.setAttribute("tabindex", "0");
  // Append expand indicator
  const indicator = document.createElement("span");
  indicator.className = "expand-indicator";
  indicator.textContent = "\u25B6"; // ▶
  msg.appendChild(indicator);
  // Store data for expansion
  (row as any)._decoded = entry.decoded;
  (row as any)._raw = entry.raw;
}
```

- [ ] **Step 2: Add click handler for expand/collapse**

Single expanded row at a time. Click toggles a `.hci-detail` div below the row.

```typescript
timeline.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest(".hci-expandable");
  if (!row) return;
  // Collapse any currently expanded row
  const current = timeline.querySelector(".hci-detail");
  const currentRow = current?.previousElementSibling;
  if (current && currentRow !== row) {
    current.remove();
    currentRow?.querySelector(".expand-indicator")?.textContent = "\u25B6";
    currentRow?.classList.remove("expanded");
  }
  // Toggle this row
  if (row.classList.contains("expanded")) {
    row.classList.remove("expanded");
    row.nextElementSibling?.remove();
    row.querySelector(".expand-indicator")!.textContent = "\u25B6";
  } else {
    row.classList.add("expanded");
    row.querySelector(".expand-indicator")!.textContent = "\u25BC";
    const detail = buildDetailDiv((row as any)._decoded, (row as any)._raw);
    row.after(detail);
  }
});
```

- [ ] **Step 3: Build the detail div renderer**

```typescript
function buildDetailDiv(decoded: DecodedPacket, raw?: number[]): HTMLDivElement {
  const detail = document.createElement("div");
  detail.className = "hci-detail";
  // Field table
  const table = document.createElement("table");
  table.className = "hci-fields";
  for (const field of decoded.fields) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.className = "field-name";
    tdName.textContent = field.name;
    const tdValue = document.createElement("td");
    tdValue.className = "field-value";
    tdValue.textContent = field.value;
    if (field.color) tdValue.style.color = field.color;
    tr.appendChild(tdName);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  }
  detail.appendChild(table);
  // Raw hex toggle
  if (raw && raw.length > 0) {
    const hexToggle = document.createElement("div");
    hexToggle.className = "hex-toggle";
    hexToggle.textContent = `\u25B6 Show raw hex (${raw.length} bytes)`;
    const hexDump = document.createElement("pre");
    hexDump.className = "hex-dump hidden";
    hexDump.textContent = formatHexDump(raw);
    hexToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      hexDump.classList.toggle("hidden");
      hexToggle.textContent = hexDump.classList.contains("hidden")
        ? `\u25B6 Show raw hex (${raw.length} bytes)`
        : `\u25BC Hide raw hex`;
    });
    detail.appendChild(hexToggle);
    detail.appendChild(hexDump);
  }
  return detail;
}

function formatHexDump(bytes: number[]): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.slice(i, i + 16);
    const hex = slice.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = slice.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
    lines.push(`${i.toString(16).padStart(4, "0")}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Add CSS for expanded rows, field table, hex dump**

```css
/* Expandable HCI rows */
.hci-expandable { cursor: pointer; }
.hci-expandable .expand-indicator {
  margin-left: 6px; font-size: 9px; opacity: 0.4;
  transition: opacity 0.15s;
}
.hci-expandable:hover .expand-indicator { opacity: 0.8; }
.hci-expandable.expanded { background: rgba(197, 134, 192, 0.06); }

/* Detail panel (below expanded row) */
.hci-detail {
  padding: 6px 10px 8px 140px;
  border-left: 3px solid #c586c0;
  background: rgba(197, 134, 192, 0.04);
  font-size: 12px;
}
.hci-fields { border-collapse: collapse; }
.hci-fields td { padding: 1px 0; }
.hci-fields .field-name {
  color: var(--vscode-descriptionForeground, #888);
  padding-right: 16px; white-space: nowrap;
}
.hci-fields .field-value { color: var(--vscode-editor-foreground, #ddd); }

/* Hex dump */
.hex-toggle {
  margin-top: 6px; font-size: 10px; cursor: pointer;
  color: var(--vscode-descriptionForeground, #666);
  transition: color 0.15s;
}
.hex-toggle:hover { color: var(--vscode-editor-foreground, #ccc); }
.hex-dump {
  margin-top: 4px; font-size: 11px; line-height: 1.4;
  color: var(--vscode-descriptionForeground, #666);
  font-family: var(--vscode-editor-font-family, monospace);
}
```

- [ ] **Step 5: Add keyboard support (Enter/Space to toggle)**

In the click handler section, add:
```typescript
timeline.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const row = (e.target as HTMLElement).closest(".hci-expandable");
    if (row) { e.preventDefault(); row.click(); }
  }
});
```

- [ ] **Step 6: Build, package, install, test manually**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run install-ext`

Connect phone to "LogScope Demo", verify:
- HCI rows show ▶ indicator
- Click expands to show decoded fields
- Click again collapses
- Raw hex toggle works inside expanded view
- Only one row expanded at a time
- Keyboard Enter/Space works

- [ ] **Step 7: Commit**

```
feat: expandable HCI rows with decoded fields and hex dump
```

---

### Task 5: Enhanced collapsed summaries

**Files:**
- Modify: `src/parser/hci-parser.ts`

- [ ] **Step 1: Use decoder summaries for collapsed message text**

In `makeEntry()`, after calling the decoder, if it returned a summary, use it to build a richer collapsed message:

For commands: `TX CMD LE Set PHY (tx: 2M, rx: 2M)` instead of `TX CMD LE Set PHY (7B)`
For events: `RX EVT LE Connection Complete (handle: 0x0040, addr: 74:A4:90:C7:D3:27)` instead of `RX EVT LE Connection Complete (19B)`
For ACL: `TX ACL handle:0x0040 ATT Write Request (handle: 0x0012)` instead of `TX ACL (23B)`

The decoder's `summary` field provides the inline params string.

- [ ] **Step 2: Build, test with real traffic**

Connect phone, verify collapsed summaries show decoded params.

- [ ] **Step 3: Commit**

```
feat: enhanced HCI collapsed summaries with decoded parameters
```

---

### Task 6: Final polish and commit

**Files:**
- Modify: `src/ui/webview/styles.css` (if needed)
- Modify: session file

- [ ] **Step 1: Test all packet types with real Bluetooth LE traffic**

From nRF Connect app:
1. Connect to "LogScope Demo" → verify LE Connection Complete decoded
2. Read info characteristic → verify ATT Read Request/Response
3. Write 0x01 to command characteristic → verify ATT Write Request
4. Enable notifications → verify ATT Write Request (CCC descriptor)
5. Disconnect → verify Disconnection Complete decoded

- [ ] **Step 2: Fix any field alignment or styling issues**

- [ ] **Step 3: Update session file with completion status**

- [ ] **Step 4: Final commit**

```
polish: deep HCI parsing complete — v0.2 milestone
```
