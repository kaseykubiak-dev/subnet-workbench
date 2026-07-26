/**
 * Subnet Workbench: hierarchical address plans.
 *
 * Overlap mode compares a flat list. That catches the easy case and misses the
 * expensive one, because in cloud the damaging overlaps are between things that
 * are never in the same list: a VNet in East US and a VNet in West Europe, each
 * perfectly valid on its own, that can never be peered because somebody reached
 * for 10.0.0.0/16 twice.
 *
 * The model is three levels: region supernet -> VNet or VPC -> subnet. Only the
 * bottom two exist in the platform. The region supernet is a planning
 * construct, and the module says so wherever it matters, because a warning that
 * pretends Azure enforces something it does not is worse than no warning.
 *
 * SEVERITY IN THIS MODULE MEANS SOMETHING DIFFERENT THAN IT DOES IN validate.ts.
 * There, "error" means the platform rejects the deployment. Here, a plan is not
 * deployed yet, so that test says nothing useful: two overlapping VNets deploy
 * perfectly well and only fail years later at the peering request. So severity
 * here is about the cost of the repair:
 *
 *   error    something has to move, and if it is already built that means
 *            renumbering live resources
 *   warning  it works and stays working, but you give something up
 *
 * Every finding also carries a `consequence` in plain words, because "error" on
 * its own has never convinced anyone to redo an address plan.
 *
 * SCOPE. This module is positional only: containment, overlap, and free space.
 * Whether a given subnet is a legal size, correctly named, or allowed to carry
 * an NSG belongs to validate.ts and is deliberately not repeated here. A caller
 * wanting a full report runs both and concatenates.
 *
 * One CIDR per node, matching the rest of the tool. Azure VNets can carry
 * several address spaces; representing one as several sibling VNets that share
 * a name is a workable stand-in until the data model grows.
 */

import {
  classify,
  contains,
  intersection,
  intersects,
  lastAddress,
  networkAddress,
  numberToIp,
  totalHosts,
  type Subnet,
} from "../engine/ipv4";
import { cloudUsableHosts, platformById, type PlatformId } from "./platforms";

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/** Anything in the plan that occupies a CIDR block. */
export interface PlanBlock extends Subnet {
  name: string;
}

export interface PlanSubnet extends PlanBlock {}

export interface PlanVnet extends PlanBlock {
  subnets: PlanSubnet[];
}

export interface PlanRegion extends PlanBlock {
  vnets: PlanVnet[];
}

/**
 * A range outside the plan that nothing may collide with: on-prem space
 * reaching in over ExpressRoute or Direct Connect, a partner's range, an
 * acquired company's estate. These are the collisions with no remedy at all,
 * since the other side is not yours to renumber.
 */
export interface ExternalRange extends PlanBlock {
  detail?: string;
}

export interface AddressPlan {
  platform: PlatformId;
  regions: PlanRegion[];
  external?: ExternalRange[];
}

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

export type PlanFindingKind =
  | "subnet-outside-vnet"
  | "subnet-overlap"
  | "vnet-outside-region"
  | "vnet-overlap"
  | "region-overlap"
  | "external-collision";

export type PlanSeverity = "error" | "warning";

/** Where in the tree something sits, for display and for stable sorting. */
export interface PlanPath {
  region: string;
  vnet?: string;
  subnet?: string;
}

export interface PlanFinding {
  kind: PlanFindingKind;
  severity: PlanSeverity;
  /** What is wrong, naming both sides. */
  message: string;
  /** What it costs, in plain words. */
  consequence: string;
  a: PlanPath;
  b?: PlanPath;
  /** The colliding addresses, when the finding is a collision. */
  range?: { first: number; last: number };
}

export type PlanStatus = "empty" | "all-clear" | "problems";

export interface PlanReport {
  findings: PlanFinding[];
  status: PlanStatus;
  summary: string;
  utilization: VnetUtilization[];
}

/** Worst first. Ties break on path so output is stable across runs. */
const KIND_RANK: Record<PlanFindingKind, number> = {
  "external-collision": 0,
  "vnet-overlap": 1,
  "region-overlap": 2,
  "subnet-overlap": 3,
  "subnet-outside-vnet": 4,
  "vnet-outside-region": 5,
};

/** "eastus / hub / GatewaySubnet" */
export function pathText(path: PlanPath): string {
  return [path.region, path.vnet, path.subnet].filter((p) => p !== undefined).join(" / ");
}

/** CIDR string for any plan block. */
export function blockCidr(block: Subnet): string {
  return `${numberToIp(networkAddress(block.network, block.prefix))}/${block.prefix}`;
}

function comparePaths(a: PlanPath, b: PlanPath): number {
  return (
    a.region.localeCompare(b.region) ||
    (a.vnet ?? "").localeCompare(b.vnet ?? "") ||
    (a.subnet ?? "").localeCompare(b.subnet ?? "")
  );
}

function overlapRange(a: Subnet, b: Subnet): { first: number; last: number } {
  const range = intersection(a, b);
  // Only called on a pair already known to intersect.
  return range ?? { first: networkAddress(a.network, a.prefix), last: lastAddress(a.network, a.prefix) };
}

/* -------------------------------------------------------------------------- */
/* Free space                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The maximal aligned CIDR blocks inside `parent` that none of `used` covers.
 *
 * Recursive halving rather than an interval sweep, because the answer has to
 * come back as real CIDR blocks a person can allocate. An interval sweep would
 * report "10.0.4.0 to 10.0.11.255 is free", which is true and useless: that
 * span is not a block, it is a /22 and a /23 and you still have to work out
 * which. Halving produces exactly the blocks that can be handed out.
 *
 * Entries in `used` that fall outside `parent` are ignored rather than
 * rejected; a subnet that escaped its VNet is reported as its own finding and
 * should not also corrupt the free-space math.
 */
export function freeBlocks(parent: Subnet, used: Subnet[]): Subnet[] {
  const relevant = used.filter((u) => intersects(parent, u));
  if (relevant.length === 0) return [{ network: networkAddress(parent.network, parent.prefix), prefix: parent.prefix }];
  // Something covers this block entirely, so nothing in it is free.
  if (relevant.some((u) => contains(u, parent))) return [];
  if (parent.prefix >= 32) return [];

  const half = parent.prefix + 1;
  const lower = networkAddress(parent.network, parent.prefix);
  const upper = (lower + totalHosts(half)) >>> 0;
  return [
    ...freeBlocks({ network: lower, prefix: half }, relevant),
    ...freeBlocks({ network: upper, prefix: half }, relevant),
  ];
}

export interface VnetUtilization {
  path: PlanPath;
  cidr: string;
  /** Raw size of the VNet block. */
  totalAddresses: number;
  /** Sum of the sizes of subnets that actually sit inside it. */
  allocatedAddresses: number;
  freeAddresses: number;
  /** Free space as maximal allocatable blocks, largest first. */
  free: Subnet[];
  /** Largest block still available, or null when the VNet is full. */
  largestFree: Subnet | null;
  /**
   * Usable addresses lost to the platform's per-subnet reservation across every
   * subnet in this VNet. The number nobody budgets for.
   */
  reservedOverhead: number;
  /** 0 to 1. */
  allocatedFraction: number;
}

/** Address accounting for one VNet. */
export function vnetUtilization(
  region: PlanRegion,
  vnet: PlanVnet,
  platformId: PlatformId
): VnetUtilization {
  const platform = platformById(platformId);
  const inside = vnet.subnets.filter((s) => contains(vnet, s));
  const total = totalHosts(vnet.prefix);
  const allocated = inside.reduce((sum, s) => sum + totalHosts(s.prefix), 0);
  const free = freeBlocks(vnet, inside).sort((a, b) => a.prefix - b.prefix || a.network - b.network);
  const reservedOverhead = inside.reduce(
    (sum, s) => sum + (totalHosts(s.prefix) - cloudUsableHosts(s.prefix, platform)),
    0
  );

  return {
    path: { region: region.name, vnet: vnet.name },
    cidr: blockCidr(vnet),
    totalAddresses: total,
    allocatedAddresses: allocated,
    freeAddresses: total - allocated,
    free,
    largestFree: free[0] ?? null,
    reservedOverhead,
    allocatedFraction: total === 0 ? 0 : allocated / total,
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

interface FlatVnet {
  region: PlanRegion;
  vnet: PlanVnet;
}

function flattenVnets(plan: AddressPlan): FlatVnet[] {
  return plan.regions.flatMap((region) => region.vnets.map((vnet) => ({ region, vnet })));
}

function containmentVerb(outer: Subnet, inner: Subnet): string {
  return classify(outer, inner) === "identical" ? "is identical to" : "overlaps";
}

/**
 * What an external collision costs, with the range's own note in front of it.
 *
 * The note is whatever the plan author wrote beside the range, which in practice
 * ranges from a one-word label ("ExpressRoute") to a full sentence about a
 * multi-year renumbering program. Neither one is a substitute for saying why the
 * collision hurts, so the note leads as context and the standing consequence
 * follows it rather than being replaced by it.
 */
function externalConsequence(detail: string | undefined): string {
  const standing =
    "This range is not yours to renumber, so the whole repair falls on your side. " +
    "Traffic to the overlapping addresses stays local instead of crossing the link, " +
    "which presents as a partial outage rather than a clean failure.";
  const note = detail?.trim().replace(/[.;,\s]+$/, "") ?? "";
  return note === "" ? standing : `${note}. ${standing}`;
}

/**
 * Walk the whole plan and report every positional problem in it.
 *
 * Deliberately runs every check on every node rather than stopping at the first
 * failure. Someone fixing an address plan wants the whole list, because the
 * fixes interact: moving one VNet to clear a peering conflict routinely creates
 * two more.
 */
export function validatePlan(plan: AddressPlan): PlanReport {
  const findings: PlanFinding[] = [];
  const vnets = flattenVnets(plan);
  const external = plan.external ?? [];

  // --- Subnets against their own VNet, and against each other -------------
  for (const { region, vnet } of vnets) {
    const vnetPath: PlanPath = { region: region.name, vnet: vnet.name };

    for (const subnet of vnet.subnets) {
      if (!contains(vnet, subnet)) {
        findings.push({
          kind: "subnet-outside-vnet",
          severity: "error",
          message: `Subnet ${subnet.name} (${blockCidr(subnet)}) is not inside VNet ${vnet.name} (${blockCidr(vnet)}).`,
          consequence:
            "The platform refuses to create a subnet outside its VNet address space, so this never deploys at all.",
          a: { ...vnetPath, subnet: subnet.name },
        });
      }
    }

    for (let i = 0; i < vnet.subnets.length; i++) {
      for (let j = i + 1; j < vnet.subnets.length; j++) {
        const a = vnet.subnets[i] as PlanSubnet;
        const b = vnet.subnets[j] as PlanSubnet;
        if (!intersects(a, b)) continue;
        findings.push({
          kind: "subnet-overlap",
          severity: "error",
          message: `Subnet ${a.name} (${blockCidr(a)}) ${containmentVerb(a, b)} subnet ${b.name} (${blockCidr(b)}) in VNet ${vnet.name}.`,
          consequence:
            "The second subnet fails to create. Cheap now, since neither exists yet.",
          a: { ...vnetPath, subnet: a.name },
          b: { ...vnetPath, subnet: b.name },
          range: overlapRange(a, b),
        });
      }
    }
  }

  // --- VNet against its region supernet ------------------------------------
  for (const { region, vnet } of vnets) {
    if (contains(region, vnet)) continue;
    findings.push({
      kind: "vnet-outside-region",
      severity: "warning",
      message: `VNet ${vnet.name} (${blockCidr(vnet)}) sits outside the ${region.name} supernet (${blockCidr(region)}).`,
      consequence:
        "Nothing rejects this: region supernets are a planning boundary, not a platform object. What you lose is summarization, so this VNet needs its own route advertisement and its own firewall rules forever.",
      a: { region: region.name, vnet: vnet.name },
    });
  }

  // --- VNet against every other VNet, across regions ------------------------
  for (let i = 0; i < vnets.length; i++) {
    for (let j = i + 1; j < vnets.length; j++) {
      const x = vnets[i] as FlatVnet;
      const y = vnets[j] as FlatVnet;
      if (!intersects(x.vnet, y.vnet)) continue;
      const sameRegion = x.region.name === y.region.name;
      findings.push({
        kind: "vnet-overlap",
        severity: "error",
        message: `VNet ${x.vnet.name} (${blockCidr(x.vnet)}) in ${x.region.name} ${containmentVerb(x.vnet, y.vnet)} VNet ${y.vnet.name} (${blockCidr(y.vnet)}) in ${y.region.name}.`,
        consequence: sameRegion
          ? "Both deploy without complaint and can never be peered. Peering is the fix for almost everything else, so losing it is not a small loss."
          : "Both deploy without complaint. Global peering between them is permanently unavailable, and any hub routing that expects to reach both breaks. The repair is renumbering one side after it is already carrying workloads.",
        a: { region: x.region.name, vnet: x.vnet.name },
        b: { region: y.region.name, vnet: y.vnet.name },
        range: overlapRange(x.vnet, y.vnet),
      });
    }
  }

  // --- Region supernets against each other ---------------------------------
  for (let i = 0; i < plan.regions.length; i++) {
    for (let j = i + 1; j < plan.regions.length; j++) {
      const a = plan.regions[i] as PlanRegion;
      const b = plan.regions[j] as PlanRegion;
      if (!intersects(a, b)) continue;
      findings.push({
        kind: "region-overlap",
        severity: "error",
        message: `Region supernet ${a.name} (${blockCidr(a)}) ${containmentVerb(a, b)} region supernet ${b.name} (${blockCidr(b)}).`,
        consequence:
          "Two regions drawing from the same pool will eventually hand the same prefix to two VNets. The collision has not happened yet, which is the only reason this is still cheap to fix.",
        a: { region: a.name },
        b: { region: b.name },
        range: overlapRange(a, b),
      });
    }
  }

  // --- Everything against declared external ranges --------------------------
  for (const range of external) {
    for (const { region, vnet } of vnets) {
      if (!intersects(range, vnet)) continue;
      findings.push({
        kind: "external-collision",
        severity: "error",
        message: `VNet ${vnet.name} (${blockCidr(vnet)}) in ${region.name} collides with ${range.name} (${blockCidr(range)}).`,
        consequence: externalConsequence(range.detail),
        a: { region: region.name, vnet: vnet.name },
        range: overlapRange(range, vnet),
      });
    }
  }

  findings.sort(
    (x, y) =>
      KIND_RANK[x.kind] - KIND_RANK[y.kind] ||
      comparePaths(x.a, y.a) ||
      comparePaths(x.b ?? x.a, y.b ?? y.a)
  );

  const utilization = vnets.map(({ region, vnet }) =>
    vnetUtilization(region, vnet, plan.platform)
  );

  const subnetCount = vnets.reduce((sum, v) => sum + v.vnet.subnets.length, 0);

  let status: PlanStatus;
  let summary: string;
  if (vnets.length === 0) {
    status = "empty";
    summary = "Nothing to check: the plan has no VNets.";
  } else if (findings.length === 0) {
    status = "all-clear";
    summary = `No conflicts across ${plan.regions.length} ${plan.regions.length === 1 ? "region" : "regions"}, ${vnets.length} ${vnets.length === 1 ? "VNet" : "VNets"} and ${subnetCount} ${subnetCount === 1 ? "subnet" : "subnets"}.`;
  } else {
    status = "problems";
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.length - errors;
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
    if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
    summary = `${findings.length} ${findings.length === 1 ? "finding" : "findings"} across ${vnets.length} ${vnets.length === 1 ? "VNet" : "VNets"} (${parts.join(", ")}).`;
  }

  return { findings, status, summary, utilization };
}

/** True when nothing in the plan requires something to move. */
export function planIsClean(report: PlanReport): boolean {
  return !report.findings.some((f) => f.severity === "error");
}

/** Plain-text rendering: summary, findings worst-first, then free space. */
export function renderPlanText(report: PlanReport): string {
  const lines = [report.summary];

  for (const f of report.findings) {
    lines.push(`${f.severity.toUpperCase().padEnd(7)}  ${f.message}`);
    lines.push(`         ${f.consequence}`);
  }

  if (report.utilization.length > 0) {
    lines.push("");
    for (const u of report.utilization) {
      const percent = Math.round(u.allocatedFraction * 100);
      const largest = u.largestFree === null ? "none" : blockCidr(u.largestFree);
      lines.push(
        `${pathText(u.path)} (${u.cidr}): ${percent}% allocated, largest free block ${largest}`
      );
    }
  }

  return lines.join("\n");
}
