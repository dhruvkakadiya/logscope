import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type { Transport } from "./types";

/**
 * RTT transport via SEGGER J-Link.
 *
 * Spawns a Python helper that uses pylink (native J-Link RTT) for
 * zero-packet-loss streaming. Falls back to nrfutil CLI if pylink
 * is not available (nRF devices only, slower).
 *
 * Works with any J-Link probe and any target device.
 */

export interface RttTransportConfig {
  /** J-Link device name (e.g., "NRF54L15_M33", "STM32F407VG") or RTT address hex for nrfutil fallback */
  device: string;
  /** Poll interval in ms (default 50) */
  pollIntervalMs?: number;
  /** Path to nrfutil binary for fallback (default: "nrfutil") */
  nrfutilPath?: string;
}

export class NrfutilRttTransport extends EventEmitter implements Transport {
  private _connected = false;
  private helper: ChildProcess | null = null;

  /** The device name actually used (may differ from config if auto-detected) */
  detectedDevice: string | null = null;

  private readonly device: string;
  private readonly pollIntervalMs: number;
  private readonly nrfutilPath: string;

  constructor(config: RttTransportConfig) {
    super();
    this.device = config.device;
    this.pollIntervalMs = config.pollIntervalMs ?? 50;
    this.nrfutilPath = config.nrfutilPath ?? "nrfutil";
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    const helperPath = path.join(__dirname, "rtt-helper.py");

    // Prefer the venv Python (has pylink), fall back to system
    const extensionRoot = path.resolve(__dirname, "..");
    const venvPython = path.join(extensionRoot, ".venv", "bin", "python3");
    const pythonPath = fs.existsSync(venvPython) ? venvPython : "python3";
    console.log(`[LogScope] Using Python: ${pythonPath}`);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonPath, [
        helperPath,
        this.device,
        String(this.pollIntervalMs),
        this.nrfutilPath,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.helper = proc;

      let stderrBuf = "";
      let resolved = false;

      proc.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderrBuf += text;

        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.log(`[LogScope rtt-helper] ${line.trim()}`);
          }
        }

        // Capture auto-detected device name
        const deviceMatch = stderrBuf.match(/DEVICE_DETECTED (\S+)/);
        if (deviceMatch) {
          this.detectedDevice = deviceMatch[1];
        }

        if (!resolved && stderrBuf.includes("RTT_READY")) {
          resolved = true;
          this._connected = true;
          this.emit("connected");
          resolve();
        }

        if (!resolved && stderrBuf.includes("ERROR:")) {
          resolved = true;
          const errLine = stderrBuf.split("\n").find(l => l.includes("ERROR:")) ?? "Unknown error";
          reject(new Error(errLine));
        }
      });

      proc.stdout!.on("data", (chunk: Buffer) => {
        if (this._connected) {
          this.emit("data", chunk);
        }
      });

      proc.on("exit", (code) => {
        const wasConnected = this._connected;
        this._connected = false;
        this.helper = null;

        if (!resolved) {
          resolved = true;
          reject(new Error(`RTT helper exited with code ${code} before connecting`));
        } else if (wasConnected) {
          this.emit("disconnected");
        }
      });

      proc.on("error", (err) => {
        this._connected = false;
        this.helper = null;
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          this.emit("error", err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          reject(new Error("RTT helper timed out connecting to device"));
        }
      }, 15_000);
    });
  }

  disconnect(): void {
    if (this.helper) {
      this.helper.kill();
      this.helper = null;
    }
    this._connected = false;
    this.emit("disconnected");
  }
}
