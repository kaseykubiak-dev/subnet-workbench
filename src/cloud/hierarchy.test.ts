import { describe, expect, it } from "vitest";
import { ipToNumber, totalHosts } from "../engine/ipv4";
import {
  blockCidr,
  freeBlocks,
  pathText,
  planIsClean,
  renderPlanText,
  validatePlan,
  vnetUtilization,
  type AddressPlan,
  type PlanFinding,
  type PlanFindingKind,
  type PlanRegion,
  type PlanVnet,
} from "./hierarchy";

/** Build a named block from a CIDR string. Throws on a typo in a test. */
function b(name: string, cidr: string) {
  const [ip, prefixText] = cidr.split("/");
  const network = ipToNumber(ip ?? "");
  const prefix = Number(prefixText);
  if (network === null || !Number.isInteger(prefix)) throw new Error(`bad CIDR ${cidr}`);
  return { name, network, prefix };
}

function vnet(name: string, cidr: string, subnets: ReturnType<typeof b>[] = []): PlanVnet {
  return { ...b(name, cidr), subnets };
}

function region(name: string, cidr: string, vnets: PlanVnet[] = []): PlanRegion {
  return { ...b(name, cidr), vnets };
}

function kinds(findings: PlanFinding[]): PlanFindingKind[] {
  return findings.map((f) => f.kind);
}

function only(findings: PlanFinding[], kind: PlanFindingKind): PlanFinding {
  const matches = findings.filter((f) => f.kind === kind);
  expect(matches, `expected exactly one ${kind}`).toHaveLength(1);
  return matches[0] as PlanFinding;
}

/** A plan that is correct in every way, used as the control. */
function cleanPlan(): AddressPlan {
  return {
    platform: "azure",
    regions: [
      region("eastus", "10.0.0.0/12", [
        vnet("hub", "10.0.0.0/16", [
          b("GatewaySubnet", "10.0.0.0/27"),
          b("AzureFirewallSubnet", "10.0.1.0/26"),
        ]),
        vnet("spoke-prod", "10.1.0.0/16", [b("web", "10.1.0.0/24")]),
      ]),
      region("westeurope", "10.16.0.0/12", [
        vnet("hub", "10.16.0.0/16", [b("GatewaySubnet", "10.16.0.0/27")]),
      ]),
    ],
  };
}

describe("freeBlocks", () => {
  it("returns the whole block when nothing is allocated", () => {
    expect(freeBlocks(b("v", "10.0.0.0/24"), [])).toEqual([
      { network: ipToNumber("10.0.0.0"), prefix: 24 },
    ]);
  });

  it("returns nothing when the block is fully covered", () => {
    const used = [b("a", "10.0.0.0/25"), b("b", "10.0.0.128/25")];
    expect(freeBlocks(b("v", "10.0.0.0/24"), used)).toEqual([]);
  });

  it("returns nothing when a single larger block swallows the parent", () => {
    expect(freeBlocks(b("v", "10.0.0.0/24"), [b("a", "10.0.0.0/16")])).toEqual([]);
  });

  it("reports free space as real allocatable blocks, not a span", () => {
    // A /24 with its first /26 taken leaves a /26 and a /25, not "192 addresses".
    const free = freeBlocks(b("v", "10.0.0.0/24"), [b("a", "10.0.0.0/26")]);
    expect(free.map(blockCidr)).toEqual(["10.0.0.64/26", "10.0.0.128/25"]);
  });

  it("handles a sparsely used /16", () => {
    const used = [b("a", "10.0.0.0/24"), b("b", "10.0.1.0/24")];
    const free = freeBlocks(b("v", "10.0.0.0/16"), used);
    expect(free.map(blockCidr)).toEqual([
      "10.0.2.0/23",
      "10.0.4.0/22",
      "10.0.8.0/21",
      "10.0.16.0/20",
      "10.0.32.0/19",
      "10.0.64.0/18",
      "10.0.128.0/17",
    ]);
    const sum = free.reduce((n, f) => n + totalHosts(f.prefix), 0);
    expect(sum).toBe(totalHosts(16) - 512);
  });

  it("ignores used blocks that fall outside the parent", () => {
    // A subnet that escaped its VNet is its own finding; it must not also
    // corrupt the free-space math.
    const free = freeBlocks(b("v", "10.0.0.0/24"), [b("stray", "192.168.1.0/24")]);
    expect(free.map(blockCidr)).toEqual(["10.0.0.0/24"]);
  });

  it("normalizes a parent given with host bits set", () => {
    expect(freeBlocks(b("v", "10.0.0.37/24"), []).map(blockCidr)).toEqual(["10.0.0.0/24"]);
  });
});

describe("vnetUtilization", () => {
  const r = region("eastus", "10.0.0.0/12");
  const v = vnet("hub", "10.0.0.0/16", [b("a", "10.0.0.0/24"), b("b", "10.0.1.0/24")]);

  it("accounts for total, allocated and free", () => {
    const u = vnetUtilization(r, v, "azure");
    expect(u.totalAddresses).toBe(65536);
    expect(u.allocatedAddresses).toBe(512);
    expect(u.freeAddresses).toBe(65024);
    expect(u.allocatedFraction).toBeCloseTo(512 / 65536);
  });

  it("names the largest block still available", () => {
    expect(blockCidr(vnetUtilization(r, v, "azure").largestFree!)).toBe("10.0.128.0/17");
  });

  it("reports null largestFree for a full VNet", () => {
    const full = vnet("full", "10.0.0.0/24", [b("a", "10.0.0.0/25"), b("b", "10.0.0.128/25")]);
    const u = vnetUtilization(r, full, "azure");
    expect(u.largestFree).toBeNull();
    expect(u.freeAddresses).toBe(0);
  });

  it("totals the platform reservation nobody budgets for", () => {
    // Two subnets on Azure is 10 addresses gone before anything is deployed.
    expect(vnetUtilization(r, v, "azure").reservedOverhead).toBe(10);
    expect(vnetUtilization(r, v, "aws").reservedOverhead).toBe(10);
    expect(vnetUtilization(r, v, "none").reservedOverhead).toBe(4);
  });

  it("excludes a subnet that sits outside the VNet from allocation", () => {
    const broken = vnet("hub", "10.0.0.0/16", [b("a", "10.0.0.0/24"), b("stray", "10.9.0.0/24")]);
    expect(vnetUtilization(r, broken, "azure").allocatedAddresses).toBe(256);
  });
});

describe("validatePlan: the control case", () => {
  it("reports a correct plan as clean", () => {
    const report = validatePlan(cleanPlan());
    expect(report.findings).toEqual([]);
    expect(report.status).toBe("all-clear");
    expect(report.summary).toBe("No conflicts across 2 regions, 3 VNets and 4 subnets.");
    expect(planIsClean(report)).toBe(true);
  });

  it("returns utilization for every VNet even when nothing is wrong", () => {
    const report = validatePlan(cleanPlan());
    expect(report.utilization.map((u) => pathText(u.path))).toEqual([
      "eastus / hub",
      "eastus / spoke-prod",
      "westeurope / hub",
    ]);
  });

  it("treats a plan with no VNets as empty, not as an all-clear", () => {
    const report = validatePlan({ platform: "azure", regions: [] });
    expect(report.status).toBe("empty");
    expect(report.findings).toEqual([]);
  });
});

describe("validatePlan: the cross-region collision this module exists for", () => {
  it("catches two VNets in different regions that would never appear in one list", () => {
    const plan = cleanPlan();
    // A perfectly reasonable /16, already used four thousand miles away.
    plan.regions[1]!.vnets[0] = vnet("hub", "10.0.0.0/16");
    plan.regions[1]!.name = "westeurope";
    const report = validatePlan(plan);
    const f = only(report.findings, "vnet-overlap");
    expect(f.severity).toBe("error");
    expect(f.message).toContain("eastus");
    expect(f.message).toContain("westeurope");
    expect(f.message).toContain("is identical to");
    expect(f.consequence).toMatch(/Global peering/);
    expect(planIsClean(report)).toBe(false);
  });

  it("uses different wording when both VNets are in the same region", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [vnet("a", "10.0.0.0/16"), vnet("b", "10.0.0.0/17")]),
      ],
    };
    const f = only(validatePlan(plan).findings, "vnet-overlap");
    expect(f.consequence).not.toMatch(/Global peering/);
    expect(f.consequence).toMatch(/never be peered/);
    expect(f.message).toContain("overlaps");
  });

  it("reports the colliding addresses, not just the fact of the collision", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [vnet("a", "10.0.0.0/16")]),
        region("westus", "10.0.0.0/12", [vnet("b", "10.0.128.0/17")]),
      ],
    };
    const f = only(validatePlan(plan).findings, "vnet-overlap");
    // The overlap is the smaller block, which is what has to move.
    expect(f.range).toEqual({
      first: ipToNumber("10.0.128.0"),
      last: ipToNumber("10.0.255.255"),
    });
  });
});

describe("validatePlan: containment", () => {
  it("errors when a subnet is not inside its VNet", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [
          vnet("hub", "10.0.0.0/16", [b("web", "10.9.0.0/24")]),
        ]),
      ],
    };
    const f = only(validatePlan(plan).findings, "subnet-outside-vnet");
    expect(f.severity).toBe("error");
    expect(f.consequence).toMatch(/never deploys/);
    expect(pathText(f.a)).toBe("eastus / hub / web");
  });

  it("errors on sibling subnets that overlap", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [
          vnet("hub", "10.0.0.0/16", [b("web", "10.0.0.0/24"), b("app", "10.0.0.0/25")]),
        ]),
      ],
    };
    const f = only(validatePlan(plan).findings, "subnet-overlap");
    expect(f.severity).toBe("error");
    expect(f.consequence).toMatch(/Cheap now/);
    expect(pathText(f.b!)).toBe("eastus / hub / app");
  });

  it("only warns when a VNet leaves its region supernet, and says why", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [region("eastus", "10.0.0.0/12", [vnet("rogue", "172.16.0.0/16")])],
    };
    const report = validatePlan(plan);
    const f = only(report.findings, "vnet-outside-region");
    expect(f.severity).toBe("warning");
    // The supernet is a planning construct; claiming Azure enforces it is a lie.
    expect(f.consequence).toMatch(/not a platform object/);
    expect(f.consequence).toMatch(/summarization/);
    expect(planIsClean(report)).toBe(true);
  });

  it("errors when two region supernets draw from the same pool", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [region("eastus", "10.0.0.0/8"), region("westus", "10.1.0.0/16")],
    };
    const f = only(validatePlan(plan).findings, "region-overlap");
    expect(f.severity).toBe("error");
    expect(f.message).toContain("overlaps");
    expect(f.consequence).toMatch(/has not happened yet/);
  });
});

describe("validatePlan: external ranges", () => {
  const onPrem = { ...b("on-prem via ExpressRoute", "10.50.0.0/16") };

  it("catches a VNet colliding with a range that is not yours to renumber", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [region("eastus", "10.0.0.0/8", [vnet("spoke", "10.50.0.0/24")])],
      external: [onPrem],
    };
    const f = only(validatePlan(plan).findings, "external-collision");
    expect(f.severity).toBe("error");
    expect(f.consequence).toMatch(/not yours to renumber/);
    expect(f.consequence).toMatch(/partial outage/);
  });

  it("uses the range's own detail as the consequence when one is given", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [region("eastus", "10.0.0.0/8", [vnet("spoke", "10.50.0.0/24")])],
      external: [{ ...onPrem, detail: "Datacenter core; renumbering is a two-year program." }],
    };
    const f = only(validatePlan(plan).findings, "external-collision");
    expect(f.consequence).toBe("Datacenter core; renumbering is a two-year program.");
  });

  it("stays quiet when nothing touches the external range", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [region("eastus", "10.0.0.0/12", [vnet("spoke", "10.0.0.0/16")])],
      external: [onPrem],
    };
    expect(kinds(validatePlan(plan).findings)).toEqual([]);
  });
});

describe("validatePlan: reporting", () => {
  /** Every category of problem at once, to pin the ordering. */
  function messyPlan(): AddressPlan {
    return {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [
          vnet("hub", "10.0.0.0/16", [b("web", "10.0.0.0/24"), b("app", "10.0.0.0/25")]),
          vnet("rogue", "172.16.0.0/16"),
        ]),
        region("westeurope", "10.0.0.0/12", [vnet("hub", "10.0.0.0/16")]),
      ],
      external: [b("on-prem", "10.0.0.0/16")],
    };
  }

  it("sorts worst-first by consequence, not by discovery order", () => {
    const found = kinds(validatePlan(messyPlan()).findings);
    // External collisions have no remedy at all, so they lead. Sibling subnet
    // overlaps are last among the errors because nothing is built yet.
    expect(found.indexOf("external-collision")).toBeLessThan(found.indexOf("vnet-overlap"));
    expect(found.indexOf("vnet-overlap")).toBeLessThan(found.indexOf("region-overlap"));
    expect(found.indexOf("region-overlap")).toBeLessThan(found.indexOf("subnet-overlap"));
    expect(found.at(-1)).toBe("vnet-outside-region");
  });

  it("counts errors and warnings separately in the summary", () => {
    const report = validatePlan(messyPlan());
    const errors = report.findings.filter((f) => f.severity === "error").length;
    expect(report.status).toBe("problems");
    expect(report.summary).toContain(`${errors} errors`);
    expect(report.summary).toContain("1 warning");
  });

  it("is deterministic across runs", () => {
    expect(kinds(validatePlan(messyPlan()).findings)).toEqual(
      kinds(validatePlan(messyPlan()).findings)
    );
  });

  it("renders the consequence under each finding, not just the message", () => {
    const text = renderPlanText(validatePlan(messyPlan()));
    expect(text.split("\n")[0]).toBe(validatePlan(messyPlan()).summary);
    expect(text).toContain("ERROR  ");
    expect(text).toContain("WARNING");
    expect(text).toMatch(/not yours to renumber/);
  });

  it("renders utilization with a percentage and the largest free block", () => {
    const text = renderPlanText(validatePlan(cleanPlan()));
    expect(text).toContain("eastus / hub (10.0.0.0/16): 0% allocated, largest free block");
  });

  it("says 'none' rather than omitting the line when a VNet is full", () => {
    const plan: AddressPlan = {
      platform: "azure",
      regions: [
        region("eastus", "10.0.0.0/12", [
          vnet("tight", "10.0.0.0/24", [b("a", "10.0.0.0/25"), b("b", "10.0.0.128/25")]),
        ]),
      ],
    };
    expect(renderPlanText(validatePlan(plan))).toContain(
      "eastus / tight (10.0.0.0/24): 100% allocated, largest free block none"
    );
  });
});

describe("display helpers", () => {
  it("pathText degrades cleanly as levels are omitted", () => {
    expect(pathText({ region: "eastus" })).toBe("eastus");
    expect(pathText({ region: "eastus", vnet: "hub" })).toBe("eastus / hub");
    expect(pathText({ region: "eastus", vnet: "hub", subnet: "web" })).toBe("eastus / hub / web");
  });

  it("blockCidr normalizes host bits, so a sloppy input still displays correctly", () => {
    expect(blockCidr(b("v", "10.0.0.37/24"))).toBe("10.0.0.0/24");
  });
});
