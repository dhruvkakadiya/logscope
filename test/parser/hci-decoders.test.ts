import {
  decodeCommand,
  decodeEvent,
  decodeAcl,
} from "../../src/parser/hci-decoders";

// ---------------------------------------------------------------------------
// Command decoders
// ---------------------------------------------------------------------------

describe("decodeCommand", () => {
  it("decodes Disconnect command", () => {
    // opcode 0x0406, paramLen=3, handle=0x0040, reason=0x13 (Remote User Terminated)
    const payload = Buffer.from([
      0x06, 0x04, // opcode LE
      0x03, // param length
      0x40, 0x00, // handle
      0x13, // reason
    ]);
    const result = decodeCommand(0x0406, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.summary).toContain("Remote User Terminated");
    expect(result!.fields.find((f) => f.name === "Handle")?.value).toBe(
      "0x0040"
    );
    // Non-zero reason should have error color
    const reasonField = result!.fields.find((f) => f.name === "Reason");
    expect(reasonField?.color).toBe("#f44747");
  });

  it("decodes LE Set PHY command", () => {
    // opcode 0x2032, paramLen=7, handle=0x0001, allPhys=0x00, txPhy=2 (2M), rxPhy=2 (2M)
    const payload = Buffer.from([
      0x32, 0x20, // opcode LE
      0x07, // param length
      0x01, 0x00, // handle
      0x00, // all phys
      0x02, // tx phy: 2M
      0x02, // rx phy: 2M
    ]);
    const result = decodeCommand(0x2032, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("(tx: 2M, rx: 2M)");
    expect(result!.fields.find((f) => f.name === "TX PHY")?.value).toBe("2M");
    expect(result!.fields.find((f) => f.name === "RX PHY")?.value).toBe("2M");
  });

  it("decodes LE Set Random Address command", () => {
    const payload = Buffer.from([
      0x05, 0x20, // opcode LE
      0x06, // param length
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // address (LE byte order)
    ]);
    const result = decodeCommand(0x2005, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("66:55:44:33:22:11");
    expect(result!.fields[0].color).toBe("#3794ff");
  });

  it("returns null for unrecognized command opcode", () => {
    const payload = Buffer.from([0x00, 0x00, 0x00]);
    expect(decodeCommand(0x9999, payload)).toBeNull();
  });

  it("returns null for truncated Disconnect payload", () => {
    const payload = Buffer.from([0x06, 0x04, 0x03, 0x40]);
    expect(decodeCommand(0x0406, payload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event decoders
// ---------------------------------------------------------------------------

describe("decodeEvent", () => {
  it("decodes Disconnection Complete event", () => {
    const payload = Buffer.from([
      0x05, // event code
      0x04, // param length
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x16, // reason: Connection Terminated by Local Host
    ]);
    const result = decodeEvent(0x05, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.summary).toContain("Connection Terminated by Local Host");
    // Success status should have no color
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBeUndefined();
    // Non-zero reason should have error color
    const reasonField = result!.fields.find((f) => f.name === "Reason");
    expect(reasonField?.color).toBe("#f44747");
  });

  it("decodes Command Complete event", () => {
    const payload = Buffer.from([
      0x0e, // event code
      0x04, // param length
      0x01, // num packets
      0x03, 0x0c, // opcode: Reset (0x0C03)
      0x00, // status: Success
    ]);
    const result = decodeEvent(0x0e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Reset");
    expect(result!.summary).toContain("Success");
  });

  it("decodes Command Status event with error", () => {
    const payload = Buffer.from([
      0x0f, // event code
      0x04, // param length
      0x0c, // status: Command Disallowed
      0x01, // num packets
      0x0d, 0x20, // opcode: LE Create Connection (0x200D)
    ]);
    const result = decodeEvent(0x0f, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("LE Create Connection");
    expect(result!.summary).toContain("Command Disallowed");
    const statusField = result!.fields.find((f) => f.name === "Status");
    expect(statusField?.color).toBe("#f44747");
  });

  it("decodes LE Connection Complete event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x13, // param length
      0x01, // subevent: Connection Complete
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x01, // role: Peripheral
      0x01, // peer addr type: Random
      0x27, 0xd3, 0xc7, 0x90, 0xa4, 0x74, // peer address (LE byte order)
      0x18, 0x00, // interval: 24
      0x00, 0x00, // latency: 0
      0x48, 0x00, // timeout: 72
      0x00, // clock accuracy
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("0x0040");
    expect(result!.fields.find((f) => f.name === "Role")?.value).toBe(
      "Peripheral"
    );
    expect(
      result!.fields.find((f) => f.name === "Peer Address")?.value
    ).toBe("74:A4:90:C7:D3:27");
    expect(
      result!.fields.find((f) => f.name === "Peer Address")?.color
    ).toBe("#3794ff");
  });

  it("decodes LE PHY Update Complete event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x06, // param length
      0x0c, // subevent: PHY Update Complete
      0x00, // status: Success
      0x40, 0x00, // handle: 0x0040
      0x02, // tx phy: 2M
      0x01, // rx phy: 1M
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("(tx: 2M, rx: 1M)");
    expect(result!.fields.find((f) => f.name === "TX PHY")?.value).toBe("2M");
    expect(result!.fields.find((f) => f.name === "RX PHY")?.value).toBe("1M");
  });

  it("decodes LE Data Length Change event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x0b, // param length
      0x07, // subevent: Data Length Change
      0x40, 0x00, // handle: 0x0040
      0xfb, 0x00, // max tx octets: 251
      0x48, 0x08, // max tx time: 2120
      0xfb, 0x00, // max rx octets: 251
      0x48, 0x08, // max rx time: 2120
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("251 bytes/2120us");
  });

  it("decodes LE Advertising Report event", () => {
    const payload = Buffer.from([
      0x3e, // event code: LE Meta
      0x0f, // param length
      0x02, // subevent: Advertising Report
      0x01, // num reports
      0x00, // event type
      0x01, // addr type: Random
      0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, // address (LE byte order)
      0x02, // data length
      0x01, 0x06, // ad data
      0xc8, // RSSI: -56 dBm (signed)
    ]);
    const result = decodeEvent(0x3e, payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("FF:EE:DD:CC:BB:AA");
    expect(result!.summary).toContain("-56 dBm");
  });

  it("returns null for unrecognized event code", () => {
    const payload = Buffer.from([0xaa, 0x00]);
    expect(decodeEvent(0xaa, payload)).toBeNull();
  });

  it("returns null for unrecognized LE Meta subevent", () => {
    const payload = Buffer.from([0x3e, 0x01, 0xff]);
    expect(decodeEvent(0x3e, payload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ACL decoder
// ---------------------------------------------------------------------------

describe("decodeAcl", () => {
  it("decodes ATT Write Request", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x09, 0x00, // ACL data length: 9
      0x05, 0x00, // L2CAP length: 5
      0x04, 0x00, // CID: 0x0004 (ATT)
      0x12, // ATT opcode: Write Request
      0x15, 0x00, // ATT handle: 0x0015
      0x01, 0x00, // value: [0x01, 0x00]
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("handle:0x0040");
    expect(result!.summary).toContain("ATT Write Request");
    expect(result!.summary).toContain("0x0015");
    expect(result!.fields.find((f) => f.name === "ATT Handle")?.value).toBe(
      "0x0015"
    );
    expect(
      result!.fields.find((f) => f.name === "Value")?.value
    ).toBe("01 00");
  });

  it("decodes ATT Exchange MTU Request", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x05, 0x00, // ACL data length: 5
      0x03, 0x00, // L2CAP length: 3
      0x04, 0x00, // CID: 0x0004 (ATT)
      0x02, // ATT opcode: Exchange MTU Request
      0xf7, 0x00, // MTU: 247
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("ATT Exchange MTU");
    expect(result!.summary).toContain("247");
  });

  it("decodes ATT Handle Value Notification", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x07, 0x00, // ACL data length
      0x05, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0x1b, // ATT opcode: Handle Value Notification
      0x16, 0x00, // ATT handle: 0x0016
      0xab, 0xcd, // notification data
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("ATT Notification");
    expect(result!.summary).toContain("0x0016");
  });

  it("decodes non-ATT L2CAP CID", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle: 0x0040
      0x06, 0x00, // ACL data length
      0x02, 0x00, // L2CAP length: 2
      0x05, 0x00, // CID: 0x0005 (LE Signaling)
      0x12, 0x34, // data
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("L2CAP CID:0x0005");
    expect(result!.summary).toContain("2 bytes");
  });

  it("decodes unknown ATT opcode gracefully", () => {
    const payload = Buffer.from([
      0x40, 0x00, // handle
      0x05, 0x00, // ACL data length
      0x01, 0x00, // L2CAP length
      0x04, 0x00, // CID: ATT
      0xff, // unknown ATT opcode
    ]);
    const result = decodeAcl(payload);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("handle:0x0040");
    expect(result!.summary).toContain("ATT");
  });

  it("returns null for truncated ACL packet", () => {
    const payload = Buffer.from([0x40, 0x00, 0x05]);
    expect(decodeAcl(payload)).toBeNull();
  });
});
