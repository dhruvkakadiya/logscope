import { EventEmitter } from "events";

// --- Mock serialport module ---

/** Error to inject on next open() call, or null for success */
let mockOpenError: Error | null = null;

class MockSerialPort extends EventEmitter {
  isOpen = false;
  readonly path: string;
  readonly baudRate: number;

  constructor(options: { path: string; baudRate: number; autoOpen: boolean }) {
    super();
    this.path = options.path;
    this.baudRate = options.baudRate;
  }

  open(callback?: (err: Error | null) => void): void {
    const err = mockOpenError;
    mockOpenError = null; // reset for next test
    if (err) {
      if (callback) callback(err);
      return;
    }
    this.isOpen = true;
    if (callback) callback(null);
    // Simulate async open event
    process.nextTick(() => this.emit("open"));
  }

  close(callback?: (err: Error | null) => void): void {
    this.isOpen = false;
    if (callback) callback(null);
    process.nextTick(() => this.emit("close"));
  }

  destroy(): void {
    this.isOpen = false;
    this.removeAllListeners();
  }
}

let mockInstance: MockSerialPort | null = null;
let mockListResult: Array<{
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
}> = [];

jest.mock("serialport", () => ({
  SerialPort: class extends MockSerialPort {
    constructor(options: { path: string; baudRate: number; autoOpen: boolean }) {
      super(options);
      mockInstance = this;
    }
    static list: jest.Mock = jest.fn(async () => mockListResult);
  },
}));

import {
  UartTransport,
  discoverSerialPorts,
  UartTransportConfig,
} from "../../src/transport/uart-serial";

describe("UartTransport", () => {
  beforeEach(() => {
    mockInstance = null;
    mockOpenError = null;
  });

  test("creates with default baud rate (115200)", () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    expect(transport).toBeDefined();
    expect(transport.connected).toBe(false);
  });

  test("creates with custom baud rate", () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0", baudRate: 9600 });
    expect(transport).toBeDefined();
    expect(transport.connected).toBe(false);
  });

  test("connects and emits connected event", async () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    const connectedPromise = new Promise<void>((resolve) => {
      transport.on("connected", () => resolve());
    });

    await transport.connect();

    expect(transport.connected).toBe(true);
    await connectedPromise;
  });

  test("emits data event on received bytes", async () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    await transport.connect();

    const dataPromise = new Promise<Buffer>((resolve) => {
      transport.on("data", (chunk: Buffer) => resolve(chunk));
    });

    // Simulate data arriving on the serial port
    const testData = Buffer.from("[00:00:01.000,000] <inf> test: hello\n");
    mockInstance!.emit("data", testData);

    const received = await dataPromise;
    expect(received).toEqual(testData);
  });

  test("disconnects cleanly and emits disconnected", async () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    await transport.connect();
    expect(transport.connected).toBe(true);

    const disconnectedPromise = new Promise<void>((resolve) => {
      transport.on("disconnected", () => resolve());
    });

    transport.disconnect();
    await disconnectedPromise;

    expect(transport.connected).toBe(false);
  });

  test("handles disconnect when not connected (no throw)", () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    expect(() => transport.disconnect()).not.toThrow();
  });

  test("connect rejects on serial port open error", async () => {
    mockOpenError = new Error("ENOENT: no such device");
    const transport = new UartTransport({ port: "/dev/nonexistent" });

    await expect(transport.connect()).rejects.toThrow("ENOENT");
    expect(transport.connected).toBe(false);
  });

  test("rejects if already connected", async () => {
    const t = new UartTransport({ port: "/dev/ttyACM0" });
    await t.connect();
    await expect(t.connect()).rejects.toThrow("Already connected");
  });

  test("rejects with timeout if port never opens", async () => {
    jest.useFakeTimers();

    // Save original open behavior and replace with one that never calls back
    const origOpen = MockSerialPort.prototype.open;
    MockSerialPort.prototype.open = function () {
      /* never calls back or emits open */
    };

    const t = new UartTransport({ port: "/dev/ttyACM0" });
    const connectPromise = t.connect();

    jest.advanceTimersByTime(10_001);

    await expect(connectPromise).rejects.toThrow(/timed out/i);

    MockSerialPort.prototype.open = origOpen;
    jest.useRealTimers();
  });

  test("emits error event on serial port error after connected", async () => {
    const transport = new UartTransport({ port: "/dev/ttyACM0" });
    await transport.connect();

    const errorPromise = new Promise<Error>((resolve) => {
      transport.on("error", (err: Error) => resolve(err));
    });

    mockInstance!.emit("error", new Error("device unplugged"));

    const err = await errorPromise;
    expect(err.message).toBe("device unplugged");
  });
});

describe("discoverSerialPorts", () => {
  test("returns filtered port list excluding Bluetooth and debug ports", async () => {
    mockListResult = [
      { path: "/dev/ttyACM0", manufacturer: "Nordic Semiconductor" },
      { path: "/dev/ttyACM1", manufacturer: "SEGGER" },
      { path: "/dev/tty.Bluetooth-Incoming-Port", manufacturer: undefined },
      { path: "/dev/cu.Bluetooth-Incoming-Port", manufacturer: undefined },
      { path: "/dev/tty.debug-console", manufacturer: undefined },
      { path: "COM3", manufacturer: "FTDI", serialNumber: "ABC123" },
    ];

    const ports = await discoverSerialPorts();

    // Should include real serial ports
    expect(ports.some((p) => p.path === "/dev/ttyACM0")).toBe(true);
    expect(ports.some((p) => p.path === "/dev/ttyACM1")).toBe(true);
    expect(ports.some((p) => p.path === "COM3")).toBe(true);

    // Should exclude Bluetooth and debug ports
    expect(ports.some((p) => p.path.includes("Bluetooth"))).toBe(false);
    expect(ports.some((p) => p.path.includes("debug"))).toBe(false);

    // Verify structure
    const nordic = ports.find((p) => p.path === "/dev/ttyACM0");
    expect(nordic?.manufacturer).toBe("Nordic Semiconductor");

    const ftdi = ports.find((p) => p.path === "COM3");
    expect(ftdi?.serialNumber).toBe("ABC123");
  });

  test("returns empty array when no ports found", async () => {
    mockListResult = [];
    const ports = await discoverSerialPorts();
    expect(ports).toEqual([]);
  });
});
