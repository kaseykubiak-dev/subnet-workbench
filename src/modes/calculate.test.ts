import { describe, expect, it } from "vitest";
import { parseSubnetLine, type ParsedSubnet } from "../engine/parse";
import { calculate, formatCount, renderCalculateText } from "./calculate";

const parsed = (line: string): ParsedSubnet => {
  const r = parseSubnetLine(line);
  if ("message" in r) throw new Error(`bad test line: ${r.message}`);
  return r;
};

const field = (line: string, label: string): string => {
  const r = calculate(parsed(line));
  const f = r.fields.find((x) => x.label === label);
  if (!f) throw new Error(`missing field ${label}`);
  return f.value;
};

describe("calculate: standard derivation", () => {
  it("derives a /24 completely", () => {
    const r = calculate(parsed("192.168.1.0/24"));
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Network"]).toBe("192.168.1.0/24");
    expect(byLabel["Netmask"]).toBe("255.255.255.0");
    expect(byLabel["Wildcard"]).toBe("0.0.0.255");
    expect(byLabel["Broadcast"]).toBe("192.168.1.255");
    expect(byLabel["Usable range"]).toBe("192.168.1.1 - 192.168.1.254");
    expect(byLabel["Usable hosts"]).toBe("254");
    expect(byLabel["Total addresses"]).toBe("256");
    expect(byLabel["Address type"]).toBe("Private (RFC 1918)");
    expect(r.notes).toHaveLength(0);
  });

  it("includes the label as the first field when present", () => {
    const r = calculate(parsed("Core: 10.0.0.0/22"));
    expect(r.fields[0]).toEqual({ label: "Label", value: "Core" });
  });

  it("marks public space", () => {
    expect(field("203.0.113.0/24", "Address type")).toBe("Public");
  });

  it("groups large counts", () => {
    expect(field("10.0.0.0/8", "Usable hosts")).toBe("16,777,214");
    expect(formatCount(2 ** 32)).toBe("4,294,967,296");
  });
});

describe("calculate: special cases", () => {
  it("notes host bits and derives from the entered address", () => {
    const r = calculate(parsed("192.168.1.57/26"));
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Network"]).toBe("192.168.1.0/26");
    expect(r.notes[0]).toMatch(/192\.168\.1\.57 has host bits set/);
    expect(r.notes[0]).toMatch(/192\.168\.1\.0\/26/);
  });

  it("/31: no broadcast, both addresses usable, RFC 3021 note", () => {
    const r = calculate(parsed("10.0.0.4/31"));
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Broadcast"]).toBe("none (/31, RFC 3021)");
    expect(byLabel["Usable range"]).toBe("10.0.0.4 - 10.0.0.5");
    expect(byLabel["Usable hosts"]).toBe("2");
    expect(r.notes.some((n) => n.includes("RFC 3021"))).toBe(true);
  });

  it("/32: host route, single-address range", () => {
    const r = calculate(parsed("172.16.0.1/32"));
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Broadcast"]).toBe("none (host route)");
    expect(byLabel["Usable range"]).toBe("172.16.0.1");
    expect(byLabel["Usable hosts"]).toBe("1");
    expect(r.notes.some((n) => n.includes("host route"))).toBe(true);
  });

  it("/0 derives the whole space", () => {
    const r = calculate(parsed("0.0.0.0/0"));
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Broadcast"]).toBe("255.255.255.255");
    expect(byLabel["Total addresses"]).toBe("4,294,967,296");
    expect(byLabel["Address type"]).toBe("Public");
  });
});

describe("renderCalculateText", () => {
  it("renders aligned rows and notes", () => {
    const text = renderCalculateText(calculate(parsed("10.0.0.4/31 tunnel")));
    const lines = text.split("\n");
    expect(lines[0]).toBe("Label            tunnel");
    expect(lines).toContain("Network          10.0.0.4/31");
    expect(lines.at(-1)).toMatch(/^note: \/31 point-to-point/);
    // Every field row has the value starting at the same column.
    const valueCols = lines
      .filter((l) => !l.startsWith("note:"))
      .map((l) => l.search(/\s{2}\S/));
    expect(new Set(valueCols).size).toBe(1);
  });
});
