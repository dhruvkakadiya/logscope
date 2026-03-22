/**
 * Parser for Zephyr BT Monitor protocol (RTT Channel 1).
 *
 * Wire format per packet:
 *   [data_len:2 LE][opcode:2 LE][flags:1][hdr_len:1][ext_hdr:N][payload:M]
 *   where M = data_len - 4 - hdr_len
 *
 * Opcodes: 2=Command, 3=Event, 4=ACL TX, 5=ACL RX, 12=System Note, 13=User Log
 */

import type { LogEntry } from "./types";
import { commandName, eventName } from "./hci-opcodes";
import { decodeCommand, decodeEvent, decodeAcl } from "./hci-decoders";
import { HciConnectionTracker } from "./hci-connection-tracker";

// BT Monitor opcodes
const OP_NEW_INDEX = 0;
const OP_COMMAND = 2;
const OP_EVENT = 3;
const OP_ACL_TX = 4;
const OP_ACL_RX = 5;
const OP_SCO_TX = 6;
const OP_SCO_RX = 7;
const OP_SYSTEM_NOTE = 12;
const OP_USER_LOGGING = 13;
const OP_ISO_TX = 18;
const OP_ISO_RX = 19;

// Extended header types
const EXT_TS32 = 8;

/** Intermediate result from packet-type handlers */
interface ParsedFields {
  direction?: string;
  pktType?: string;
  message: string;
  severity: "inf" | "dbg" | "wrn" | "err";
  decoded?: import("./types").DecodedPacket | null;
}

export class HciParser {
  private buffer = Buffer.alloc(0);
  private readonly tracker = new HciConnectionTracker();

  /**
   * Feed raw binary data from RTT Channel 1.
   * Returns parsed HCI log entries (may be empty if incomplete packet buffered).
   */
  parse(data: Buffer): LogEntry[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const entries: LogEntry[] = [];

    while (this.buffer.length >= 6) {
      // Need at least 2 bytes for data_len
      const dataLen = this.buffer.readUInt16LE(0);

      // Total packet size = 2 (data_len field) + dataLen
      const totalLen = 2 + dataLen;
      if (this.buffer.length < totalLen) break; // wait for more data

      // Extract packet
      const packet = this.buffer.subarray(0, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      const entry = this.parsePacket(packet);
      if (entry) entries.push(entry);
    }

    // Prevent unbounded buffer growth on corrupt data
    if (this.buffer.length > 65536) {
      this.buffer = Buffer.alloc(0);
    }

    return entries;
  }

  private parsePacket(packet: Buffer): LogEntry | null {
    if (packet.length < 6) return null;

    const dataLen = packet.readUInt16LE(0);
    const opcode = packet.readUInt16LE(2);
    const hdrLen = packet[5];

    // Extract timestamp from extended header
    let timestamp = 0;
    if (hdrLen >= 5 && packet.length > 6) {
      const extType = packet[6];
      if (extType === EXT_TS32 && hdrLen >= 5) {
        // TS32: 4 bytes LE, units of 1/10 ms (100 us)
        const ts32 = packet.readUInt32LE(7);
        timestamp = ts32 * 100; // convert to microseconds
      }
    }

    // Payload starts after base header + extended header
    const payloadOffset = 6 + hdrLen;
    const payloadLen = dataLen - 4 - hdrLen;
    if (payloadLen < 0 || payloadOffset + payloadLen > packet.length) return null;

    const payload = packet.subarray(payloadOffset, payloadOffset + payloadLen);

    return this.makeEntry(opcode, timestamp, payload);
  }

  private makeEntry(opcode: number, timestamp: number, payload: Buffer): LogEntry | null {
    const handler = this.opcodeHandlers[opcode];
    const fields = handler ? handler(payload) : this.handleUnknown(opcode, payload);
    if (!fields) return null;

    let direction = "";
    if (opcode >= 2 && opcode <= 7) {
      direction = opcode % 2 === 0 ? "tx" : "rx";
    }
    const meta: Record<string, unknown> = { opcode, direction };
    if (fields.decoded) meta.decoded = fields.decoded;

    return {
      timestamp,
      source: "hci",
      severity: fields.severity,
      module: fields.pktType || "hci",
      message: fields.message,
      raw: new Uint8Array(payload),
      metadata: meta,
    };
  }

  /** Dispatch table mapping BT Monitor opcodes to handler methods */
  private readonly opcodeHandlers: Record<number, (payload: Buffer) => ParsedFields | null> = {
    [OP_COMMAND]: (p) => this.handleCommand(p),
    [OP_EVENT]: (p) => this.handleEvent(p),
    [OP_ACL_TX]: (p) => this.handleAcl("TX", p),
    [OP_ACL_RX]: (p) => this.handleAcl("RX", p),
    [OP_SCO_TX]: (p) => this.handleSimple("TX", "SCO", p),
    [OP_ISO_TX]: (p) => this.handleSimple("TX", "ISO", p),
    [OP_SCO_RX]: (p) => this.handleSimple("RX", "SCO", p),
    [OP_ISO_RX]: (p) => this.handleSimple("RX", "ISO", p),
    [OP_SYSTEM_NOTE]: (p) => this.handleSystemNote(p),
    [OP_USER_LOGGING]: (p) => this.handleUserLogging(p),
    [OP_NEW_INDEX]: (p) => this.handleNewIndex(p),
  };

  private handleCommand(payload: Buffer): ParsedFields {
    const direction = "TX";
    const pktType = "CMD";

    if (payload.length < 3) {
      return { direction, pktType, message: `${direction} ${pktType} (${payload.length}B)`, severity: "inf" };
    }

    const cmdOpcode = payload.readUInt16LE(0);
    const paramLen = payload[2];
    const decoded = decodeCommand(cmdOpcode, payload);
    const name = commandName(cmdOpcode);
    const message = decoded?.summary
      ? `${direction} ${pktType} ${name} ${decoded.summary}`
      : `${direction} ${pktType} ${name} (${paramLen}B)`;

    return { direction, pktType, message, severity: "inf", decoded };
  }

  private handleEvent(payload: Buffer): ParsedFields {
    const direction = "RX";
    const pktType = "EVT";

    if (payload.length < 2) {
      return { direction, pktType, message: `${direction} ${pktType} (${payload.length}B)`, severity: "inf" };
    }

    const evtCode = payload[0];
    const evtParamLen = payload[1];
    const evtPayload = payload.subarray(2);
    const decoded = decodeEvent(evtCode, payload);
    const name = eventName(evtCode, evtPayload);
    const message = decoded?.summary
      ? `${direction} ${pktType} ${name} ${decoded.summary}`
      : `${direction} ${pktType} ${name} (${evtParamLen}B)`;

    this.trackConnectionEvents(decoded, evtCode, payload);
    this.trackDisconnectionEvents(decoded, evtCode);
    const severity = this.eventSeverity(evtCode, evtPayload);

    return { direction, pktType, message, severity, decoded };
  }

  /** Track LE Connection Complete / LE Enhanced Connection Complete events */
  private trackConnectionEvents(
    decoded: import("./types").DecodedPacket | null,
    evtCode: number,
    payload: Buffer,
  ): void {
    if (!decoded || evtCode !== 0x3e || payload.length < 3) return;

    const subevent = payload[2];
    if (subevent !== 0x01 && subevent !== 0x0a) return;

    const handleField = decoded.fields.find((f) => f.name === "Handle");
    const addrField = decoded.fields.find((f) => f.name === "Peer Address");
    const roleField = decoded.fields.find((f) => f.name === "Role");
    const statusField = decoded.fields.find((f) => f.name === "Status");
    if (!handleField || !addrField || !roleField || statusField?.value !== "Success") return;

    const h = Number.parseInt(handleField.value, 16);
    this.tracker.onConnectionComplete(h, addrField.value, roleField.value);
  }

  /** Track Disconnection Complete events */
  private trackDisconnectionEvents(decoded: import("./types").DecodedPacket | null, evtCode: number): void {
    if (!decoded || evtCode !== 0x05) return;

    const handleField = decoded.fields.find((f) => f.name === "Handle");
    if (!handleField) return;

    const h = Number.parseInt(handleField.value, 16);
    this.tracker.onDisconnection(h);
  }

  /** Determine severity for HCI events */
  private eventSeverity(evtCode: number, evtPayload: Buffer): "inf" | "err" {
    if (evtCode !== 0x0f) return "inf";
    // Command Status: non-zero status is an error
    const status = evtPayload.length > 0 ? evtPayload[0] : 0;
    return status === 0 ? "inf" : "err";
  }

  private handleAcl(direction: "TX" | "RX", payload: Buffer): ParsedFields {
    const pktType = "ACL";
    const decoded = decodeAcl(payload, this.tracker);

    if (decoded?.summary) {
      return { direction, pktType, message: `${direction} ${pktType} ${decoded.summary}`, severity: "dbg", decoded };
    }

    const aclLen = payload.length >= 4 ? payload.readUInt16LE(2) : payload.length;
    return { direction, pktType, message: `${direction} ${pktType} (${aclLen}B)`, severity: "dbg", decoded };
  }

  private handleSimple(direction: string, pktType: string, payload: Buffer): ParsedFields {
    return { direction, pktType, message: `${direction} ${pktType} (${payload.length}B)`, severity: "dbg" };
  }

  private handleSystemNote(payload: Buffer): ParsedFields {
    const note = payload.toString("utf-8").replaceAll("\0", "");
    return { message: `SYS ${note}`, severity: "wrn" };
  }

  private handleUserLogging(payload: Buffer): ParsedFields | null {
    if (payload.length < 2) return null;
    const priority = payload[0];
    const identLen = payload[1];
    const ident = payload.subarray(2, 2 + identLen).toString("utf-8").replaceAll("\0", "");
    const msg = payload.subarray(2 + identLen).toString("utf-8").replaceAll("\0", "");
    let severity: "err" | "wrn" | "inf" | "dbg";
    if (priority <= 3) {
      severity = "err";
    } else if (priority <= 4) {
      severity = "wrn";
    } else if (priority <= 6) {
      severity = "inf";
    } else {
      severity = "dbg";
    }
    return { pktType: "MON", message: `[${ident}] ${msg}`, severity };
  }

  private handleNewIndex(payload: Buffer): ParsedFields {
    const message = payload.length >= 16
      ? `HCI Index: ${payload.subarray(8, 16).toString("utf-8").replaceAll("\0", "")}`
      : "HCI Index registered";
    return { message, severity: "inf" };
  }

  private handleUnknown(opcode: number, payload: Buffer): ParsedFields {
    return {
      direction: "",
      pktType: "SYS",
      message: `BT Monitor opcode 0x${opcode.toString(16).padStart(2, "0")} (${payload.length}B)`,
      severity: "dbg",
    };
  }
}
