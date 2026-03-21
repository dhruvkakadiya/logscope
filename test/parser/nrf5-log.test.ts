import { Nrf5LogParser } from "../../src/parser/nrf5-log";

describe("Nrf5LogParser", () => {
  const parser = new Nrf5LogParser();

  test("parses standard nRF5 log line", () => {
    const entries = parser.parse("<info> app: Hello World\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].severity).toBe("inf");
    expect(entries[0].module).toBe("app");
    expect(entries[0].message).toBe("Hello World");
    expect(entries[0].source).toBe("log");
  });

  test("parses line with tick timestamp", () => {
    const entries = parser.parse(" 00001234 <info> app: Hello World\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].module).toBe("app");
    expect(entries[0].message).toBe("Hello World");
    expect(entries[0].timestamp).toBe(0);
    expect(entries[0].metadata.tickCount).toBe(1234);
  });

  test("maps all four severity levels", () => {
    const mapping = [
      ["error", "err"],
      ["warning", "wrn"],
      ["info", "inf"],
      ["debug", "dbg"],
    ] as const;
    for (const [nrf5Level, expected] of mapping) {
      const entries = parser.parse(`<${nrf5Level}> mod: msg\n`);
      expect(entries[0].severity).toBe(expected);
    }
  });

  test("handles multi-line input", () => {
    const input = "<info> a: first\n<error> b: second\n";
    const entries = parser.parse(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].module).toBe("a");
    expect(entries[1].module).toBe("b");
  });

  test("handles module names with dots (instance format)", () => {
    const entries = parser.parse("<info> nrf_ble.conn: Connected\n");
    expect(entries[0].module).toBe("nrf_ble.conn");
  });

  test("handles empty message after module", () => {
    const entries = parser.parse("<debug> mod:\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("");
  });

  test("handles colons in message text", () => {
    const entries = parser.parse("<info> net: Addr: 192.168.1.1:8080\n");
    expect(entries[0].message).toBe("Addr: 192.168.1.1:8080");
  });

  test("strips ANSI escape codes", () => {
    const entries = parser.parse("\x1b[31m<error> app: fail\x1b[0m\n");
    expect(entries[0].severity).toBe("err");
    expect(entries[0].message).toBe("fail");
  });

  test("captures non-matching lines as raw entries", () => {
    const input = "boot banner\n<info> app: real log\n";
    const entries = parser.parse(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].module).toBe("raw");
    expect(entries[0].message).toBe("boot banner");
    expect(entries[1].module).toBe("app");
  });

  test("does not set receivedAt (handleChunk responsibility)", () => {
    const entries = parser.parse("<info> app: test\n");
    expect(entries[0].receivedAt).toBeUndefined();
  });

  test("handles Uint8Array input", () => {
    const buf = new TextEncoder().encode("<info> app: binary\n");
    const entries = parser.parse(buf);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("binary");
  });

  test("tick timestamp without leading zeros", () => {
    const entries = parser.parse(" 42 <debug> app: msg\n");
    expect(entries[0].metadata.tickCount).toBe(42);
  });
});
