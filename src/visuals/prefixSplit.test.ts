import { describe, expect, it } from "vitest";

import { ipToNumber } from "../engine/ipv4";
import type { Subnet } from "../engine/ipv4";
import { MAX_BLOCKS, blockLabel, renderPrefixSplit } from "./prefixSplit";

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const subnet = (ip: string, prefix: number): Subnet => {
  const n = ipToNumber(ip);
  if (n === null) throw new Error(`bad fixture ip: ${ip}`);
  return { network: n, prefix };
};

describe("blockLabel", () => {
  it("shows the dotted tail from the first octet the split can change", () => {
    const n = ipToNumber("10.0.0.64");
    if (n === null) throw new Error("bad fixture");
    expect(blockLabel(n, 24)).toBe(".64");
  });

  it("spans octets when the supernet boundary sits mid-address", () => {
    const n = ipToNumber("10.0.4.0");
    if (n === null) throw new Error("bad fixture");
    expect(blockLabel(n, 16)).toBe(".4.0");
  });

  it("uses the full quad when splitting from /0", () => {
    const n = ipToNumber("128.0.0.0");
    if (n === null) throw new Error("bad fixture");
    expect(blockLabel(n, 0)).toBe("128.0.0.0");
  });
});

describe("renderPrefixSplit", () => {
  const svg = renderPrefixSplit(subnet("10.0.0.0", 24), 26);

  it("renders one block per resulting subnet", () => {
    expect(count(svg, "data-block=")).toBe(4);
    for (const b of ["10.0.0.0", "10.0.0.64", "10.0.0.128", "10.0.0.192"]) {
      expect(svg).toContain(`data-block="${b}"`);
    }
  });

  it("labels blocks with the dotted tail", () => {
    for (const label of [".0", ".64", ".128", ".192"]) {
      expect(svg).toContain(`>${label}</text>`);
    }
  });

  it("summarizes the split in the header", () => {
    expect(svg).toContain("10.0.0.0/24");
    expect(svg).toContain("-&gt; 4 x /26");
  });

  it("draws a ghost line per block for the next split", () => {
    expect(count(svg, `data-role="ghost"`)).toBe(4);
  });

  it("reports the per-block address count", () => {
    expect(svg).toContain("64 addresses per /26");
  });

  it("caps rendering at MAX_BLOCKS with a truncation cell", () => {
    const big = renderPrefixSplit(subnet("10.0.0.0", 8), 16);
    expect(count(big, "data-block=")).toBe(MAX_BLOCKS - 1);
    expect(big).toContain(`+${256 - (MAX_BLOCKS - 1)} more`);
  });

  it("omits ghost lines when the target is /32", () => {
    const tiny = renderPrefixSplit(subnet("10.0.0.0", 30), 32);
    expect(count(tiny, `data-role="ghost"`)).toBe(0);
  });

  it("handles the no-op split (target equals supernet prefix)", () => {
    const same = renderPrefixSplit(subnet("10.0.0.0", 24), 24);
    expect(count(same, "data-block=")).toBe(1);
    expect(same).toContain("-&gt; 1 x /24");
  });
});
