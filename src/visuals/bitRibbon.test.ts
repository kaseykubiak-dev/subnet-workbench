import { describe, expect, it } from "vitest";

import { ipToNumber } from "../engine/ipv4";
import { bitX, boundaryX, renderBitRibbon } from "./bitRibbon";

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const addr = (ip: string): number => {
  const n = ipToNumber(ip);
  if (n === null) throw new Error(`bad fixture ip: ${ip}`);
  return n;
};

describe("geometry", () => {
  it("places bit 0 at the left margin", () => {
    expect(bitX(0)).toBe(24);
  });

  it("adds the octet gap after each group of 8", () => {
    expect(bitX(7)).toBe(24 + 7 * 28); // last bit of octet 1: no gap yet
    expect(bitX(8)).toBe(24 + 8 * 28 + 16); // first bit of octet 2
  });

  it("puts the /26 boundary at x=798", () => {
    expect(boundaryX(26)).toBe(798);
  });
});

describe("renderBitRibbon", () => {
  const svg = renderBitRibbon(addr("192.168.1.0"), 26);

  it("colors exactly prefix cells as network bits", () => {
    expect(count(svg, `data-bit-role="net"`)).toBe(26);
    expect(count(svg, `data-bit-role="host"`)).toBe(6);
  });

  it("draws the boundary line at the computed x", () => {
    expect(svg).toContain(`x1="798"`);
    expect(svg).toContain(`data-role="boundary"`);
    expect(svg).toContain(`>/26</text>`);
  });

  it("labels the octet decimal values", () => {
    for (const octet of ["192", "168", "1", "0"]) {
      expect(svg).toContain(`>${octet}</text>`);
    }
  });

  it("renders both brackets for a mid-range prefix", () => {
    expect(svg).toContain("NETWORK (26 bits)");
    expect(svg).toContain("HOST (6 bits)");
  });

  it("writes the address bits into the cells", () => {
    // 192 = 11000000: two 1-bits, 168 = 10101000: three, 1 = 00000001: one,
    // 0: none. Six 1-bits total. Match only bit cells (data-role="bit") so
    // the octet decimal label "1" cannot inflate the count.
    const oneBits = svg.match(/data-role="bit"[^>]*>1</g) ?? [];
    const zeroBits = svg.match(/data-role="bit"[^>]*>0</g) ?? [];
    expect(oneBits).toHaveLength(6);
    expect(zeroBits).toHaveLength(26);
  });

  it("skips the NETWORK bracket at /0", () => {
    const zero = renderBitRibbon(addr("10.0.0.0"), 0);
    expect(zero).not.toContain("NETWORK (");
    expect(zero).toContain("HOST (32 bits)");
  });

  it("skips the HOST bracket at /32", () => {
    const host = renderBitRibbon(addr("10.0.0.1"), 32);
    expect(host).toContain("NETWORK (32 bits)");
    expect(host).not.toContain("HOST (");
  });

  it("carries an accessible label", () => {
    expect(svg).toContain(`aria-label="Binary view of 192.168.1.0/26"`);
    expect(svg).toContain(`data-visual="bit-ribbon"`);
  });
});

describe("split-target caret marker", () => {
  it("draws the caret, drop line, and tag at the target boundary", () => {
    const svg = renderBitRibbon(addr("10.0.0.0"), 24, 28);
    expect(count(svg, `data-role="split-marker"`)).toBe(3);
    expect(svg).toContain(`>/28</text>`);
    // Drop line lands on the /28 boundary x.
    expect(svg).toContain(`x1="${boundaryX(28)}"`);
  });

  it("omits the marker when the target equals the prefix", () => {
    expect(renderBitRibbon(addr("10.0.0.0"), 24, 24)).not.toContain(
      "split-marker"
    );
  });

  it("omits the marker when no target is given", () => {
    expect(renderBitRibbon(addr("10.0.0.0"), 24)).not.toContain("split-marker");
  });

  it("clamps out-of-range targets away", () => {
    expect(renderBitRibbon(addr("10.0.0.0"), 24, 33)).not.toContain(
      "split-marker"
    );
  });
});
