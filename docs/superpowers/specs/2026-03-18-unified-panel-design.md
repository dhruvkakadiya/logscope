# LogScope Unified Panel Design

**Date:** 2026-03-18
**Status:** Draft

## Overview

Redesign LogScope from a multi-command extension into a single, self-contained panel with integrated connection controls, settings, log viewing, and export — all accessible from a dedicated Activity Bar icon.

## Goals

- Everything in one place: connect, configure, view logs, export — no command palette required
- Activity Bar presence for easy discoverability (like Docker, GitLens, nRF Connect)
- Clean first-run experience that guides users to connect
- Command palette commands retained for power users
- Fix horizontal overflow (truncated log messages)

## Activity Bar Integration

### Sidebar Icon

LogScope gets its own icon in the VS Code Activity Bar (left edge). The icon is an **oscilloscope waveform**: a rounded rectangle with a signal trace running through it. Monochrome SVG, 24x24px, using VS Code's icon color theming.

### Sidebar Tree View

Clicking the Activity Bar icon reveals a lightweight sidebar tree view with:

- **Connection status** — "Connected" / "Disconnected" with green/gray indicator
- **Device info** (when connected) — transport type, RTT address
- **Quick actions**:
  - Connect / Disconnect button
  - Open Log Viewer button
  - Export button
- **Stats** (when connected) — entry count, uptime

The sidebar is intentionally minimal — it's a control panel, not a log viewer. Log viewing happens in the full-width editor panel.

**Sidebar synchronization:** The sidebar TreeView provider holds a reference to the extension's connection state and uses the standard `onDidChangeTreeData` EventEmitter to refresh when state changes. Sidebar buttons execute commands directly via `vscode.commands.executeCommand('logscope.connect')` etc.

### Editor Panel (WebView)

Clicking "Open Log Viewer" in the sidebar (or the command palette) opens the main LogScope editor panel. This panel has three visual states.

## Panel States

### State 1: Disconnected (Welcome/Setup)

When no connection is active, the panel shows a centered connection form:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                    LogScope                           │
│            Embedded Log Viewer                        │
│                                                      │
│  ┌─ Connection ────────────────────────────────────┐ │
│  │                                                 │ │
│  │  Transport      [nrfutil (SWD)          ▾]     │ │
│  │  RTT Address    [0x20004050              ]     │ │
│  │  Poll Interval  [50                      ] ms  │ │
│  │                                                 │ │
│  │  ── J-Link Telnet (advanced) ──                │ │
│  │  Host           [localhost               ]     │ │
│  │  Port           [19021                   ]     │ │
│  │                                                 │ │
│  │              [ Connect ]                        │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Behavior:**
- Transport dropdown shows "nrfutil (SWD)" and "J-Link Telnet"
- When "nrfutil" is selected, show RTT Address and Poll Interval fields
- When "J-Link Telnet" is selected, show Host and Port fields instead
- J-Link-specific fields (device, interface, speed, search ranges) grouped under an "Advanced" collapsible section — hidden by default
- Settings are persisted to VS Code workspace settings on change (WebView sends `{ type: "updateSetting", key, value }` → extension host calls `workspace.getConfiguration().update()`)
- Connect button triggers connection via `{ type: "connect" }` message to extension host

### State 1.5: Connecting (Transition)

After clicking Connect, the panel shows a loading state:

- Connect button becomes disabled, text changes to "Connecting..." with a spinner
- Sidebar TreeView shows "Connecting..." with amber indicator
- If connection succeeds → transition to State 2
- If connection fails → return to State 1 with an inline error message below the Connect button (e.g., "Could not read RTT control block. Check that the device is connected and the RTT address is correct.")
- Connection timeout: 10 seconds

### State 2: Connected (Log Viewer)

Once connected, the welcome screen is replaced by the full log viewer:

```
┌──────────────────────────────────────────────────────┐
│ ● Connected via nrfutil @ 0x20004050    [⚙] [⏏]    │ ← connection bar
├──────────────────────────────────────────────────────┤
│ ERR WRN INF DBG │All modules▾│ Search...  │↩ ↓Auto Clear ⬇│ ← filter bar
├──────────────────────────────────────────────────────┤
│ 00:00:01.002  INF sensor_drv  Temperature: 23.17 C  │
│ 00:00:01.002  INF sensor_drv  Humidity: 46%          │
│ 00:00:02.003  DBG ble_conn    Advertising: 110 ms    │
│ 00:00:03.004  INF app         Heartbeat: cycle 3     │
│ ...                                                   │
├──────────────────────────────────────────────────────┤
│ Connected  402 entries                                │ ← status bar
└──────────────────────────────────────────────────────┘
```

**Connection bar elements:**
- Green dot + "Connected via nrfutil @ 0x20004050" (or "via J-Link Telnet @ localhost:19021")
- ⚙ gear icon — toggles settings panel (State 3)
- ⏏ disconnect button

**Filter bar elements (updated):**
- Severity toggles: ERR, WRN, INF, DBG (existing)
- Module dropdown (existing)
- Search input (existing)
- **↩ Wrap toggle** (new) — toggles line wrapping on/off
- ↓ Auto scroll (existing)
- Clear button (existing)
- **⬇ Export button** (new) — triggers export with format picker

### State 3: Settings Expanded (While Connected)

Clicking the gear icon in the connection bar expands the settings panel inline, pushing the log viewer down:

```
┌──────────────────────────────────────────────────────┐
│ ● Connected via nrfutil @ 0x20004050    [⚙] [⏏]    │
│  ┌─ Settings ────────────────────────────────────┐  │
│  │  Transport      [nrfutil (SWD)          ▾]    │  │
│  │  RTT Address    [0x20004050              ]    │  │
│  │  Poll Interval  [50                      ] ms │  │
│  └───────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│ ERR WRN INF DBG │All modules▾│ Search...             │
├──────────────────────────────────────────────────────┤
│ (log viewer continues below)                         │
└──────────────────────────────────────────────────────┘
```

Settings changes are saved immediately. The transport dropdown is **disabled while connected** to avoid confusion — a small "(disconnect to change)" label appears next to it. Other fields (RTT address, poll interval) can be edited and take effect on next reconnect, with a subtle note indicating this.

### State 4: Unexpected Disconnect

When the transport emits a "disconnected" event unexpectedly (device unplugged, USB glitch):

- The connection bar turns amber: "● Connection lost" with a **Reconnect** button and a **Dismiss** button
- The log timeline and all existing entries **remain visible** — logs are not cleared
- Sidebar TreeView shows "Disconnected" with red indicator
- Clicking Reconnect attempts to connect with the same settings
- Clicking Dismiss returns to State 1 (Disconnected welcome), preserving entries in memory (accessible via export)

## Horizontal Scroll and Line Wrapping

### Problem

Log messages are currently truncated with `text-overflow: ellipsis` and `overflow-x: hidden`. Long messages are invisible.

### Solution

- **Default: Truncate + horizontal scroll** — the timeline gets `overflow-x: auto` so users can scroll right to see full messages. Each row remains single-line.
- **Wrap mode**: A toggle button (↩ icon) in the filter bar switches to `white-space: normal` on `.log-row .msg`, allowing messages to wrap to multiple lines within the panel width.
- The wrap preference is persisted to VS Code workspace settings.

## WebView ↔ Extension Host Message Protocol

The WebView is sandboxed — all VS Code API interactions go through `postMessage`.

### WebView → Extension Host

| Message | Description |
|---------|-------------|
| `{ type: "connect", config: { transport, rttAddress, pollInterval, host, port } }` | User clicked Connect (includes form values to avoid settings race) |
| `{ type: "disconnect" }` | User clicked Disconnect |
| `{ type: "reconnect" }` | User clicked Reconnect after unexpected disconnect |
| `{ type: "export" }` | User clicked Export button |
| `{ type: "updateSetting", key: string, value: any }` | Setting changed in form |
| `{ type: "clear" }` | User clicked Clear (existing) |

### Extension Host → WebView

| Message | Description |
|---------|-------------|
| `{ type: "init", config: {...}, wrapEnabled: boolean }` | Bootstrap WebView with current settings and state |
| `{ type: "connecting" }` | Connection attempt started |
| `{ type: "connected", transport: string, address: string }` | Connection succeeded |
| `{ type: "disconnected", unexpected: boolean }` | Connection ended (user-initiated or unexpected) |
| `{ type: "connectError", message: string }` | Connection failed |
| `{ type: "entries", entries: [...] }` | Log entries batch (existing) |
| `{ type: "status", connected, entryCount, evictedCount }` | Status update (existing) |
| `{ type: "modules", modules: [...] }` | Module list update (existing) |
| `{ type: "clear" }` | Clear timeline (existing) |

### Export Flow

1. WebView sends `{ type: "export" }`
2. Extension host shows VS Code Quick Pick: "Text (.log)" or "JSON Lines (.jsonl)"
3. Extension host shows Save Dialog with appropriate default filename
4. Extension host writes file and shows confirmation message

## Export

### Trigger

Export button (⬇) in the connection bar (next to the disconnect button — semantically a "session action", not a filter). Clicking it triggers the export flow described above.

1. **Text (.log)** — human-readable plain text
2. **JSON Lines (.jsonl)** — structured, one JSON object per line

After selecting format, a save dialog appears with the appropriate default filename and extension.

### Text Format

```
[00:00:01.002] <inf> sensor_drv: Temperature: 23.17 C
[00:00:01.002] <inf> sensor_drv: Humidity: 46%
[00:00:02.003] <dbg> ble_conn: Advertising: interval 110 ms
```

### JSON Lines Format

Each line is a self-contained JSON object:

```jsonl
{"timestamp":1002056,"severity":"inf","module":"sensor_drv","message":"Temperature: 23.17 C"}
{"timestamp":1002060,"severity":"inf","module":"sensor_drv","message":"Humidity: 46%"}
{"timestamp":2003112,"severity":"dbg","module":"ble_conn","message":"Advertising: interval 110 ms"}
```

## Commands and Keybindings

All UI actions are also available as command palette commands:

| Command | Title | Notes |
|---------|-------|-------|
| `logscope.open` | LogScope: Open | Opens/reveals the log viewer panel |
| `logscope.connect` | LogScope: Connect | Connects with current settings |
| `logscope.disconnect` | LogScope: Disconnect | Disconnects |
| `logscope.export` | LogScope: Export | Triggers export format picker |

The `logscope.openPanel` command is renamed to `logscope.open` for brevity.

## Activity Bar Icon: Oscilloscope Waveform

A 24x24 monochrome SVG depicting a simplified oscilloscope screen:

- Rounded rectangle outline (the scope screen)
- A signal waveform trace running horizontally through the center — a clean sine-like wave with 1.5-2 cycles
- Stroke-only design (no fills), using `currentColor` for VS Code theme compatibility
- Line weight: 1.5px stroke for the frame, 1.5px for the waveform

The icon should be immediately recognizable at small sizes and distinct from other common Activity Bar icons (files, search, git, extensions, debug).

## Package.json Changes

### New Contributions

```jsonc
{
  "viewsContainers": {
    "activitybar": [{
      "id": "logscope",
      "title": "LogScope",
      "icon": "assets/icon.svg"
    }]
  },
  "views": {
    "logscope": [{
      "id": "logscope.sidebar",
      "name": "LogScope",
      "type": "tree"
    }]
  }
}
```

### Settings Changes

- `logscope.rtt.address` — kept, now editable from panel UI
- `logscope.rtt.pollInterval` — kept, default changed to 50ms
- `logscope.transport` — kept, now editable from panel UI
- `logscope.logWrap` — new boolean, default false, persisted wrap preference
- J-Link settings — kept for J-Link Telnet transport

## File Changes Summary

| File | Change |
|------|--------|
| `package.json` | Add viewsContainers, views, update commands |
| `assets/icon.svg` | New — oscilloscope waveform icon |
| `src/extension.ts` | Refactor connect/disconnect to handle messages from WebView; register sidebar tree view provider |
| `src/ui/sidebar-provider.ts` | New — tree view data provider for Activity Bar sidebar |
| `src/ui/webview-provider.ts` | Pass config to WebView on init; handle settings/connect/disconnect/export messages from WebView |
| `src/ui/webview/index.html` | Add connection bar, settings form, wrap toggle, export button |
| `src/ui/webview/main.ts` | Handle settings form, connect/disconnect flow, wrap toggle, export messages |
| `src/ui/webview/styles.css` | Connection bar, settings panel, welcome state, wrap mode, horizontal scroll |
| `src/model/session.ts` | Add `exportAsJsonLines()` alongside existing `exportAsText()` |

## Status Bar

The existing `src/ui/status-bar.ts` VS Code status bar item is **kept** — it provides a quick glance at connection status even when the sidebar and panel are not visible. It shows "LogScope: Connected (N entries)" or "LogScope: Disconnected". Clicking it runs `logscope.open`.

## Export Scope

Export always exports **all entries** in the ring buffer, regardless of active filters. This avoids confusion about what was exported. The export confirmation message includes the count: "Exported 402 entries to logscope-export.log".

## Future Milestone: VS Code Marketplace Publishing

Readiness checklist for publishing LogScope to the VS Code Marketplace:

- **Publisher account** — register "Novel-Bits" at marketplace.visualstudio.com/manage
- **Personal Access Token** — from dev.azure.com with "Marketplace (Manage)" scope
- **README.md** — feature overview, screenshots, installation, configuration guide
- **CHANGELOG.md** — version history
- **Marketplace icon** — 128x128 PNG (the oscilloscope waveform, but filled/colored for the listing tile)
- **Screenshots** — 3-4 images showing: disconnected welcome state, connected log viewer with live data, filtering in action, sidebar tree view
- **Categories and tags** — "Debuggers", "Other"; tags: "embedded", "zephyr", "rtt", "segger", "nordic", "log viewer"
- **License** — MIT (already set in package.json)
- **Minimum VS Code version** — verify `engines.vscode` is correct
- **Package and publish** — `npx vsce package` then `npx vsce publish`

This is deferred until the unified panel redesign is complete and tested.

## RTT Address Auto-Detection

The RTT control block address should be detected automatically without user input. Three strategies are attempted in order:

### Strategy 1: Parse Zephyr ELF (Primary)

On connect, search the VS Code workspace for a Zephyr ELF file:

1. Look for `build/*/zephyr/zephyr.elf` in the workspace root (standard Zephyr build output)
2. Also check `build/zephyr/zephyr.elf` (single-build layout)
3. Extract the `_SEGGER_RTT` symbol address by shelling out to `nm` (try `arm-zephyr-eabi-nm` first, fall back to `arm-none-eabi-nm`, then generic `nm`)
4. Parse the hex address from the output line matching `_SEGGER_RTT`

This works for any user with a Zephyr workspace open, which is the primary use case.

### Strategy 2: Scan Device RAM (Fallback)

If no ELF is found (e.g., user opened LogScope in a different workspace, or firmware was built elsewhere):

1. Connect to the device via pynrfjprog
2. Scan RAM in 1KB chunks starting at 0x20000000, searching for the "SEGGER RTT" magic bytes (10-byte ASCII string)
3. Default scan range: 0x20000000–0x20010000 (64KB covers most Cortex-M devices)
4. On nRF54L15 and other ECC-RAM devices, read errors on uninitialized memory are caught and skipped gracefully — the scan continues with the next chunk
5. If the magic is found, read the full control block to validate (check MaxNumUpBuffers is reasonable, pBuffer points to valid RAM)

### Strategy 3: Manual Entry (Last Resort)

If both auto-detection methods fail:

1. Show an inline message in the connection form: "Could not detect RTT address automatically. Enter it manually — find it with: `arm-zephyr-eabi-nm build/*/zephyr/zephyr.elf | grep _SEGGER_RTT`"
2. The RTT Address field becomes required and highlighted
3. User enters the address and clicks Connect

### Settings Behavior

- `logscope.rtt.address` default changes from `""` (required) to `"auto"`
- When set to `"auto"`, the auto-detection sequence runs on each connect
- When set to a hex address (e.g., `"0x20004050"`), auto-detection is skipped and the address is used directly
- The connection bar shows the detected/configured address: "Connected via nrfutil @ 0x20004050 (auto-detected)"
- If auto-detection succeeds, the detected address is shown in the settings form as a placeholder so the user can see what was found

### ELF Watch (Optional Enhancement)

When connected with an auto-detected address, watch the ELF file for changes (e.g., user rebuilds firmware and flashes). If the `_SEGGER_RTT` address changes in the new ELF, show a notification: "RTT address changed in new build. Reconnect to use the updated address." This prevents silent failures after reflashing.

### Open Question: Simpler Device Connection UX

The auto-detection strategies above work but still feel too technical for a log viewer. Ideally the user just clicks "Connect" and logs appear — like opening a serial terminal. Possible directions to explore:

- **Leverage nRF Connect extension** — if the user already has nRF Connect for VS Code installed, it knows the connected device, the build directory, and the ELF path. Can we query its API or read its workspace state to get the RTT address with zero configuration?
- **Device picker instead of address entry** — show a list of connected debug probes (via nrfutil/pynrfjprog), let the user pick one, and handle everything else automatically. Similar to how serial terminal extensions show a port picker.
- **Zero-config "just works" flow** — combine probe detection + ELF parsing + RAM scan into a single "Connect" click with no fields at all. Show a progress indicator: "Detecting device... Found nRF54L15 → Scanning for RTT... Found @ 0x20004050 → Connected."

This is deferred for post-launch exploration. The current ELF + RAM scan + manual fallback approach ships first.

## Out of Scope

- Multiple simultaneous connections
- Log persistence across sessions (logs are in-memory only)
- Custom color themes for severity levels
