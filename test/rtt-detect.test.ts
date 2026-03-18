import { parseRttAddressFromNmOutput } from "../src/rtt-detect";

describe("parseRttAddressFromNmOutput", () => {
  it("extracts RTT address from nm output", () => {
    const nmOutput = `00000001 A CONFIG_HAS_SEGGER_RTT
20004050 B _SEGGER_RTT
00000010 A CONFIG_SEGGER_RTT_CB_ALIGNMENT`;
    expect(parseRttAddressFromNmOutput(nmOutput)).toBe(0x20004050);
  });

  it("returns null when _SEGGER_RTT not found", () => {
    expect(parseRttAddressFromNmOutput("no rtt here")).toBeNull();
  });

  it("handles different address lengths", () => {
    const nmOutput = "20000450 B _SEGGER_RTT";
    expect(parseRttAddressFromNmOutput(nmOutput)).toBe(0x20000450);
  });
});
