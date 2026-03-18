# LogScope Unified Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign LogScope into a single self-contained panel with integrated connection controls, Activity Bar sidebar, oscilloscope icon, line wrapping, and multi-format export.

**Architecture:** The extension gains an Activity Bar icon with a TreeView sidebar for status/actions, while the existing WebView editor panel is enhanced with connection states (disconnected welcome, connecting, connected log viewer, settings expanded, unexpected disconnect). The WebView and extension host communicate via a documented postMessage protocol. RTT address auto-detection parses the Zephyr ELF from the workspace.

**Tech Stack:** VS Code Extension API (TreeView, WebviewPanel, postMessage), TypeScript, esbuild, HTML/CSS, Python (rtt-helper.py unchanged)

**Spec:** `docs/superpowers/specs/2026-03-18-unified-panel-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `assets/icon.svg` | Oscilloscope waveform Activity Bar icon (24x24 monochrome SVG) |
| `src/ui/sidebar-provider.ts` | TreeView data provider for Activity Bar sidebar (status, actions, stats) |
| `src/rtt-detect.ts` | RTT address auto-detection (ELF parsing, RAM scan fallback) |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add viewsContainers, views, update commands, add `logscope.logWrap` setting, change `rtt.address` default to "auto", change `rtt.pollInterval` default to 50 |
| `esbuild.config.mjs` | Copy `assets/icon.svg` to `out/` |
| `src/extension.ts` | Refactor connect/disconnect to handle WebView messages; register sidebar provider; add RTT auto-detect; add JSON export; wire up new message protocol |
| `src/ui/webview-provider.ts` | Send `init` message on panel show; handle connect/disconnect/export/updateSetting messages from WebView; pass config to WebView |
| `src/ui/webview/index.html` | Add welcome/connection form, connection bar, wrap toggle, export button; restructure into state-driven layout |
| `src/ui/webview/main.ts` | State machine (disconnected/connecting/connected/settings-expanded/unexpected-disconnect); settings form; connect/disconnect/export messages; wrap toggle |
| `src/ui/webview/styles.css` | Welcome state, connection bar, settings panel, wrap mode, horizontal scroll fix, connecting spinner |
| `src/ui/status-bar.ts` | Update click command to `logscope.open`; keep for quick-glance status |
| `src/model/session.ts` | Add `exportAsJsonLines()` function |

### Test Files

| File | Tests |
|------|-------|
| `test/model/session.test.ts` | Add tests for `exportAsJsonLines()` |
| `test/rtt-detect.test.ts` | New — tests for ELF parsing and auto-detection logic |

---

## Task 1: Activity Bar Icon (SVG)

**Files:**
- Create: `assets/icon.svg`

- [ ] **Step 1: Create the oscilloscope waveform SVG**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <!-- Scope screen -->
  <rect x="2" y="3" width="20" height="18" rx="2" />
  <!-- Waveform trace -->
  <path d="M5 12 Q7 4, 9 12 Q11 20, 13 12 Q15 4, 17 12 L19 12" />
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add assets/icon.svg
git commit -m "feat: add oscilloscope waveform Activity Bar icon"
```

---

## Task 2: Package.json — Activity Bar, Commands, Settings

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add viewsContainers and views**

Add to `contributes`:

```jsonc
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
    "name": "LogScope"
  }]
}
```

- [ ] **Step 2: Update commands**

Replace existing commands with:

```jsonc
"commands": [
  { "command": "logscope.open", "title": "LogScope: Open Log Viewer" },
  { "command": "logscope.connect", "title": "LogScope: Connect" },
  { "command": "logscope.disconnect", "title": "LogScope: Disconnect" },
  { "command": "logscope.export", "title": "LogScope: Export" }
]
```

- [ ] **Step 3: Update settings**

Change defaults:
- `logscope.rtt.address`: default `""` → `"auto"`, update description to mention auto-detection
- `logscope.rtt.pollInterval`: default `200` → `50`

Add new setting:
```jsonc
"logscope.logWrap": {
  "type": "boolean",
  "default": false,
  "description": "Wrap long log messages instead of truncating. Toggle via the wrap button in the viewer."
}
```

- [ ] **Step 4: Add activation event for sidebar**

Add to `activationEvents`:
```jsonc
"activationEvents": ["onView:logscope.sidebar"]
```

- [ ] **Step 5: Build and verify no errors**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`
Expected: Clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: add Activity Bar, update commands and settings"
```

---

## Task 3: RTT Address Auto-Detection

**Files:**
- Create: `src/rtt-detect.ts`
- Create: `test/rtt-detect.test.ts`

- [ ] **Step 1: Write failing tests for ELF parsing**

`test/rtt-detect.test.ts`:

```typescript
import { parseRttAddressFromNmOutput, findZephyrElf } from "../src/rtt-detect";

describe("parseRttAddressFromNmOutput", () => {
  it("extracts RTT address from nm output", () => {
    const nmOutput = `00000001 A CONFIG_HAS_SEGGER_RTT
20004050 B _SEGGER_RTT
00000010 A CONFIG_SEGGER_RTT_CB_ALIGNMENT`;
    expect(parseRttAddressFromNmOutput(nmOutput)).toBe(0x20004050);
  });

  it("returns null when _SEGGER_RTT not found", () => {
    expect(parseRttAddressFromNmOutput("no rtt here")).toBeNull();
  });

  it("handles different address lengths", () => {
    const nmOutput = "20000450 B _SEGGER_RTT";
    expect(parseRttAddressFromNmOutput(nmOutput)).toBe(0x20000450);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/rtt-detect.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement rtt-detect.ts**

`src/rtt-detect.ts`:

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

/** Parse the _SEGGER_RTT address from `nm` output. */
export function parseRttAddressFromNmOutput(nmOutput: string): number | null {
  for (const line of nmOutput.split("\n")) {
    const match = line.match(/^([0-9a-fA-F]+)\s+\w\s+_SEGGER_RTT$/);
    if (match) {
      return parseInt(match[1], 16);
    }
  }
  return null;
}

/** Search workspace for a Zephyr ELF file. */
export async function findZephyrElf(workspaceRoot: string): Promise<string | null> {
  const buildDir = path.join(workspaceRoot, "build");
  try {
    // Check build/*/zephyr/zephyr.elf (multi-build layout)
    for await (const entry of fs.promises.opendir(buildDir)) {
      if (entry.isDirectory()) {
        const candidate = path.join(buildDir, entry.name, "zephyr", "zephyr.elf");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    // Check build/zephyr/zephyr.elf (single-build layout)
    const direct = path.join(buildDir, "zephyr", "zephyr.elf");
    if (fs.existsSync(direct)) return direct;
  } catch {
    // build/ directory doesn't exist
  }
  return null;
}

/** Extract RTT address from a Zephyr ELF using nm. */
export async function detectRttAddressFromElf(elfPath: string): Promise<number | null> {
  // Try arm-zephyr-eabi-nm first (NCS toolchain), then arm-none-eabi-nm, then generic nm
  const nmCandidates = ["arm-zephyr-eabi-nm", "arm-none-eabi-nm", "nm"];

  for (const nm of nmCandidates) {
    try {
      const { stdout } = await execFileAsync(nm, [elfPath]);
      const addr = parseRttAddressFromNmOutput(stdout);
      if (addr !== null) return addr;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Auto-detect RTT address. Tries ELF parsing first, returns null if not found.
 * RAM scan is handled separately in the Python helper (future enhancement).
 */
export async function autoDetectRttAddress(workspaceRoot: string): Promise<{ address: number; source: string } | null> {
  const elf = await findZephyrElf(workspaceRoot);
  if (!elf) return null;

  const address = await detectRttAddressFromElf(elf);
  if (address === null) return null;

  return { address, source: `ELF: ${path.basename(path.dirname(path.dirname(elf)))}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/rtt-detect.test.ts -v`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/rtt-detect.ts test/rtt-detect.test.ts
git commit -m "feat: RTT address auto-detection from Zephyr ELF"
```

---

## Task 4: JSON Lines Export

**Files:**
- Modify: `src/model/session.ts`
- Modify: `test/model/session.test.ts`

- [ ] **Step 1: Write failing test for exportAsJsonLines**

Add to `test/model/session.test.ts`:

```typescript
import { exportAsJsonLines } from "../src/model/session";

describe("exportAsJsonLines", () => {
  it("exports entries as JSON Lines", () => {
    const entries = [
      { timestamp: 1002056, source: "log" as const, severity: "inf" as const, module: "sensor_drv", message: "Temperature: 23.17 C", metadata: {} },
      { timestamp: 2003112, source: "log" as const, severity: "dbg" as const, module: "ble_conn", message: "Advertising: 110 ms", metadata: {} },
    ];
    const result = exportAsJsonLines(entries);
    const lines = result.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: 1002056, severity: "inf", module: "sensor_drv", message: "Temperature: 23.17 C"
    });
    expect(JSON.parse(lines[1])).toEqual({
      timestamp: 2003112, severity: "dbg", module: "ble_conn", message: "Advertising: 110 ms"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/model/session.test.ts -v`
Expected: FAIL — exportAsJsonLines not found

- [ ] **Step 3: Implement exportAsJsonLines**

Add to `src/model/session.ts`:

```typescript
export function exportAsJsonLines(entries: LogEntry[]): string {
  return entries
    .map((e) => JSON.stringify({
      timestamp: e.timestamp,
      severity: e.severity,
      module: e.module,
      message: e.message,
    }))
    .join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npx jest test/model/session.test.ts -v`
Expected: PASS — all tests including new one

- [ ] **Step 5: Commit**

```bash
git add src/model/session.ts test/model/session.test.ts
git commit -m "feat: add JSON Lines export format"
```

---

## Task 5: Sidebar TreeView Provider

**Files:**
- Create: `src/ui/sidebar-provider.ts`

- [ ] **Step 1: Implement sidebar TreeView provider**

`src/ui/sidebar-provider.ts`:

```typescript
import * as vscode from "vscode";

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  transport: string;
  address: string;
  entryCount: number;
}

export class LogScopeSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: ConnectionState = {
    connected: false,
    connecting: false,
    transport: "",
    address: "",
    entryCount: 0,
  };

  updateState(partial: Partial<ConnectionState>): void {
    Object.assign(this.state, partial);
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SidebarItem[] {
    const items: SidebarItem[] = [];

    // Status
    if (this.state.connecting) {
      items.push(new SidebarItem("Connecting...", "$(loading~spin)", ""));
    } else if (this.state.connected) {
      items.push(new SidebarItem(
        `Connected via ${this.state.transport}`,
        "$(plug)",
        `RTT @ ${this.state.address}`
      ));
      items.push(new SidebarItem(
        `${this.state.entryCount.toLocaleString()} entries`,
        "$(list-ordered)",
        ""
      ));
    } else {
      items.push(new SidebarItem("Disconnected", "$(debug-disconnect)", ""));
    }

    // Actions
    items.push(new SidebarItem("", "", "", true)); // separator

    if (this.state.connected) {
      items.push(SidebarItem.action("Open Log Viewer", "$(open-preview)", "logscope.open"));
      items.push(SidebarItem.action("Export", "$(desktop-download)", "logscope.export"));
      items.push(SidebarItem.action("Disconnect", "$(debug-disconnect)", "logscope.disconnect"));
    } else if (!this.state.connecting) {
      items.push(SidebarItem.action("Connect", "$(plug)", "logscope.connect"));
      items.push(SidebarItem.action("Open Log Viewer", "$(open-preview)", "logscope.open"));
    }

    return items;
  }
}

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description: string,
    isSeparator = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon.replace("$(", "").replace(")", ""));
    }
    this.description = description;
    if (isSeparator) {
      this.label = "──────────";
      this.iconPath = undefined;
    }
  }

  static action(label: string, icon: string, command: string): SidebarItem {
    const item = new SidebarItem(label, icon, "");
    item.command = { command, title: label };
    return item;
  }
}
```

- [ ] **Step 2: Build to verify no type errors**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/ui/sidebar-provider.ts
git commit -m "feat: add Activity Bar sidebar TreeView provider"
```

---

## Task 6: WebView HTML — State-Driven Layout

**Files:**
- Modify: `src/ui/webview/index.html`

- [ ] **Step 1: Rewrite index.html with all panel states**

Replace the entire content of `src/ui/webview/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src {{cspSource}}; script-src 'nonce-{{nonce}}';"
  />
  <link rel="stylesheet" href="{{stylesUri}}" />
  <title>LogScope</title>
</head>
<body>

  <!-- ── State 1: Disconnected (Welcome/Setup) ─────────────── -->
  <div id="welcome" class="state">
    <div id="welcome-inner">
      <h1>LogScope</h1>
      <p class="subtitle">Embedded Log Viewer</p>

      <div id="connect-form">
        <label>
          Transport
          <select id="cfg-transport">
            <option value="nrfutil">nrfutil (SWD)</option>
            <option value="jlink-telnet">J-Link Telnet</option>
          </select>
        </label>

        <div id="nrfutil-fields">
          <label>
            RTT Address
            <input id="cfg-rtt-address" type="text" placeholder="auto" spellcheck="false" />
          </label>
          <label>
            Poll Interval (ms)
            <input id="cfg-poll-interval" type="number" value="50" min="10" max="1000" />
          </label>
        </div>

        <div id="jlink-fields" class="hidden">
          <label>
            Host
            <input id="cfg-host" type="text" value="localhost" spellcheck="false" />
          </label>
          <label>
            Port
            <input id="cfg-port" type="number" value="19021" />
          </label>
        </div>

        <div id="connect-error" class="hidden"></div>

        <button id="connect-btn">Connect</button>
      </div>
    </div>
  </div>

  <!-- ── State 2: Connected (Log Viewer) ───────────────────── -->
  <div id="viewer" class="state hidden">

    <!-- Connection bar -->
    <div id="connection-bar">
      <span id="conn-status">
        <span class="dot green"></span>
        <span id="conn-label">Connected</span>
      </span>
      <div id="conn-actions">
        <button id="export-btn" title="Export">&#x2B07;</button>
        <button id="settings-btn" title="Settings">&#x2699;</button>
        <button id="disconnect-btn" title="Disconnect">&#x23CF;</button>
      </div>
    </div>

    <!-- Inline settings (toggled by gear icon) -->
    <div id="inline-settings" class="hidden">
      <div id="inline-settings-inner">
        <label>
          Transport
          <select id="cfg-transport-inline" disabled>
            <option value="nrfutil">nrfutil (SWD)</option>
            <option value="jlink-telnet">J-Link Telnet</option>
          </select>
        </label>
        <span class="hint">(disconnect to change transport)</span>
        <label>
          RTT Address
          <input id="cfg-rtt-address-inline" type="text" spellcheck="false" />
        </label>
        <label>
          Poll Interval (ms)
          <input id="cfg-poll-interval-inline" type="number" min="10" max="1000" />
        </label>
        <span class="hint">Changes take effect on next reconnect</span>
      </div>
    </div>

    <!-- Reconnect bar (unexpected disconnect) -->
    <div id="reconnect-bar" class="hidden">
      <span class="dot amber"></span>
      <span>Connection lost</span>
      <button id="reconnect-btn">Reconnect</button>
      <button id="dismiss-btn">Dismiss</button>
    </div>

    <!-- Filter bar -->
    <div id="filter-bar">
      <div id="severity-toggles">
        <button class="severity-btn active" data-severity="err">ERR</button>
        <button class="severity-btn active" data-severity="wrn">WRN</button>
        <button class="severity-btn active" data-severity="inf">INF</button>
        <button class="severity-btn active" data-severity="dbg">DBG</button>
      </div>

      <select id="module-select">
        <option value="">All modules</option>
      </select>

      <input id="search-input" type="text" placeholder="Search logs..." spellcheck="false" />

      <button id="wrap-btn" title="Toggle line wrap">&#x21A9;</button>
      <button id="auto-scroll-btn" class="active" title="Auto-scroll">&#x2193; Auto</button>
      <button id="clear-btn" title="Clear timeline">Clear</button>
    </div>

    <!-- Timeline -->
    <div id="timeline"></div>

    <!-- Status bar -->
    <div id="status-bar">
      <span id="status-connection">Connected</span>
      <span id="status-count">0 entries</span>
      <span id="status-evicted"></span>
    </div>
  </div>

  <script nonce="{{nonce}}" src="{{scriptUri}}"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/webview/index.html
git commit -m "feat: WebView HTML with connection states"
```

---

## Task 7: WebView CSS — All States and Fixes

**Files:**
- Modify: `src/ui/webview/styles.css`

- [ ] **Step 1: Rewrite styles.css with all states**

Replace the entire content of `src/ui/webview/styles.css`. This includes:
- Welcome state (centered form)
- Connection bar (compact, with green/amber dots)
- Inline settings panel
- Reconnect bar
- Wrap toggle and horizontal scroll fix
- Filter bar export button
- All existing log row and severity styles preserved

Key CSS additions:

```css
/* Welcome state */
#welcome { display: flex; align-items: center; justify-content: center; height: 100%; }
#welcome-inner { max-width: 400px; width: 100%; text-align: center; }
#welcome h1 { font-size: 24px; margin-bottom: 4px; }
.subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
#connect-form { text-align: left; }
#connect-form label { display: block; margin-bottom: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
#connect-form select, #connect-form input { width: 100%; margin-top: 4px; }
#connect-btn { width: 100%; margin-top: 8px; padding: 8px; }
#connect-btn:disabled { opacity: 0.6; cursor: wait; }
#connect-error { color: #f44747; font-size: 12px; margin-top: 8px; padding: 8px; border: 1px solid #f44747; border-radius: 3px; }

/* Connection bar */
#connection-bar { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
#conn-actions { display: flex; gap: 4px; }
#conn-actions button { background: transparent; border: 1px solid var(--vscode-button-border, #555); border-radius: 3px; color: var(--vscode-editor-foreground); cursor: pointer; padding: 2px 6px; font-size: 13px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot.green { background: #4ec9b0; }
.dot.amber { background: #cca700; }

/* Inline settings */
#inline-settings { padding: 8px 10px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
#inline-settings-inner { max-width: 400px; }
#inline-settings label { display: block; margin-bottom: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.hint { font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.7; display: block; margin-bottom: 8px; }

/* Reconnect bar */
#reconnect-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(204, 167, 0, 0.1); border-bottom: 1px solid #cca700; font-size: 12px; }
#reconnect-bar button { padding: 2px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; border: 1px solid var(--vscode-button-border, #555); }
#reconnect-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

/* Horizontal scroll fix + wrap mode */
#timeline { overflow-x: auto; }
#timeline.wrap-mode .log-row { white-space: normal; }
#timeline.wrap-mode .log-row .msg { white-space: normal; word-break: break-word; }
#wrap-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }

/* State visibility */
.state { height: 100%; }
.hidden { display: none !important; }
#viewer { display: flex; flex-direction: column; }
```

All existing filter bar, severity button, log row, and status bar styles are preserved.

- [ ] **Step 2: Commit**

```bash
git add src/ui/webview/styles.css
git commit -m "feat: WebView CSS for all panel states, wrap mode, scroll fix"
```

---

## Task 8: WebView Client Logic — State Machine

**Files:**
- Modify: `src/ui/webview/main.ts`

- [ ] **Step 1: Rewrite main.ts with state machine**

Rewrite `src/ui/webview/main.ts`. Keep all existing filter/timeline logic intact and add the state machine on top. Here is the skeleton of the new code to add (existing filter/timeline/row creation code is preserved unchanged):

```typescript
// ── New DOM references ──────────────────────────────────
const welcomeEl = document.getElementById("welcome")!;
const viewerEl = document.getElementById("viewer")!;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const connectError = document.getElementById("connect-error")!;
const cfgTransport = document.getElementById("cfg-transport") as HTMLSelectElement;
const cfgRttAddress = document.getElementById("cfg-rtt-address") as HTMLInputElement;
const cfgPollInterval = document.getElementById("cfg-poll-interval") as HTMLInputElement;
const cfgHost = document.getElementById("cfg-host") as HTMLInputElement;
const cfgPort = document.getElementById("cfg-port") as HTMLInputElement;
const nrfutilFields = document.getElementById("nrfutil-fields")!;
const jlinkFields = document.getElementById("jlink-fields")!;
const connLabel = document.getElementById("conn-label")!;
const connectionBar = document.getElementById("connection-bar")!;
const inlineSettings = document.getElementById("inline-settings")!;
const reconnectBar = document.getElementById("reconnect-bar")!;
const settingsBtn = document.getElementById("settings-btn")!;
const disconnectBtn = document.getElementById("disconnect-btn")!;
const exportBtn = document.getElementById("export-btn")!;
const reconnectBtn = document.getElementById("reconnect-btn")!;
const dismissBtn = document.getElementById("dismiss-btn")!;
const wrapBtn = document.getElementById("wrap-btn")!;

// ── State management ────────────────────────────────────
let wrapEnabled = false;

function showState(state: "welcome" | "viewer") {
  welcomeEl.classList.toggle("hidden", state !== "welcome");
  viewerEl.classList.toggle("hidden", state !== "viewer");
}

// ── Transport field toggle ──────────────────────────────
cfgTransport.addEventListener("change", () => {
  const isNrfutil = cfgTransport.value === "nrfutil";
  nrfutilFields.classList.toggle("hidden", !isNrfutil);
  jlinkFields.classList.toggle("hidden", isNrfutil);
});

// ── Connect form ────────────────────────────────────────
connectBtn.addEventListener("click", () => {
  vscode.postMessage({
    type: "connect",
    config: {
      transport: cfgTransport.value,
      rttAddress: cfgRttAddress.value || "auto",
      pollInterval: parseInt(cfgPollInterval.value) || 50,
      host: cfgHost.value || "localhost",
      port: parseInt(cfgPort.value) || 19021,
    },
  });
});

// ── Connected state buttons ─────────────────────────────
disconnectBtn.addEventListener("click", () => vscode.postMessage({ type: "disconnect" }));
exportBtn.addEventListener("click", () => vscode.postMessage({ type: "export" }));
reconnectBtn.addEventListener("click", () => vscode.postMessage({ type: "reconnect" }));
dismissBtn.addEventListener("click", () => {
  reconnectBar.classList.add("hidden");
  showState("welcome");
});

settingsBtn.addEventListener("click", () => {
  inlineSettings.classList.toggle("hidden");
});

// ── Wrap toggle ─────────────────────────────────────────
wrapBtn.addEventListener("click", () => {
  wrapEnabled = !wrapEnabled;
  wrapBtn.classList.toggle("active", wrapEnabled);
  timeline.classList.toggle("wrap-mode", wrapEnabled);
  vscode.postMessage({ type: "updateSetting", key: "logscope.logWrap", value: wrapEnabled });
});

// ── Add to existing message handler switch statement ────
// Add these cases to the window "message" event listener:

case "init": {
  const { config, wrapEnabled: wrap } = msg;
  cfgTransport.value = config.transport ?? "nrfutil";
  cfgRttAddress.value = config.rttAddress === "auto" ? "" : (config.rttAddress ?? "");
  cfgRttAddress.placeholder = config.rttAddress === "auto" ? "auto (detect from ELF)" : "0x20004050";
  cfgPollInterval.value = String(config.pollInterval ?? 50);
  cfgHost.value = config.host ?? "localhost";
  cfgPort.value = String(config.port ?? 19021);
  wrapEnabled = wrap ?? false;
  wrapBtn.classList.toggle("active", wrapEnabled);
  timeline.classList.toggle("wrap-mode", wrapEnabled);
  // Toggle transport-specific fields
  cfgTransport.dispatchEvent(new Event("change"));
  break;
}

case "connecting": {
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";
  connectError.classList.add("hidden");
  break;
}

case "connected": {
  connectBtn.disabled = false;
  connectBtn.textContent = "Connect";
  connLabel.textContent = `Connected via ${msg.transport} @ ${msg.address}`;
  connectionBar.classList.remove("hidden");
  reconnectBar.classList.add("hidden");
  showState("viewer");
  break;
}

case "disconnected": {
  connectBtn.disabled = false;
  connectBtn.textContent = "Connect";
  if (msg.unexpected) {
    // Show reconnect bar, keep logs visible
    reconnectBar.classList.remove("hidden");
    connectionBar.classList.add("hidden");
  } else {
    showState("welcome");
  }
  break;
}

case "connectError": {
  connectBtn.disabled = false;
  connectBtn.textContent = "Connect";
  connectError.textContent = msg.message;
  connectError.classList.remove("hidden");
  break;
}
```

All existing code (severity toggles, module select, search, auto-scroll, clear, createRow, shouldShow, refilterTimeline, clearTimeline, and the existing message handler cases for `entries`, `status`, `modules`, `clear`) is preserved unchanged.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/ui/webview/main.ts
git commit -m "feat: WebView state machine with connect/disconnect/settings/wrap/export"
```

---

## Task 9: WebView Provider — Message Handling and Init

**Files:**
- Modify: `src/ui/webview-provider.ts`

- [ ] **Step 1: Add init message and config passing**

Add to `LogScopePanel`:

1. **sendInit(config, wrapEnabled)**: Posts `{ type: "init", config: { transport, rttAddress, pollInterval, host, port }, wrapEnabled }` to bootstrap the WebView with current settings
2. **sendConnecting()**: Posts `{ type: "connecting" }`
3. **sendConnected(transport, address)**: Posts `{ type: "connected", transport, address }`
4. **sendDisconnected(unexpected)**: Posts `{ type: "disconnected", unexpected }`
5. **sendConnectError(message)**: Posts `{ type: "connectError", message }`

Update `show()` to call `sendInit()` after HTML is set. Call `sendInit()` again if `show()` is called when already visible (to refresh config).

Update `setMessageHandler()` to accept and forward all new message types: `connect`, `disconnect`, `reconnect`, `export`, `updateSetting`.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/ui/webview-provider.ts
git commit -m "feat: WebView provider init message, state notifications, settings relay"
```

---

## Task 10: Extension.ts — Wire Everything Together

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/ui/status-bar.ts`
- Modify: `esbuild.config.mjs`

- [ ] **Step 1: Update esbuild to copy icon**

Add to `copyAssets()` in `esbuild.config.mjs`:

```javascript
mkdirSync("out/assets", { recursive: true });
// icon.svg is referenced from package.json as assets/icon.svg (relative to extension root)
// No need to copy — it's read directly from source
```

Actually, `assets/icon.svg` is referenced by package.json at the extension root level, not from `out/`. No esbuild change needed — the icon is loaded by VS Code directly from the extension directory.

- [ ] **Step 2: Update status-bar.ts click command**

Change `logscope.connect` command reference to `logscope.open` so clicking the status bar opens the panel:

In `src/ui/status-bar.ts`, update the constructor to set `command = "logscope.open"` on the connection item (instead of `logscope.connect`).

- [ ] **Step 3: Refactor extension.ts**

Major changes with implementation details:

**3a. Imports and sidebar registration:**
```typescript
import { LogScopeSidebarProvider } from "./ui/sidebar-provider";
import { autoDetectRttAddress } from "./rtt-detect";
import { exportAsJsonLines } from "./model/session";

const sidebarProvider = new LogScopeSidebarProvider();
// In activate():
context.subscriptions.push(
  vscode.window.registerTreeDataProvider("logscope.sidebar", sidebarProvider)
);
```

**3b. WebView message handler — replace existing `panel.setMessageHandler`:**

The `connect` message now carries the form config as payload. This avoids race conditions with settings persistence.

```typescript
panel.setMessageHandler(async (msg) => {
  switch (msg.type) {
    case "connect":
    case "reconnect": {
      const config = msg.config as {
        transport: string; rttAddress: string;
        pollInterval: number; host: string; port: number;
      };
      panel?.sendConnecting();
      sidebarProvider.updateState({ connecting: true });

      try {
        if (config.transport === "nrfutil") {
          let rttAddr: number;
          if (!config.rttAddress || config.rttAddress === "auto") {
            // Auto-detect from ELF
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const detected = workspaceRoot ? await autoDetectRttAddress(workspaceRoot) : null;
            if (!detected) {
              throw new Error("Could not auto-detect RTT address. Enter it manually or ensure a Zephyr build exists in the workspace.");
            }
            rttAddr = detected.address;
          } else {
            rttAddr = parseInt(config.rttAddress, 16);
            if (isNaN(rttAddr)) {
              throw new Error(`Invalid RTT address "${config.rttAddress}". Use hex like 0x20004050.`);
            }
          }
          await connectNrfutil(rttAddr, config.pollInterval);
        } else {
          await connectJlinkTelnet(config.host, config.port);
        }
        panel?.sendConnected(config.transport, `0x${rttAddr?.toString(16) ?? config.host + ":" + config.port}`);
        sidebarProvider.updateState({ connected: true, connecting: false, transport: config.transport, address: `0x${rttAddr?.toString(16)}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        panel?.sendConnectError(message);
        sidebarProvider.updateState({ connecting: false });
      }
      break;
    }
    case "disconnect": {
      userDisconnecting = true;
      disconnectAll();
      panel?.sendDisconnected(false);
      sidebarProvider.updateState({ connected: false });
      userDisconnecting = false;
      break;
    }
    case "export": {
      if (!ringBuffer || ringBuffer.size === 0) {
        vscode.window.showWarningMessage("LogScope: Nothing to export.");
        return;
      }
      const format = await vscode.window.showQuickPick(
        [{ label: "Text (.log)", value: "text" }, { label: "JSON Lines (.jsonl)", value: "jsonl" }],
        { placeHolder: "Export format" }
      );
      if (!format) return;
      const ext = format.value === "jsonl" ? "jsonl" : "log";
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`logscope-export.${ext}`),
        filters: { [format.label]: [ext] },
      });
      if (!uri) return;
      const entries = ringBuffer.getAll();
      const content = format.value === "jsonl"
        ? exportAsJsonLines(entries)
        : exportAsText(entries);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage(`LogScope: Exported ${entries.length} entries to ${uri.fsPath}`);
      break;
    }
    case "updateSetting": {
      const cfg = vscode.workspace.getConfiguration("logscope");
      await cfg.update(msg.key as string, msg.value, vscode.ConfigurationTarget.Workspace);
      break;
    }
    case "clear": {
      ringBuffer?.clear();
      panel?.clear();
      break;
    }
  }
});
```

**3c. Refactor `connectNrfutil` to accept parameters directly** (not from VS Code settings):
```typescript
async function connectNrfutil(rttAddr: number, pollInterval: number) {
  const cfg = getConfig();
  ringBuffer = new RingBuffer(cfg.maxEntries);
  session = new Session("device", "rtt");
  lineBuffer = "";

  const nrfutil = new NrfutilRttTransport({
    rttAddress: rttAddr,
    pollIntervalMs: pollInterval,
    nrfutilPath: cfg.nrfutilPath,
  });
  transport = nrfutil;
  wireTransportEvents(nrfutil);
  await nrfutil.connect();
  startStatusUpdates();
}
```

**3d. On unexpected disconnect** — in the transport `disconnected` event handler:
```typescript
function wireTransportEvents(t: Transport) {
  t.on("data", (chunk: Buffer) => handleChunk(chunk));
  t.on("disconnected", () => {
    if (!userDisconnecting) {
      panel?.sendDisconnected(true); // unexpected = true
      sidebarProvider.updateState({ connected: false });
    }
    statusBar?.update(false, ringBuffer?.size ?? 0, ringBuffer?.evictedCount ?? 0);
  });
  t.on("error", (err: Error) => {
    console.error("[LogScope] Transport error:", err.message);
  });
}
```

**3e. Rename command** `logscope.openPanel` → `logscope.open`. Command palette `logscope.connect` still works by calling `panel?.show()` first (to ensure the form is visible), then letting the user click Connect in the panel. Alternatively, if called from palette, use the saved VS Code settings directly.

**3f. Update entry count in sidebar** — in `startStatusUpdates`:
```typescript
sidebarProvider.updateState({ entryCount: ringBuffer?.size ?? 0 });
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm run build`
Expected: Clean build

- [ ] **Step 5: Run all tests**

Run: `cd /Users/mafaneh/Projects/tools/logscope && npm test`
Expected: All existing tests pass (extension.ts changes don't affect model/parser tests)

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts src/ui/status-bar.ts esbuild.config.mjs
git commit -m "feat: wire sidebar, auto-detect, export picker, WebView message protocol"
```

---

## Task 11: Manual Integration Test

- [ ] **Step 1: Launch Extension Development Host**

Open `/Users/mafaneh/Projects/tools/logscope` in VS Code, press F5.

- [ ] **Step 2: Verify Activity Bar icon appears**

The oscilloscope icon should appear in the left Activity Bar. Click it to reveal the sidebar with "Disconnected" status and Connect/Open Log Viewer buttons.

- [ ] **Step 3: Test welcome state**

Click "Open Log Viewer" — panel should show centered welcome form with transport dropdown and RTT address field (placeholder: "auto").

- [ ] **Step 4: Test connection**

Click Connect. Verify:
- Button shows "Connecting..." (disabled)
- Sidebar shows "Connecting..."
- Panel transitions to log viewer with connection bar
- Logs start flowing

- [ ] **Step 5: Test inline settings**

Click gear icon in connection bar. Settings panel expands. Transport dropdown is disabled. Close by clicking gear again.

- [ ] **Step 6: Test wrap toggle**

Click ↩ button in filter bar. Long messages should wrap. Click again to unwrap.

- [ ] **Step 7: Test horizontal scroll**

With wrap off, verify the timeline scrolls horizontally for long messages.

- [ ] **Step 8: Test export**

Click export button (⬇) in connection bar. Quick Pick shows "Text (.log)" and "JSON Lines (.jsonl)". Select each and verify file contents.

- [ ] **Step 9: Test disconnect**

Click disconnect button. Verify:
- Panel returns to welcome state
- Sidebar shows "Disconnected"
- No "connection lost" warning (intentional disconnect)

- [ ] **Step 10: Test unexpected disconnect**

Connect, then unplug the device (or kill the helper process). Verify:
- Reconnect bar appears ("Connection lost" with Reconnect/Dismiss)
- Logs remain visible
- Click Reconnect to re-establish connection
