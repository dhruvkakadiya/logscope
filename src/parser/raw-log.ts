import type { LogEntry, Parser } from "./types";
import { ANSI_RE } from "./utils";

export class RawLogParser implements Parser {
  parse(data: string | Uint8Array): LogEntry[] {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const lines = text.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const trimmed = line.replaceAll(ANSI_RE, "").trim();
      if (!trimmed) continue;

      entries.push({
        timestamp: 0,
        source: "log",
        severity: "inf",
        module: "raw",
        message: trimmed,
        metadata: { raw: true },
      });
    }

    return entries;
  }
}
