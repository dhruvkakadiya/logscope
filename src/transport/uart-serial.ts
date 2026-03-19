import { EventEmitter } from "events";
import { SerialPort } from "serialport";
import type { Transport } from "./types";

/** Configuration for UART serial transport */
export interface UartTransportConfig {
  /** Serial port path (e.g., "/dev/ttyACM0", "COM3") */
  port: string;
  /** Baud rate (default 115200) */
  baudRate?: number;
}

/** A serial port discovered on the system */
export interface DiscoveredSerialPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
}

/** Patterns to exclude from port discovery (Bluetooth, debug, etc.) */
const EXCLUDED_PORT_PATTERNS = [/bluetooth/i, /debug/i];

/**
 * Discover available serial ports, filtering out Bluetooth virtual ports
 * and debug consoles that are not real UART devices.
 */
export async function discoverSerialPorts(): Promise<DiscoveredSerialPort[]> {
  const allPorts = await SerialPort.list();

  return allPorts
    .filter((p) => !EXCLUDED_PORT_PATTERNS.some((re) => re.test(p.path)))
    .map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || undefined,
      serialNumber: p.serialNumber || undefined,
      pnpId: p.pnpId || undefined,
    }));
}

/**
 * UART serial transport for log streaming.
 *
 * Connects to a serial port (CDC ACM, USB-to-UART bridge, etc.) and
 * emits raw data buffers. No HCI framing — UART is log-only.
 *
 * Events: connected, disconnected, data, error
 */
export class UartTransport extends EventEmitter implements Transport {
  private _connected = false;
  private serialPort: SerialPort | null = null;
  private readonly portPath: string;
  private readonly baudRate: number;

  constructor(config: UartTransportConfig) {
    super();
    this.portPath = config.port;
    this.baudRate = config.baudRate ?? 115200;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) {
      return Promise.reject(new Error("Already connected"));
    }

    return new Promise<void>((resolve, reject) => {
      const port = new SerialPort({
        path: this.portPath,
        baudRate: this.baudRate,
        autoOpen: false,
      });

      this.serialPort = port;
      let settled = false;

      port.on("open", () => {
        if (settled) return;
        settled = true;
        this._connected = true;
        this.emit("connected");
        resolve();
      });

      port.on("data", (chunk: Buffer) => {
        this.emit("data", chunk);
      });

      port.on("close", () => {
        this._connected = false;
        this.emit("disconnected");
      });

      port.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          this._connected = false;
          reject(err);
        } else {
          this.emit("error", err);
        }
      });

      // Timeout: reject if port doesn't open within 10 seconds
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          port.destroy();
          this.serialPort = null;
          reject(new Error(`Timed out opening serial port ${this.portPath}`));
        }
      }, 10_000);

      port.open((err) => {
        clearTimeout(timeout);
        if (err && !settled) {
          settled = true;
          this._connected = false;
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    if (this.serialPort) {
      const port = this.serialPort;
      this.serialPort = null;
      this._connected = false;

      if (port.isOpen) {
        port.close();
      } else {
        port.destroy();
        this.emit("disconnected");
      }
    }
  }
}
