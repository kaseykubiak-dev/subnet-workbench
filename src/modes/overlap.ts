/**
 * Subnet Workbench: Overlap mode (text output).
 *
 * Pairwise comparison across a list of labeled subnets. Each conflict is
 * classified (identical / containment / partial overlap) and reported with
 * both labels, both subnets, and the actual overlapping range, sorted
 * worst-first.
 *
 * The all-clear state is explicit and unmistakable: "No conflicts across N
 * subnets" is frequently the answer the user is hoping for, and it must not
 * look like an empty results table. An empty or single-entry list is its own
 * non-error state, not an all-clear.
 *
 * Note: partial overlap is unreachable for valid CIDR blocks (aligned
 * power-of-two blocks either nest or are disjoint); the severity rank keeps
 * it loudest anyway so the contract holds if ranges ever become an input.
 */

import {
  classify,
  intersection,
  numberToIp,
  type SubnetRelationship,
} from "../engine/ipv4";
import type { ParsedSubnet } from "../engine/parse";

export type ConflictKind = Exclude<SubnetRelationship, "disjoint">;
export type ConflictSeverity = "error" | "warning";

export interface Conflict {
  a: ParsedSubnet;
  b: ParsedSubnet;
  kind: ConflictKind;
  /** Partial overlap and identical are errors; containment is a warning. */
  severity: ConflictSeverity;
  /** The actual overlapping address range. */
  range: { first: number; last: number };
}

export type OverlapStatus = "empty" | "all-clear" | "conflicts";

export interface OverlapResult {
  subnets: ParsedSubnet[];
  conflicts: Conflict[];
  status: OverlapStatus;
  /** One-line human summary of the run. */
  summary: string;
}

/** Worst-first ordering: partial overlap, then identical, then containment. */
const KIND_RANK: Record<ConflictKind, number> = {
  "partial-overlap": 0,
  identical: 1,
  "a-contains-b": 2,
  "b-contains-a": 2,
};

const KIND_SEVERITY: Record<ConflictKind, ConflictSeverity> = {
  "partial-overlap": "error",
  identical: "error",
  "a-contains-b": "warning",
  "b-contains-a": "warning",
};

/** Display name: the label when present, otherwise the subnet itself. */
export function displayName(s: ParsedSubnet): string {
  return s.label ?? `${numberToIp(s.network)}/${s.prefix}`;
}

/** CIDR string for a parsed subnet (normalized network). */
export function cidrOf(s: ParsedSubnet): string {
  return `${numberToIp(s.network)}/${s.prefix}`;
}

/** Pairwise overlap detection across the whole list. */
export function findOverlaps(subnets: ParsedSubnet[]): OverlapResult {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i] as ParsedSubnet;
      const b = subnets[j] as ParsedSubnet;
      const kind = classify(
        { network: a.network, prefix: a.prefix },
        { network: b.network, prefix: b.prefix }
      );
      if (kind === "disjoint") continue;
      const range = intersection(
        { network: a.network, prefix: a.prefix },
        { network: b.network, prefix: b.prefix }
      );
      if (range === null) continue; // unreachable when kind is a conflict
      conflicts.push({ a, b, kind, severity: KIND_SEVERITY[kind], range });
    }
  }

  conflicts.sort(
    (x, y) =>
      KIND_RANK[x.kind] - KIND_RANK[y.kind] ||
      x.a.lineNumber - y.a.lineNumber ||
      x.b.lineNumber - y.b.lineNumber
  );

  let status: OverlapStatus;
  let summary: string;
  if (subnets.length < 2) {
    status = "empty";
    summary =
      subnets.length === 0
        ? "Nothing to compare: no subnets."
        : "Nothing to compare: only one subnet.";
  } else if (conflicts.length === 0) {
    status = "all-clear";
    summary = `No conflicts across ${subnets.length} subnets.`;
  } else {
    status = "conflicts";
    const errors = conflicts.filter((c) => c.severity === "error").length;
    const warnings = conflicts.length - errors;
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
    if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
    summary = `${conflicts.length} ${conflicts.length === 1 ? "conflict" : "conflicts"} across ${subnets.length} subnets (${parts.join(", ")}).`;
  }

  return { subnets, conflicts, status, summary };
}

/**
 * The conflicts a given input line takes part in, in the result's own order.
 *
 * Keyed on `lineNumber` rather than on array position because the caller holds
 * a list of entries, not a list of parsed subnets: a line that failed to parse
 * still occupies a row in the UI but never reaches `findOverlaps`, so position
 * in `result.subnets` and position in the user's list are not the same number.
 */
export function conflictsForLine(result: OverlapResult, lineNumber: number): Conflict[] {
  return result.conflicts.filter(
    (c) => c.a.lineNumber === lineNumber || c.b.lineNumber === lineNumber
  );
}

/**
 * The loudest severity a line is implicated in, or null when it is clean.
 *
 * A row that is contained by one subnet and identical to another should wear
 * the error badge, not the warning one, so this reports the worst rather than
 * the first.
 */
export function severityForLine(
  result: OverlapResult,
  lineNumber: number
): ConflictSeverity | null {
  const mine = conflictsForLine(result, lineNumber);
  if (mine.length === 0) return null;
  return mine.some((c) => c.severity === "error") ? "error" : "warning";
}

/** One human-readable sentence describing a conflict. */
export function describeConflict(c: Conflict): string {
  const rangeText = `overlap ${numberToIp(c.range.first)} - ${numberToIp(c.range.last)}`;
  switch (c.kind) {
    case "identical":
      return `${displayName(c.a)} (${cidrOf(c.a)}) and ${displayName(c.b)} (${cidrOf(c.b)}) are identical; ${rangeText}`;
    case "a-contains-b":
      return `${displayName(c.a)} (${cidrOf(c.a)}) contains ${displayName(c.b)} (${cidrOf(c.b)}); ${rangeText}`;
    case "b-contains-a":
      return `${displayName(c.b)} (${cidrOf(c.b)}) contains ${displayName(c.a)} (${cidrOf(c.a)}); ${rangeText}`;
    case "partial-overlap":
      return `${displayName(c.a)} (${cidrOf(c.a)}) partially overlaps ${displayName(c.b)} (${cidrOf(c.b)}); ${rangeText}`;
  }
}

/** Plain-text rendering: summary line, then worst-first conflict rows. */
export function renderOverlapText(result: OverlapResult): string {
  const lines = [result.summary];
  for (const c of result.conflicts) {
    lines.push(`${c.severity.toUpperCase().padEnd(7)}  ${describeConflict(c)}`);
  }
  return lines.join("\n");
}
