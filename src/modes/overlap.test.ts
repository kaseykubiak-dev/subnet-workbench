import { describe, expect, it } from "vitest";
import { numberToIp } from "../engine/ipv4";
import { parseSubnetList } from "../engine/parse";
import { describeConflict, findOverlaps, renderOverlapText } from "./overlap";

const run = (text: string) => findOverlaps(parseSubnetList(text).subnets);

describe("findOverlaps: conflict detection", () => {
  it("flags identical subnets as errors", () => {
    const r = run("Knoxville: 10.0.0.0/24\nNashville: 10.0.0.0/24");
    expect(r.status).toBe("conflicts");
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c?.kind).toBe("identical");
    expect(c?.severity).toBe("error");
    expect(numberToIp(c?.range.first ?? 0)).toBe("10.0.0.0");
    expect(numberToIp(c?.range.last ?? 0)).toBe("10.0.0.255");
  });

  it("flags containment as a warning, both directions", () => {
    const r1 = run("Summary: 10.0.0.0/8\nBranch: 10.5.0.0/24");
    expect(r1.conflicts[0]?.kind).toBe("a-contains-b");
    expect(r1.conflicts[0]?.severity).toBe("warning");

    const r2 = run("Branch: 10.5.0.0/24\nSummary: 10.0.0.0/8");
    expect(r2.conflicts[0]?.kind).toBe("b-contains-a");
    expect(describeConflict(r2.conflicts[0]!)).toMatch(/^Summary \(10\.0\.0\.0\/8\) contains Branch/);
  });

  it("containment range is the smaller block", () => {
    const r = run("10.0.0.0/8\n10.5.5.0/24");
    expect(numberToIp(r.conflicts[0]?.range.first ?? 0)).toBe("10.5.5.0");
    expect(numberToIp(r.conflicts[0]?.range.last ?? 0)).toBe("10.5.5.255");
  });

  it("reports every conflicting pair once", () => {
    // Three identical /16s: 3 pairs.
    const r = run("A: 172.16.0.0/16\nB: 172.16.0.0/16\nC: 172.16.0.0/16");
    expect(r.conflicts).toHaveLength(3);
  });

  it("sorts worst-first: identical errors before containment warnings", () => {
    const r = run(
      ["Super: 10.0.0.0/8", "SiteA: 10.1.0.0/16", "Dup1: 192.168.0.0/24", "Dup2: 192.168.0.0/24"].join("\n")
    );
    expect(r.conflicts[0]?.kind).toBe("identical");
    expect(r.conflicts.slice(1).every((c) => c.severity === "warning")).toBe(true);
  });

  it("uses the CIDR as display name when a label is missing", () => {
    const r = run("10.0.0.0/24\n10.0.0.0/25");
    expect(describeConflict(r.conflicts[0]!)).toMatch(/^10\.0\.0\.0\/24 \(10\.0\.0\.0\/24\) contains 10\.0\.0\.0\/25/);
  });
});

describe("findOverlaps: clean and empty states", () => {
  it("all-clear is explicit and counts the subnets", () => {
    const r = run("10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/24");
    expect(r.status).toBe("all-clear");
    expect(r.summary).toBe("No conflicts across 3 subnets.");
    expect(r.conflicts).toHaveLength(0);
  });

  it("adjacent subnets do not conflict", () => {
    const r = run("192.168.0.0/25\n192.168.0.128/25");
    expect(r.status).toBe("all-clear");
  });

  it("empty and single-entry lists are their own non-error state", () => {
    expect(findOverlaps([]).status).toBe("empty");
    expect(findOverlaps([]).summary).toMatch(/no subnets/);
    const one = run("10.0.0.0/24");
    expect(one.status).toBe("empty");
    expect(one.summary).toMatch(/only one subnet/);
  });
});

describe("findOverlaps: summary wording", () => {
  it("counts errors and warnings", () => {
    const r = run(
      [
        "Super: 10.0.0.0/8",
        "SiteA: 10.1.0.0/16",
        "SiteB: 10.2.0.0/16",
        "Dup1: 192.168.0.0/24",
        "Dup2: 192.168.0.0/24",
      ].join("\n")
    );
    expect(r.summary).toBe("3 conflicts across 5 subnets (1 error, 2 warnings).");
  });

  it("singular forms read correctly", () => {
    const r = run("A: 10.0.0.0/24\nB: 10.0.0.0/24");
    expect(r.summary).toBe("1 conflict across 2 subnets (1 error).");
  });
});

describe("renderOverlapText", () => {
  it("renders summary then severity-tagged rows", () => {
    const text = renderOverlapText(
      run("Super: 10.0.0.0/8\nSiteA: 10.1.0.0/16\nDup1: 192.168.0.0/24\nDup2: 192.168.0.0/24")
    );
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^2 conflicts/);
    expect(lines[1]).toMatch(/^ERROR {4}Dup1/);
    expect(lines[2]).toMatch(/^WARNING {2}Super/);
  });
});

describe("findOverlaps: scale", () => {
  it("handles thousands of subnets in reasonable time", () => {
    // 2,048 disjoint /24s under 10.0.0.0/8: ~2.1M pairwise checks.
    const lines: string[] = [];
    for (let i = 0; i < 2048; i++) {
      lines.push(`Site ${i}: 10.${Math.floor(i / 256)}.${i % 256}.0/24`);
    }
    const start = Date.now();
    const r = findOverlaps(parseSubnetList(lines.join("\n")).subnets);
    const elapsed = Date.now() - start;
    expect(r.status).toBe("all-clear");
    expect(r.summary).toBe("No conflicts across 2048 subnets.");
    expect(elapsed).toBeLessThan(5000);
  });
});
