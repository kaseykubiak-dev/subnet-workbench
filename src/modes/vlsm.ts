/**
 * Subnet Workbench: VLSM mode (text output).
 *
 * One supernet plus a list of requirements (label, host count) in; an
 * allocation plan out. Strategy is largest-first and not user-tunable:
 * requirements are sized to the smallest subnet whose usable host count
 * covers the (headroom-inflated) request, sorted largest block first, and
 * allocated from the bottom of the supernet upward. With non-increasing
 * power-of-two sizes from an aligned base, every block lands aligned and
 * packing is exact, so shortfall math is a plain sum.
 *
 * On failure the shortfall is explicit: each unfit requirement names the
 * prefix it needs, and the summary names the supernet prefix the full set
 * would need ("requirements need a /21, the supernet is a /22"). Nothing is
 * silently truncated; smaller requirements after a failed one still get
 * their chance to fit.
 *
 * Sizing honors RFC 3021: a 2-host requirement gets a /31 and a 1-host
 * requirement gets a /32, each flagged with a note.
 *
 * The waste summary distinguishes three fates for address space: allocated
 * (inside assigned blocks), stranded (usable addresses inside a block beyond
 * what was requested; the cost of power-of-two rounding), and free (never
 * assigned; still available for future allocations).
 */

import {
  lastAddress,
  numberToIp,
  totalHosts,
  usableHosts,
  usableRange,
} from "../engine/ipv4";
import type { ParsedSubnet } from "../engine/parse";

/** One successfully parsed requirement line. */
export interface VlsmRequirement {
  label?: string;
  /** Requested host count, before headroom. */
  hosts: number;
  /** 1-based line number in the pasted text. */
  lineNumber: number;
  raw: string;
}

/** One failed requirement line. */
export interface RequirementError {
  lineNumber: number;
  raw: string;
  message: string;
}

export interface RequirementParseResult {
  requirements: VlsmRequirement[];
  errors: RequirementError[];
}

export interface VlsmAllocation {
  requirement: VlsmRequirement;
  /** Host count after headroom inflation (equals hosts at 0% headroom). */
  inflatedHosts: number;
  network: number;
  prefix: number;
  /** Usable hosts in the assigned block. */
  capacity: number;
  /** Total addresses in the assigned block. */
  blockSize: number;
  /** Present for /31 and /32 assignments. */
  note?: string;
}

/** A requirement that did not fit in the remaining space. */
export interface VlsmShortfall {
  requirement: VlsmRequirement;
  inflatedHosts: number;
  /** The prefix this requirement alone needs. */
  neededPrefix: number;
}

export type VlsmStatus = "empty" | "allocated" | "shortfall";

export interface VlsmWaste {
  /** Total addresses in the supernet. */
  supernetSize: number;
  /** Addresses inside assigned blocks. */
  allocatedAddresses: number;
  /** Usable addresses inside assigned blocks beyond the inflated requests. */
  strandedHosts: number;
  /** Addresses never assigned to any block. */
  freeAddresses: number;
}

export interface VlsmResult {
  supernet: ParsedSubnet;
  requirements: VlsmRequirement[];
  allocations: VlsmAllocation[];
  unallocated: VlsmShortfall[];
  status: VlsmStatus;
  headroomPercent: number;
  waste: VlsmWaste;
  /**
   * When status is "shortfall": the supernet prefix the full requirement set
   * needs, or null if it exceeds the entire IPv4 space.
   */
  neededSupernetPrefix: number | null;
  /** One-line human summary of the run. */
  summary: string;
}

/** Deterministic thousands grouping (locale-independent). */
const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * Parse one requirement line: "Label, 200", "Label: 200 hosts", or a bare
 * count. The label separator (comma or colon) is required when a label is
 * present, so multi-word labels stay unambiguous.
 */
export function parseRequirementLine(
  line: string,
  lineNumber = 1
): VlsmRequirement | RequirementError {
  const raw = line.trim();
  const fail = (message: string): RequirementError => ({ lineNumber, raw, message });

  let label: string | undefined;
  let rest = raw;
  const sepIdx = raw.search(/[,:]/);
  if (sepIdx !== -1) {
    label = raw.slice(0, sepIdx).trim();
    rest = raw.slice(sepIdx + 1).trim();
    if (label === "") return fail("empty label before the separator");
  }

  const m = /^(\d+)(?:\s+hosts?)?$/.exec(rest);
  if (m === null || m[1] === undefined) {
    return fail(
      rest === ""
        ? "missing host count (use e.g. \"Branch, 200\")"
        : `"${rest}" is not a host count (use e.g. "Branch, 200" or "Branch, 200 hosts")`
    );
  }
  const hosts = Number(m[1]);
  if (hosts < 1) return fail("host count must be at least 1");
  if (hosts > usableHosts(0)) {
    return fail(`${fmt(hosts)} hosts exceeds the entire IPv4 address space`);
  }

  const req: VlsmRequirement = { hosts, lineNumber, raw };
  if (label !== undefined) req.label = label;
  return req;
}

/** True when the line should be skipped silently (blank or comment). */
function isSkippable(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#") || t.startsWith("//");
}

/** Parse a full requirement paste. Bad lines land in `errors`. */
export function parseRequirementList(text: string): RequirementParseResult {
  const requirements: VlsmRequirement[] = [];
  const errors: RequirementError[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || isSkippable(line)) continue;
    const result = parseRequirementLine(line, i + 1);
    if ("message" in result) errors.push(result);
    else requirements.push(result);
  }
  return { requirements, errors };
}

/** Smallest subnet (largest prefix) whose usable host count covers `hosts`. */
export function prefixForHosts(hosts: number): number {
  for (let prefix = 32; prefix >= 0; prefix--) {
    if (usableHosts(prefix) >= hosts) return prefix;
  }
  throw new RangeError(`no prefix can hold ${hosts} hosts`);
}

/** Display name: the label when present, otherwise "Requirement N" by line. */
export function requirementName(r: VlsmRequirement): string {
  return r.label ?? `Requirement (line ${r.lineNumber})`;
}

export interface VlsmOptions {
  /** Global growth headroom: each request is inflated by this percentage. */
  headroomPercent?: number;
}

/** Largest-first allocation of requirements inside a supernet. */
export function allocateVlsm(
  supernet: ParsedSubnet,
  requirements: VlsmRequirement[],
  options: VlsmOptions = {}
): VlsmResult {
  const headroomPercent = options.headroomPercent ?? 0;
  const supernetSize = totalHosts(supernet.prefix);
  const supernetLast = lastAddress(supernet.network, supernet.prefix);
  const supernetCidr = `${numberToIp(supernet.network)}/${supernet.prefix}`;

  // Size every requirement, then sort largest block first (stable by line).
  const sized = requirements.map((requirement) => {
    const inflatedHosts = Math.ceil(requirement.hosts * (1 + headroomPercent / 100));
    const prefix = prefixForHosts(inflatedHosts);
    return { requirement, inflatedHosts, prefix, blockSize: totalHosts(prefix) };
  });
  sized.sort(
    (a, b) => b.blockSize - a.blockSize || a.requirement.lineNumber - b.requirement.lineNumber
  );

  const allocations: VlsmAllocation[] = [];
  const unallocated: VlsmShortfall[] = [];
  let cursor = supernet.network;

  for (const s of sized) {
    if (cursor + s.blockSize - 1 > supernetLast) {
      unallocated.push({
        requirement: s.requirement,
        inflatedHosts: s.inflatedHosts,
        neededPrefix: s.prefix,
      });
      continue;
    }
    const alloc: VlsmAllocation = {
      requirement: s.requirement,
      inflatedHosts: s.inflatedHosts,
      network: cursor,
      prefix: s.prefix,
      capacity: usableHosts(s.prefix),
      blockSize: s.blockSize,
    };
    if (s.prefix === 31) alloc.note = "/31 point-to-point (RFC 3021)";
    if (s.prefix === 32) alloc.note = "/32 host route";
    allocations.push(alloc);
    cursor += s.blockSize;
  }

  const allocatedAddresses = allocations.reduce((sum, a) => sum + a.blockSize, 0);
  const strandedHosts = allocations.reduce((sum, a) => sum + a.capacity - a.inflatedHosts, 0);
  const waste: VlsmWaste = {
    supernetSize,
    allocatedAddresses,
    strandedHosts,
    freeAddresses: supernetSize - allocatedAddresses,
  };

  let status: VlsmStatus;
  let summary: string;
  let neededSupernetPrefix: number | null = null;

  if (requirements.length === 0) {
    status = "empty";
    summary = "Nothing to allocate: no requirements.";
  } else if (unallocated.length === 0) {
    status = "allocated";
    const n = allocations.length;
    summary = `${n} ${n === 1 ? "requirement" : "requirements"} allocated in ${supernetCidr} (${fmt(allocatedAddresses)} of ${fmt(supernetSize)} addresses).`;
  } else {
    status = "shortfall";
    const totalSize = sized.reduce((sum, s) => sum + s.blockSize, 0);
    // Smallest sufficient block is the largest prefix that still fits the sum.
    for (let prefix = 32; prefix >= 0; prefix--) {
      if (totalHosts(prefix) >= totalSize) {
        neededSupernetPrefix = prefix;
        break;
      }
    }
    summary =
      neededSupernetPrefix === null
        ? `${allocations.length} of ${requirements.length} requirements allocated; the full set exceeds the entire IPv4 address space.`
        : `${allocations.length} of ${requirements.length} requirements allocated; requirements need a /${neededSupernetPrefix}, the supernet is a /${supernet.prefix}.`;
  }

  return {
    supernet,
    requirements,
    allocations,
    unallocated,
    status,
    headroomPercent,
    waste,
    neededSupernetPrefix,
    summary,
  };
}

/** CIDR string for an allocation. */
export function allocationCidr(a: VlsmAllocation): string {
  return `${numberToIp(a.network)}/${a.prefix}`;
}

/** Usable range string for an allocation ("a - b", or one address). */
export function allocationRange(a: VlsmAllocation): string {
  const r = usableRange(a.network, a.prefix);
  return r.first === r.last
    ? numberToIp(r.first)
    : `${numberToIp(r.first)} - ${numberToIp(r.last)}`;
}

/**
 * Plain-text rendering: summary line, aligned allocation rows, unallocated
 * rows, then the waste summary.
 */
export function renderVlsmText(result: VlsmResult): string {
  const lines = [result.summary];
  if (result.status === "empty") return lines.join("\n");

  const rows = result.allocations.map((a) => ({
    name: requirementName(a.requirement),
    cidr: allocationCidr(a),
    range: allocationRange(a),
    hosts: `${fmt(a.requirement.hosts)} -> ${fmt(a.capacity)}`,
    note: a.note,
  }));
  const nameW = Math.max(...rows.map((r) => r.name.length), 0);
  const cidrW = Math.max(...rows.map((r) => r.cidr.length), 0);
  const rangeW = Math.max(...rows.map((r) => r.range.length), 0);
  for (const r of rows) {
    const note = r.note === undefined ? "" : `  (${r.note})`;
    lines.push(
      `${r.name.padEnd(nameW)}  ${r.cidr.padEnd(cidrW)}  ${r.range.padEnd(rangeW)}  ${r.hosts}${note}`
    );
  }
  for (const u of result.unallocated) {
    lines.push(
      `UNALLOCATED  ${requirementName(u.requirement)} needs a /${u.neededPrefix} (${fmt(u.inflatedHosts)} hosts); no room left in the supernet`
    );
  }
  const w = result.waste;
  lines.push(
    `Allocated ${fmt(w.allocatedAddresses)} of ${fmt(w.supernetSize)} addresses; stranded ${fmt(w.strandedHosts)} usable hosts; free ${fmt(w.freeAddresses)} addresses.`
  );
  return lines.join("\n");
}
