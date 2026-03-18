import { ChildProcess, spawn } from "child_process";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface JLinkConfig {
  jlinkPath: string; // empty = auto-detect
  device: string;
  iface: string; // "SWD" or "JTAG"
  speed: number;
  rttPort: number;
  rttSearchRanges: string; // e.g. "0x20000000 0x80000" (base size)
  rttAddress: string; // e.g. "0x20000450" — explicit RTT control block address
}

// Common J-Link installation directories by platform
const JLINK_DIRS: Record<string, string[]> = {
  darwin: [
    "/Applications/SEGGER/JLink",
    "/usr/local/bin",
  ],
  linux: [
    "/opt/SEGGER/JLink",
    "/usr/bin",
    "/usr/local/bin",
  ],
  win32: [
    "C:\\Program Files\\SEGGER\\JLink",
    "C:\\Program Files (x86)\\SEGGER\\JLink",
  ],
};

// Prefer JLinkExe (Commander) — it doesn't halt the core, allowing RTT data to flow.
// JLinkGDBServerCLExe halts the CPU waiting for a GDB client, blocking RTT output.
const JLINK_BINARIES = [
  { name: "JLinkExe", type: "commander" as const },
  { name: "JLinkGDBServerCLExe", type: "gdbserver" as const },
];

export class JLinkManager {
  private process: ChildProcess | null = null;
  private _running = false;

  get running(): boolean {
    return this._running;
  }

  /** Find a J-Link binary on the system. Prefers GDB Server CL (no GUI). */
  findJLink(configPath: string): { path: string; type: "gdbserver" | "commander" } | null {
    // User-specified path takes priority
    if (configPath && fs.existsSync(configPath)) {
      const isGdbServer = configPath.includes("GDBServer");
      return { path: configPath, type: isGdbServer ? "gdbserver" : "commander" };
    }

    // Search known directories for preferred binaries
    const dirs = JLINK_DIRS[process.platform] ?? [];
    for (const binary of JLINK_BINARIES) {
      for (const dir of dirs) {
        const candidate = path.join(dir, binary.name);
        if (fs.existsSync(candidate)) {
          return { path: candidate, type: binary.type };
        }
      }
    }

    // Try PATH lookup
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
    for (const binary of JLINK_BINARIES) {
      for (const dir of pathDirs) {
        const candidate = path.join(dir, binary.name);
        if (fs.existsSync(candidate)) {
          return { path: candidate, type: binary.type };
        }
      }
    }

    return null;
  }

  /** Start J-Link and wait for the RTT telnet server to be ready */
  async start(config: JLinkConfig): Promise<{ started: boolean; jlinkPath: string | null; error?: string }> {
    const jlink = this.findJLink(config.jlinkPath);
    console.log("[LogScope JLink] findJLink result:", JSON.stringify(jlink));

    if (!jlink) {
      return {
        started: false,
        jlinkPath: null,
        error: "J-Link tools not found. Install from segger.com or set logscope.jlink.path in settings.",
      };
    }

    if (jlink.type === "gdbserver") {
      return this.startGdbServer(jlink.path, config);
    } else {
      return this.startCommander(jlink.path, config);
    }
  }

  /** Start via JLinkGDBServerCLExe — preferred, no GUI dialogs */
  private startGdbServer(jlinkPath: string, config: JLinkConfig): Promise<{ started: boolean; jlinkPath: string | null; error?: string }> {
    const args = [
      "-device", config.device,
      "-if", config.iface,
      "-speed", String(config.speed),
      "-RTTTelnetPort", String(config.rttPort),
      "-noreset",
      "-noir",
      "-RTTSearchRanges", config.rttSearchRanges.replace(" ", "_"),
    ];

    return new Promise((resolve) => {
      try {
        this.process = spawn(jlinkPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this._running = true;

        this.process.on("exit", () => {
          this._running = false;
          this.process = null;
        });

        this.process.on("error", (err) => {
          this._running = false;
          this.process = null;
          resolve({
            started: false,
            jlinkPath,
            error: `Failed to start J-Link GDB Server: ${err.message}`,
          });
        });

        // Wait for the RTT telnet server to become available
        this.waitForPort(config.rttPort, 8000, 150)
          .then(() => {
            resolve({ started: true, jlinkPath });
          })
          .catch(() => {
            this.stop();
            resolve({
              started: false,
              jlinkPath,
              error: "J-Link GDB Server started but RTT telnet server did not become available. Check your device connection.",
            });
          });
      } catch (err) {
        this._running = false;
        resolve({
          started: false,
          jlinkPath,
          error: `Failed to spawn J-Link: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  /** Start via JLinkExe with a command file — avoids GUI dialogs and stdin pipe issues */
  private startCommander(jlinkPath: string, config: JLinkConfig): Promise<{ started: boolean; jlinkPath: string | null; error?: string }> {
    // Write a temporary J-Link command file
    const cmdFile = path.join(os.tmpdir(), `logscope-jlink-${Date.now()}.jlink`);
    const cmds = [
      "connect",
      `exec SetRTTSearchRanges ${config.rttSearchRanges}`,
    ];
    if (config.rttAddress) {
      cmds.push(`exec SetRTTAddr ${config.rttAddress}`);
    }
    cmds.push("go"); // Resume CPU execution — connect halts the core
    cmds.push("sleep 100000000");
    fs.writeFileSync(cmdFile, cmds.join("\n") + "\n");
    console.log("[LogScope JLink] Command file:", cmdFile, "commands:", cmds);

    const args = [
      "-NoGui", "1",
      "-Device", config.device,
      "-If", config.iface,
      "-Speed", String(config.speed),
      "-AutoConnect", "1",
      "-RTTTelnetPort", String(config.rttPort),
      "-CommandFile", cmdFile,
    ];

    return new Promise((resolve) => {
      try {
        this.process = spawn(jlinkPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this._running = true;

        const cleanup = () => {
          try { fs.unlinkSync(cmdFile); } catch { /* ignore */ }
        };

        this.process.on("exit", () => {
          this._running = false;
          this.process = null;
          cleanup();
        });

        this.process.on("error", (err) => {
          this._running = false;
          this.process = null;
          cleanup();
          resolve({
            started: false,
            jlinkPath,
            error: `Failed to start J-Link Commander: ${err.message}`,
          });
        });

        this.waitForPort(config.rttPort, 8000, 150)
          .then(() => {
            resolve({ started: true, jlinkPath });
          })
          .catch(() => {
            this.stop();
            cleanup();
            resolve({
              started: false,
              jlinkPath,
              error: "J-Link started but RTT telnet server did not become available. Check your device connection.",
            });
          });
      } catch (err) {
        this._running = false;
        try { fs.unlinkSync(cmdFile); } catch { /* ignore */ }
        resolve({
          started: false,
          jlinkPath,
          error: `Failed to spawn J-Link: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  /** Stop J-Link process */
  stop(): void {
    if (this.process) {
      try {
        this.process.stdin?.write("exit\n");
      } catch {
        // stdin may already be closed
      }

      const proc = this.process;
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 2000);

      this.process = null;
      this._running = false;
    }
  }

  /** Poll a TCP port until it accepts connections */
  private waitForPort(port: number, timeoutMs: number, intervalMs: number): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Port ${port} not available after ${timeoutMs}ms`));
          return;
        }

        const socket = new net.Socket();

        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });

        socket.once("error", () => {
          socket.destroy();
          setTimeout(tryConnect, intervalMs);
        });

        socket.connect(port, "localhost");
      };

      tryConnect();
    });
  }
}
