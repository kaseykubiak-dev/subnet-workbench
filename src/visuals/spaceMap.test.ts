import { describe, expect, it } from "vitest";

import { ipToNumber, numberToIp } from "../engine/ipv4";
import type { Subnet } from "../engine/ipv4";
import { parseSubnetList } from "../engine/parse";
import { findOverlaps } from "../modes/overlap";
import {
  MIN_BAR_W,
  commonParent,
  groupSubnets,
  renderSpaceMap,
} from "./spaceMap";

const subnet = (ip: string, prefix: number): Subnet => {
  const n = ipToNumber(ip);
  if (n === null) throw new Error(`bad fixture ip: ${ip}`);
  return { network: n, prefix };
};

const parsed = (text: string) => parseSubnetList(text).subnets;

describe("commonParent", () => {
  it("joins adjacent /24 siblings under their /23", () => {
    const p = commonParent(subnet("10.0.0.0", 24), subnet("10.0.1.0", 24));
    expect(numberToIp(p.network)).toBe("10.0.0.0");
    expect(p.prefix).toBe(23);
  });

  it("returns the parent itself for a contained subnet", () => {
    const p = commonParent(subnet("10.0.0.0", 16), subnet("10.0.5.0", 24));
    expect(numberToIp(p.network)).toBe("10.0.0.0");
    expect(p.prefix).toBe(16);
  });

  it("falls to /0 for unrelated spaces", () => {
    const p = commonParent(subnet("10.0.0.0", 8), subnet("192.168.0.0", 16));
    expect(p.prefix).toBe(0);
  });
});

describe("groupSubnets", () => {
  it("groups nearby subnets and separates distant ones", () => {
    const groups = groupSubnets(
      parsed("10.0.0.0/24\n10.0.1.0/24\n192.168.0.0/24")
    );
    expect(groups).toHaveLength(2);
    expect(numberToIp(groups[0]!.parent.network)).toBe("10.0.0.0");
    expect(groups[0]!.parent.prefix).toBe(23);
    expect(groups[0]!.members).toHaveLength(2);
    expect(groups[1]!.parent.prefix).toBe(24);
  });

  it("always co-groups conflict partners", () => {
    const groups = groupSubnets(parsed("10.0.0.0/16\n10.0.5.0/24"));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parent.prefix).toBe(16);
  });

  it("keeps groups apart when the merge would go broader than /16", () => {
    const groups = groupSubnets(parsed("10.1.0.0/16\n10.200.0.0/16"));
    expect(groups).toHaveLength(2);
  });

  it("returns one group per subnet when nothing merges", () => {
    const groups = groupSubnets(parsed("10.0.0.0/24"));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(1);
  });
});

describe("renderSpaceMap", () => {
  it("renders an empty-state message with no subnets", () => {
    const svg = renderSpaceMap(findOverlaps([]));
    expect(svg).toContain("Nothing to map yet.");
  });

  it("shows the all-clear tag when there are no conflicts", () => {
    const svg = renderSpaceMap(findOverlaps(parsed("10.0.0.0/24\n10.0.1.0/24")));
    expect(svg).toContain("NO CONFLICTS");
    expect(svg).not.toContain("conflict-band");
  });

  it("draws a warning band and WARN tags for containment", () => {
    const svg = renderSpaceMap(findOverlaps(parsed("10.0.0.0/16\n10.0.5.0/24")));
    expect(svg).toContain(`data-role="conflict-band"`);
    expect(svg).toContain(`data-severity="warning"`);
    expect(svg).toContain("url(#swb-hatch)");
    expect(svg).toContain(">WARN</text>");
  });

  it("marks duplicates as errors with the error hatch", () => {
    const svg = renderSpaceMap(findOverlaps(parsed("10.0.0.0/24\n10.0.0.0/24")));
    expect(svg).toContain(`data-severity="error"`);
    expect(svg).toContain("url(#swb-hatch-err)");
    expect(svg).toContain(">ERROR</text>");
  });

  it("clamps tiny spans to the minimum bar width", () => {
    const svg = renderSpaceMap(findOverlaps(parsed("10.0.0.0/16\n10.0.0.1/32")));
    const match = svg.match(/data-subnet="10\.0\.0\.1\/32"[^>]*/);
    // width renders before data-subnet in attr order; re-find the rect.
    const rect = svg
      .split("<rect")
      .find((chunk) => chunk.includes(`data-subnet="10.0.0.1/32"`));
    expect(rect).toBeDefined();
    expect(rect).toContain(`width="${MIN_BAR_W}"`);
    expect(match).not.toBeNull();
  });

  it("escapes user labels", () => {
    const svg = renderSpaceMap(findOverlaps(parsed("Bad<label>: 10.9.0.0/24")));
    expect(svg).toContain("Bad&lt;label&gt;");
    expect(svg).not.toContain("<label>");
  });

  it("renders a header per group with the parent CIDR", () => {
    const svg = renderSpaceMap(
      findOverlaps(parsed("10.0.0.0/24\n10.0.1.0/24\n192.168.0.0/24"))
    );
    expect(svg).toContain(">10.0.0.0/23</text>");
    expect(svg).toContain(">192.168.0.0/24</text>");
  });
});
