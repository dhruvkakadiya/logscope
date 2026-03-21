import { RawLogParser } from "../../src/parser/raw-log";

describe("RawLogParser", () => {
  const parser = new RawLogParser();

  test("wraps each non-empty line as a raw entry", () => {
    const entries = parser.parse("hello world\ngoodbye\n");
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("hello world");
    expect(entries[1].message).toBe("goodbye");
  });

  test("sets module to 'raw' and severity to 'inf'", () => {
    const entries = parser.parse("some line\n");
    expect(entries[0].module).toBe("raw");
    expect(entries[0].severity).toBe("inf");
    expect(entries[0].source).toBe("log");
  });

  test("sets timestamp to 0", () => {
    const entries = parser.parse("test\n");
    expect(entries[0].timestamp).toBe(0);
  });

  test("sets metadata.raw to true", () => {
    const entries = parser.parse("test\n");
    expect(entries[0].metadata).toEqual({ raw: true });
  });

  test("skips empty lines", () => {
    const entries = parser.parse("first\n\n\nsecond\n");
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("first");
    expect(entries[1].message).toBe("second");
  });

  test("strips ANSI escape codes", () => {
    const entries = parser.parse("\x1b[31mred text\x1b[0m\n");
    expect(entries[0].message).toBe("red text");
  });

  test("trims trailing whitespace", () => {
    const entries = parser.parse("  indented text  \n");
    expect(entries[0].message).toBe("indented text");
  });

  test("handles multi-line input", () => {
    const input = "line 1\nline 2\nline 3\n";
    const entries = parser.parse(input);
    expect(entries).toHaveLength(3);
  });

  test("handles Uint8Array input", () => {
    const buf = new TextEncoder().encode("binary line\n");
    const entries = parser.parse(buf);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("binary line");
  });

  test("does not set receivedAt (handleChunk responsibility)", () => {
    const entries = parser.parse("test\n");
    expect(entries[0].receivedAt).toBeUndefined();
  });
});
