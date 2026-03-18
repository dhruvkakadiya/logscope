/**
 * HCI command and event opcode → friendly name mappings.
 * Used by the HCI parser to display human-readable packet descriptions.
 */

// HCI Command opcodes (OGF << 10 | OCF)
export const HCI_COMMANDS: Record<number, string> = {
  // Link Control (OGF 0x01)
  0x0401: "Inquiry",
  0x0402: "Inquiry Cancel",
  0x0403: "Periodic Inquiry Mode",
  0x0405: "Create Connection",
  0x0406: "Disconnect",
  0x0408: "Accept Connection Request",
  0x0409: "Reject Connection Request",
  0x040B: "Link Key Request Reply",
  0x040D: "PIN Code Request Reply",
  0x0419: "Remote Name Request",

  // Controller & Baseband (OGF 0x03)
  0x0C01: "Set Event Mask",
  0x0C03: "Reset",
  0x0C05: "Set Event Filter",
  0x0C0D: "Write Local Name",
  0x0C13: "Write Scan Enable",
  0x0C1A: "Write Authentication Enable",
  0x0C23: "Read Class of Device",
  0x0C24: "Write Class of Device",
  0x0C33: "Host Buffer Size",
  0x0C35: "Read Current IAC LAP",
  0x0C3A: "Write Current IAC LAP",
  0x0C6D: "Write LE Host Support",
  0x0C63: "Set Event Mask Page 2",

  // Informational (OGF 0x04)
  0x1001: "Read Local Version Information",
  0x1002: "Read Local Supported Commands",
  0x1003: "Read Local Supported Features",
  0x1009: "Read BD ADDR",

  // Status (OGF 0x05)
  0x1401: "Read RSSI",

  // LE Controller (OGF 0x08)
  0x2001: "LE Set Event Mask",
  0x2002: "LE Read Buffer Size",
  0x2003: "LE Read Local Supported Features",
  0x2005: "LE Set Random Address",
  0x2006: "LE Set Advertising Parameters",
  0x2007: "LE Read Advertising Channel TX Power",
  0x2008: "LE Set Advertising Data",
  0x2009: "LE Set Scan Response Data",
  0x200A: "LE Set Advertising Enable",
  0x200B: "LE Set Scan Parameters",
  0x200C: "LE Set Scan Enable",
  0x200D: "LE Create Connection",
  0x200E: "LE Create Connection Cancel",
  0x200F: "LE Read Filter Accept List Size",
  0x2010: "LE Clear Filter Accept List",
  0x2011: "LE Add Device to Filter Accept List",
  0x2012: "LE Remove Device from Filter Accept List",
  0x2013: "LE Connection Update",
  0x2014: "LE Set Host Channel Classification",
  0x2015: "LE Read Channel Map",
  0x2016: "LE Read Remote Features",
  0x2017: "LE Encrypt",
  0x2018: "LE Rand",
  0x2019: "LE Enable Encryption",
  0x201A: "LE Long Term Key Request Reply",
  0x201B: "LE Long Term Key Request Negative Reply",
  0x201C: "LE Read Supported States",
  0x2025: "LE Read Local P-256 Public Key",
  0x2026: "LE Generate DHKey",
  0x2027: "LE Add Device to Resolving List",
  0x2029: "LE Clear Resolving List",
  0x202B: "LE Set Address Resolution Enable",
  0x202D: "LE Set Resolvable Private Address Timeout",
  0x202E: "LE Read Maximum Data Length",
  0x2030: "LE Read PHY",
  0x2031: "LE Set Default PHY",
  0x2032: "LE Set PHY",
  0x2036: "LE Set Extended Advertising Parameters",
  0x2037: "LE Set Extended Advertising Data",
  0x2038: "LE Set Extended Scan Response Data",
  0x2039: "LE Set Extended Advertising Enable",
  0x203E: "LE Read Maximum Advertising Data Length",
  0x2041: "LE Set Extended Scan Parameters",
  0x2042: "LE Set Extended Scan Enable",
  0x2043: "LE Extended Create Connection",
  0x204E: "LE Set Data Length",
  0x2060: "LE Read Buffer Size v2",
  0x2064: "LE Extended Create Connection v2",
  0x2082: "LE Set Extended Advertising Parameters v2",
};

// HCI Event codes
export const HCI_EVENTS: Record<number, string> = {
  0x01: "Inquiry Complete",
  0x02: "Inquiry Result",
  0x03: "Connection Complete",
  0x04: "Connection Request",
  0x05: "Disconnection Complete",
  0x06: "Authentication Complete",
  0x07: "Remote Name Request Complete",
  0x08: "Encryption Change",
  0x0B: "Read Remote Supported Features Complete",
  0x0C: "Read Remote Version Information Complete",
  0x0E: "Command Complete",
  0x0F: "Command Status",
  0x10: "Hardware Error",
  0x13: "Number of Completed Packets",
  0x1A: "Data Buffer Overflow",
  0x30: "Encryption Key Refresh Complete",
  0x3E: "LE Meta Event",
  0xFF: "Vendor Specific",
};

// LE Meta subevent codes
export const LE_META_EVENTS: Record<number, string> = {
  0x01: "LE Connection Complete",
  0x02: "LE Advertising Report",
  0x03: "LE Connection Update Complete",
  0x04: "LE Read Remote Features Complete",
  0x05: "LE Long Term Key Request",
  0x06: "LE Remote Connection Parameter Request",
  0x07: "LE Data Length Change",
  0x08: "LE Read Local P-256 Public Key Complete",
  0x09: "LE Generate DHKey Complete",
  0x0A: "LE Enhanced Connection Complete",
  0x0B: "LE Directed Advertising Report",
  0x0C: "LE PHY Update Complete",
  0x0D: "LE Extended Advertising Report",
  0x12: "LE Channel Selection Algorithm",
  0x19: "LE CIS Established",
  0x1A: "LE CIS Request",
  0x27: "LE Subrate Change",
};

/** Look up a friendly name for an HCI command opcode. */
export function commandName(opcode: number): string {
  return HCI_COMMANDS[opcode] ?? `Unknown Command (0x${opcode.toString(16).padStart(4, "0")})`;
}

/** Look up a friendly name for an HCI event code, including LE Meta subevent. */
export function eventName(eventCode: number, payload?: Uint8Array): string {
  if (eventCode === 0x3E && payload && payload.length > 0) {
    const subevent = payload[0];
    const sub = LE_META_EVENTS[subevent] ?? `LE Subevent 0x${subevent.toString(16).padStart(2, "0")}`;
    return sub;
  }
  return HCI_EVENTS[eventCode] ?? `Unknown Event (0x${eventCode.toString(16).padStart(2, "0")})`;
}
