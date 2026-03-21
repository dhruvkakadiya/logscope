import type { LogEntry, Parser, Severity } from "./types";
import { ANSI_RE } from "./utils";

// Matches: [optional tick] <severity> module: message
// Examples:
//   <info> app: Hello World
//   00001234 <error> mod: msg
//   42 <debug> nrf_ble.conn: Connected
const NRF5_LOG_RE =
  /^(?:\s*(\d+)\s+)?<(error|warning|info|debug)>\s+([\w.]+):\s?(.*)/;

const SEVERITY_MAP: Record<string, Severity> = {
  error: "err",
  warning: "wrn",
  info: "inf",
  debug: "dbg",
};

export class Nrf5LogParser implements Parser {
  parse(data: string | Uint8Array): LogEntry[] {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const lines = text.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const trimmed = line.replaceAll(ANSI_RE, "").trimEnd();
      if (!trimmed) continue;

      const match = trimmed.match(NRF5_LOG_RE);
      if (match) {
        const [, ticks, severity, module, message] = match;

        const metadata: Record<string, unknown> = {};
        if (ticks !== undefined) {
          metadata.tickCount = Number.parseInt(ticks, 10);
        }

        entries.push({
          timestamp: 0,
          source: "log",
          severity: SEVERITY_MAP[severity],
          module,
          message: message ?? "",
          metadata,
        });
      } else {
        // Unmatched lines: boot banners, raw text, etc.
        // Show them so no data is lost — use "raw" module and "inf" severity
        entries.push({
          timestamp: 0,
          source: "log",
          severity: "inf",
          module: "raw",
          message: trimmed,
          metadata: { raw: true },
        });
      }
    }

    return entries;
  }
}
