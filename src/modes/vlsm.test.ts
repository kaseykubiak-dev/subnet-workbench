import { describe, expect, it } from "vitest";
import { numberToIp } from "../engine/ipv4";
import { parseSubnetLine, type ParsedSubnet } from "../engine/parse";
import {
  allocateVlsm,
  allocationCidr,
  allocationRange,
  parseRequirementLine,
  parseRequirementList,
  prefixForHosts,
  renderVlsmText,
} from "./vlsm";

const supernet = (line: string): ParsedSubnet => {
  const r = parseSubnetLine(line);
  if ("message" in r) throw new Error(`bad test supernet: ${r.message}`);
  return r;
};

const run = (net: string, reqText: string, headroomPercent?: number) =>
  allocateVlsm(
    supernet(net),
    parseRequirementList(reqText).requirements,
    headroomPercent === undefined ? {} : { headroomPercent }
  );

describe("parseRequirementLine", () => {
  it("accepts comma, colon, and bare-count forms", () => {
    expect(parseRequirementLine("Engineering, 100 hosts")).toMatchObject({
      label: "Engineering",
      hosts: 100,
    });
    expect(parseRequirementLine("Ops: 20")).toMatchObject({ label: "Ops", hosts: 20 });
    expect(parseRequirementLine("12")).toMatchObject({ hosts: 12 });
    expect(parseRequirementLine("12")).not.toHaveProperty("label");
    expect(parseRequirementLine("Link, 1 host")).toMatchObject({ hosts: 1 });
  });

  it("rejects bad counts with specific messages", () => {
    expect(parseRequirementLine("Foo, abc")).toMatchObject({
      message: expect.stringContaining("not a host count"),
    });
    expect(parseRequirementLine("Foo,")).toMatchObject({
      message: expect.stringContaining("missing host count"),
    });
    expect(parseRequirementLine("Foo, 0")).toMatchObject({
      message: expect.stringContaining("at least 1"),
    });
    expect(parseRequirementLine("Foo, 4294967295")).toMatchObject({
      message: expect.stringContaining("exceeds the entire IPv4 address space"),
    });
  });

  it("list parsing skips blanks and comments, keeps line numbers", () => {
    const r = parseRequirementList("# plan\n\nA, 10\nbad line here\nB: 20\n");
    expect(r.requirements.map((x) => [x.label, x.hosts, x.lineNumber])).toEqual([
      ["A", 10, 3],
      ["B", 20, 5],
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.lineNumber).toBe(4);
  });
});

describe("prefixForHosts", () => {
  it("sizes to usable hosts, not raw powers of two", () => {
    expect(prefixForHosts(254)).toBe(24);
    expect(prefixForHosts(255)).toBe(23); // 254 usable in a /24 is not enough
    expect(prefixForHosts(100)).toBe(25);
    expect(prefixForHosts(3)).toBe(29);
  });

  it("honors RFC 3021 at the small end", () => {
    expect(prefixForHosts(2)).toBe(31);
    expect(prefixForHosts(1)).toBe(32);
  });
});

describe("allocateVlsm: clean allocation", () => {
  const r = run("10.0.0.0/24", "Engineering, 100 hosts\nSales, 50\nOps: 20\n12");

  it("allocates largest-first from the bottom of the supernet", () => {
    expect(r.status).toBe("allocated");
    expect(
      r.allocations.map((a) => [a.requirement.label ?? "(none)", allocationCidr(a)])
    ).toEqual([
      ["Engineering", "10.0.0.0/25"],
      ["Sales", "10.0.0.128/26"],
      ["Ops", "10.0.0.192/27"],
      ["(none)", "10.0.0.224/28"],
    ]);
  });

  it("reports capacity and usable range per allocation", () => {
    const eng = r.allocations[0]!;
    expect(eng.capacity).toBe(126);
    expect(allocationRange(eng)).toBe("10.0.0.1 - 10.0.0.126");
  });

  it("waste summary: allocated, stranded, free", () => {
    expect(r.waste.supernetSize).toBe(256);
    expect(r.waste.allocatedAddresses).toBe(240);
    expect(r.waste.strandedHosts).toBe(50); // 26 + 12 + 10 + 2
    expect(r.waste.freeAddresses).toBe(16);
  });

  it("summary line counts and sizes", () => {
    expect(r.summary).toBe(
      "4 requirements allocated in 10.0.0.0/24 (240 of 256 addresses)."
    );
  });

  it("input order does not matter; ties keep input order", () => {
    const r2 = run("10.0.0.0/24", "Small, 10\nBig, 100");
    expect(r2.allocations.map((a) => a.requirement.label)).toEqual(["Big", "Small"]);
    expect(allocationCidr(r2.allocations[0]!)).toBe("10.0.0.0/25");
    expect(allocationCidr(r2.allocations[1]!)).toBe("10.0.0.128/28");
    const r3 = run("10.0.0.0/26", "A, 10\nB, 10");
    expect(r3.allocations.map((a) => a.requirement.label)).toEqual(["A", "B"]);
  });
});

describe("allocateVlsm: headroom", () => {
  it("inflates each request before sizing", () => {
    const r = run("10.0.0.0/23", "Site, 100", 30);
    // ceil(100 * 1.3) = 130 > 126 usable in a /25, so a /24.
    expect(r.allocations[0]?.inflatedHosts).toBe(130);
    expect(r.allocations[0]?.prefix).toBe(24);
  });

  it("0% headroom is the default and changes nothing", () => {
    const r = run("10.0.0.0/24", "Site, 100");
    expect(r.headroomPercent).toBe(0);
    expect(r.allocations[0]?.prefix).toBe(25);
  });
});

describe("allocateVlsm: RFC 3021 allocations", () => {
  it("assigns /31 and /32 with notes", () => {
    const r = run("10.0.0.0/29", "Link, 2\nLoopback, 1");
    const link = r.allocations[0]!;
    const lo = r.allocations[1]!;
    expect(allocationCidr(link)).toBe("10.0.0.0/31");
    expect(link.note).toContain("RFC 3021");
    expect(allocationRange(link)).toBe("10.0.0.0 - 10.0.0.1");
    expect(allocationCidr(lo)).toBe("10.0.0.2/32");
    expect(lo.note).toContain("host route");
    expect(allocationRange(lo)).toBe("10.0.0.2");
  });
});

describe("allocateVlsm: shortfall", () => {
  it("names the prefix the full set needs", () => {
    const r = run("10.0.0.0/24", "A, 200\nB, 100");
    expect(r.status).toBe("shortfall");
    expect(r.allocations).toHaveLength(1);
    expect(r.unallocated[0]?.requirement.label).toBe("B");
    expect(r.unallocated[0]?.neededPrefix).toBe(25);
    expect(r.neededSupernetPrefix).toBe(23);
    expect(r.summary).toBe(
      "1 of 2 requirements allocated; requirements need a /23, the supernet is a /24."
    );
  });

  it("keeps allocating smaller requirements after a failed large one", () => {
    const r = run("10.0.0.0/24", "Big, 300\nSmall, 10");
    expect(r.status).toBe("shortfall");
    expect(r.unallocated[0]?.requirement.label).toBe("Big");
    expect(r.unallocated[0]?.neededPrefix).toBe(23);
    expect(r.allocations.map((a) => a.requirement.label)).toEqual(["Small"]);
    expect(allocationCidr(r.allocations[0]!)).toBe("10.0.0.0/28");
  });

  it("an exact fit is not a shortfall", () => {
    const r = run("10.0.0.0/24", "A, 100\nB, 100");
    expect(r.status).toBe("allocated");
    expect(r.waste.freeAddresses).toBe(0);
    expect(numberToIp(r.allocations[1]?.network ?? 0)).toBe("10.0.0.128");
  });
});

describe("allocateVlsm: empty state", () => {
  it("no requirements is its own non-error state", () => {
    const r = run("10.0.0.0/24", "");
    expect(r.status).toBe("empty");
    expect(r.summary).toBe("Nothing to allocate: no requirements.");
  });
});

describe("renderVlsmText", () => {
  it("renders summary, aligned rows, and the waste line", () => {
    const text = renderVlsmText(run("10.0.0.0/24", "Engineering, 100\nOps, 20"));
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "2 requirements allocated in 10.0.0.0/24 (160 of 256 addresses)."
    );
    expect(lines[1]).toMatch(/^Engineering {2}10\.0\.0\.0\/25 {2}/);
    expect(lines[1]).toContain("100 -> 126");
    expect(lines[2]).toMatch(/^Ops {8}/);
    expect(lines.at(-1)).toBe(
      "Allocated 160 of 256 addresses; stranded 36 usable hosts; free 96 addresses."
    );
  });

  it("renders unallocated rows explicitly", () => {
    const text = renderVlsmText(run("10.0.0.0/25", "A, 100\nB, 60"));
    expect(text).toContain(
      "UNALLOCATED  B needs a /26 (60 hosts); no room left in the supernet"
    );
  });

  it("uses a line-number fallback name for unlabeled requirements", () => {
    const text = renderVlsmText(run("10.0.0.0/24", "50"));
    expect(text).toContain("Requirement (line 1)  10.0.0.0/26");
  });
});
