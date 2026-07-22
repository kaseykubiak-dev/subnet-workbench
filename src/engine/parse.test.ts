import { describe, expect, it } from "vitest";
import { ipToNumber, numberToIp } from "./ipv4";
import { parseSubnetLine, parseSubnetList, type ParsedSubnet } from "./parse";

const ip = (s: string): number => {
  const n = ipToNumber(s);
  if (n === null) throw new Error(`bad test ip: ${s}`);
  return n;
};

const ok = (line: string): ParsedSubnet => {
  const r = parseSubnetLine(line);
  if ("message" in r) throw new Error(`expected success, got: ${r.message}`);
  return r;
};

const err = (line: string): string => {
  const r = parseSubnetLine(line);
  if (!("message" in r)) throw new Error(`expected error for: ${line}`);
  return r.message;
};

describe("parseSubnetLine: accepted forms", () => {
  it("parses CIDR", () => {
    const s = ok("10.0.0.0/24");
    expect(numberToIp(s.network)).toBe("10.0.0.0");
    expect(s.prefix).toBe(24);
    expect(s.label).toBeUndefined();
  });

  it("parses mask notation (FortiGate style)", () => {
    const s = ok("10.0.0.0 255.255.255.0");
    expect(numberToIp(s.network)).toBe("10.0.0.0");
    expect(s.prefix).toBe(24);
  });

  it("parses the slash-mask hybrid", () => {
    const s = ok("10.0.0.0/255.255.255.0");
    expect(s.prefix).toBe(24);
    expect(numberToIp(s.network)).toBe("10.0.0.0");
  });

  it("parses a leading label with colon", () => {
    const s = ok("Site A: 10.0.0.0/24");
    expect(s.label).toBe("Site A");
    expect(s.prefix).toBe(24);
  });

  it("parses a trailing label", () => {
    const s = ok("10.0.0.0/24 Site A");
    expect(s.label).toBe("Site A");
  });

  it("parses a multi-word trailing label after mask notation", () => {
    const s = ok("172.16.4.0 255.255.252.0 Knoxville branch office");
    expect(s.label).toBe("Knoxville branch office");
    expect(s.prefix).toBe(22);
  });

  it("parses a leading label over mask notation", () => {
    const s = ok("Nashville DC: 10.20.0.0 255.255.0.0");
    expect(s.label).toBe("Nashville DC");
    expect(s.prefix).toBe(16);
  });

  it("preserves the entered address and normalizes host bits", () => {
    const s = ok("192.168.1.57/26");
    expect(numberToIp(s.address)).toBe("192.168.1.57");
    expect(numberToIp(s.network)).toBe("192.168.1.0");
  });

  it("handles /31 and /32 forms", () => {
    expect(ok("10.0.0.4/31").prefix).toBe(31);
    expect(ok("10.0.0.7/32").prefix).toBe(32);
    expect(ok("10.0.0.7 255.255.255.255").prefix).toBe(32);
  });

  it("handles /0", () => {
    const s = ok("0.0.0.0/0");
    expect(s.prefix).toBe(0);
    expect(s.network).toBe(0);
  });

  it("tolerates extra whitespace and tabs", () => {
    const s = ok("  10.0.0.0 \t 255.255.255.0 \t Lab  ");
    expect(s.prefix).toBe(24);
    expect(s.label).toBe("Lab");
  });

  it("allows slashes inside trailing labels", () => {
    const s = ok("10.1.0.0/24 Bldg 3/4 wing");
    expect(s.label).toBe("Bldg 3/4 wing");
  });
});

describe("parseSubnetLine: rejected forms", () => {
  it("rejects bad octets", () => {
    expect(err("10.0.0.256/24")).toMatch(/invalid address/);
    expect(err("300.1.1.1 255.255.255.0")).toMatch(/invalid address/);
  });

  it("rejects out-of-range prefixes", () => {
    expect(err("10.0.0.0/33")).toMatch(/out of range/);
    expect(err("10.0.0.0/99")).toMatch(/out of range/);
  });

  it("rejects non-contiguous masks in both mask forms", () => {
    expect(err("10.0.0.0 255.0.255.0")).toMatch(/non-contiguous/);
    expect(err("10.0.0.0/255.0.255.0")).toMatch(/non-contiguous/);
  });

  it("rejects a bare IP with a helpful message", () => {
    expect(err("10.0.0.1")).toMatch(/no prefix or mask/);
    expect(err("10.0.0.1 someword")).toMatch(/no prefix or mask/);
  });

  it("rejects garbage", () => {
    expect(err("hello world")).toMatch(/invalid address/);
    expect(err("10.0.0.0/abc")).toMatch(/invalid prefix or mask/);
  });

  it("rejects empty or malformed label constructions", () => {
    expect(err(": 10.0.0.0/24")).toMatch(/empty label/);
    expect(err("Site A:")).toMatch(/nothing after the label/);
    expect(err("Site A: 10.0.0.0/24 trailing junk")).toMatch(/unexpected trailing text/);
  });
});

describe("parseSubnetList", () => {
  it("parses a mixed paste, flags bad lines, and proceeds", () => {
    const text = [
      "# customer sites",
      "Knoxville: 10.10.0.0/16",
      "",
      "10.20.0.0 255.255.0.0 Nashville DC",
      "10.30.0.0/255.255.240.0",
      "10.40.0.0/33",
      "not a subnet",
      "10.50.0.4/31 tunnel p2p",
    ].join("\n");
    const { subnets, errors } = parseSubnetList(text);

    expect(subnets).toHaveLength(4);
    expect(errors).toHaveLength(2);

    expect(subnets[0]?.label).toBe("Knoxville");
    expect(subnets[1]?.label).toBe("Nashville DC");
    expect(subnets[2]?.prefix).toBe(20);
    expect(subnets[3]?.label).toBe("tunnel p2p");

    // Errors carry the right 1-based line numbers and raw text.
    expect(errors[0]?.lineNumber).toBe(6);
    expect(errors[0]?.raw).toBe("10.40.0.0/33");
    expect(errors[1]?.lineNumber).toBe(7);
    expect(errors[1]?.raw).toBe("not a subnet");
  });

  it("records line numbers on successes too", () => {
    const { subnets } = parseSubnetList("\n\n10.0.0.0/8\n");
    expect(subnets[0]?.lineNumber).toBe(3);
  });

  it("skips blank and comment lines silently", () => {
    const { subnets, errors } = parseSubnetList("\n  \n# comment\n// also comment\n");
    expect(subnets).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("handles CRLF line endings", () => {
    const { subnets, errors } = parseSubnetList("10.0.0.0/24\r\n10.0.1.0/24\r\n");
    expect(subnets).toHaveLength(2);
    expect(errors).toHaveLength(0);
    expect(numberToIp(subnets[1]?.network ?? 0)).toBe("10.0.1.0");
  });

  it("returns empty results for an empty paste", () => {
    const { subnets, errors } = parseSubnetList("");
    expect(subnets).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("normalizes each entry against its own mask", () => {
    const { subnets } = parseSubnetList("10.5.5.5/16 SiteX");
    expect(numberToIp(subnets[0]?.network ?? 0)).toBe("10.5.0.0");
    expect(numberToIp(subnets[0]?.address ?? 0)).toBe("10.5.5.5");
    expect(subnets[0]?.address).toBe(ip("10.5.5.5"));
  });
});
