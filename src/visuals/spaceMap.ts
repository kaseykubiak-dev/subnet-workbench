/**
 * Hero visual 3B "Spans": the address-space map for Overlap mode.
 *
 * Subnets are grouped under their nearest common parent block (the plan's
 * "group by nearest common parent, zoom per group" decision). Each group
 * renders a header with the parent CIDR and one thin row per subnet, its
 * span positioned proportionally inside the parent's range. Conflicting
 * ranges get a vertical hatch band through the affected columns (amber for
 * warnings, red for errors) plus per-row WARN/ERROR tags.
 *
 * Pure function: OverlapResult in, SVG string out.
 */

import {
  intersects,
  networkAddress,
  numberToIp,
  totalHosts,
} from "../engine/ipv4";
import type { Subnet } from "../engine/ipv4";
import type { ParsedSubnet } from "../engine/parse";
import type { Conflict, OverlapResult } from "../modes/overlap";
import { displayName } from "../modes/overlap";
import { COLOR, FONT, el, hatchDefs, monoText, svgRoot, textEl } from "./svg";

/**
 * Groups whose merged parent would be broader than this stay separate.
 * A /16-or-longer common parent means the subnets genuinely share address
 * space context; merging 10.x and 192.168.x under /0 would flatten the map
 * into unreadable slivers.
 */
export const GROUP_MIN_PREFIX = 16;

/** Minimum rendered span width so tiny subnets stay visible. */
export const MIN_BAR_W = 4;

// Geometry (exported for tests).
export const VIEW_W = 992;
export const LABEL_X = 24;
export const BAR_X0 = 250;
export const BAR_X1 = 900;
export const ROW_H = 22;
export const HEADER_H = 26;
export const GROUP_GAP = 16;
export const TOP_PAD = 40;
export const BOTTOM_PAD = 16;

export interface SubnetGroup {
  parent: Subnet;
  members: ParsedSubnet[];
}

/** Smallest CIDR block containing both subnets. */
export function commonParent(a: Subnet, b: Subnet): Subnet {
  let prefix = Math.min(a.prefix, b.prefix);
  while (
    prefix > 0 &&
    networkAddress(a.network, prefix) !== networkAddress(b.network, prefix)
  ) {
    prefix--;
  }
  return { network: networkAddress(a.network, prefix), prefix };
}

/**
 * Group subnets by nearest common parent. Sorted by (network asc, prefix
 * asc); a subnet joins the current group when it intersects the group's
 * parent or the merged parent stays at /16 or longer. Conflicting subnets
 * always intersect, so conflict partners are always co-grouped.
 */
export function groupSubnets(subnets: ParsedSubnet[]): SubnetGroup[] {
  const sorted = [...subnets].sort(
    (a, b) => a.network - b.network || a.prefix - b.prefix
  );
  const groups: SubnetGroup[] = [];
  for (const s of sorted) {
    const sub: Subnet = { network: s.network, prefix: s.prefix };
    const current = groups[groups.length - 1];
    if (current) {
      const merged = commonParent(current.parent, sub);
      if (intersects(current.parent, sub) || merged.prefix >= GROUP_MIN_PREFIX) {
        current.parent = merged;
        current.members.push(s);
        continue;
      }
    }
    groups.push({ parent: { ...sub }, members: [s] });
  }
  return groups;
}

/** Total rendered height for a group list. */
export function mapHeight(groups: SubnetGroup[]): number {
  let h = TOP_PAD + BOTTOM_PAD;
  for (const g of groups) {
    h += HEADER_H + g.members.length * ROW_H + GROUP_GAP;
  }
  return groups.length > 0 ? h - GROUP_GAP : h;
}

/** Worst severity for a subnet across all conflicts, or null. */
function severityOf(
  s: ParsedSubnet,
  conflicts: Conflict[]
): "error" | "warning" | null {
  let worst: "error" | "warning" | null = null;
  for (const c of conflicts) {
    if (c.a !== s && c.b !== s) continue;
    if (c.severity === "error") return "error";
    worst = "warning";
  }
  return worst;
}

const ERR_COLOR = "#d64550";

/** Render the address-space map. */
export function renderSpaceMap(result: OverlapResult): string {
  if (result.subnets.length === 0) {
    return svgRoot(
      VIEW_W,
      80,
      { "aria-label": "Address-space map (empty)", "data-visual": "space-map" },
      monoText(LABEL_X, 46, "Nothing to map yet.", { fill: COLOR.dim })
    );
  }

  const groups = groupSubnets(result.subnets);
  const height = mapHeight(groups);
  const parts: string[] = [hatchDefs()];

  if (result.status === "all-clear") {
    parts.push(
      monoText(VIEW_W - LABEL_X, 24, "NO CONFLICTS", {
        "text-anchor": "end",
        fill: COLOR.teal,
        "font-size": 11,
      })
    );
  }

  let y = TOP_PAD;
  for (const group of groups) {
    const parentCidr = `${numberToIp(group.parent.network)}/${group.parent.prefix}`;
    const parentStart = group.parent.network;
    const parentSize = totalHosts(group.parent.prefix);
    const scale = (BAR_X1 - BAR_X0) / parentSize;
    const xOf = (address: number): number =>
      BAR_X0 + ((address >>> 0) - parentStart) * scale;

    // Group header.
    parts.push(
      monoText(LABEL_X, y + 16, parentCidr, {
        fill: COLOR.amber,
        "font-size": 11,
      }),
      el("line", {
        x1: LABEL_X,
        y1: y + HEADER_H - 4,
        x2: VIEW_W - LABEL_X,
        y2: y + HEADER_H - 4,
        stroke: COLOR.teal,
        "stroke-opacity": 0.2,
      })
    );

    const rowsTop = y + HEADER_H;
    const rowsBottom = rowsTop + group.members.length * ROW_H;

    // Conflict hatch bands (behind the rows), only conflicts in this group.
    for (const c of result.conflicts) {
      if (!group.members.includes(c.a) || !group.members.includes(c.b)) continue;
      const bx = xOf(c.range.first);
      const bw = Math.max(MIN_BAR_W, (c.range.last - c.range.first + 1) * scale);
      parts.push(
        el("rect", {
          x: bx,
          y: rowsTop + 2,
          width: bw,
          height: rowsBottom - rowsTop - 4,
          fill: c.severity === "error" ? "url(#swb-hatch-err)" : "url(#swb-hatch)",
          "data-role": "conflict-band",
          "data-severity": c.severity,
        })
      );
    }

    // Subnet rows.
    group.members.forEach((s, i) => {
      const rowY = rowsTop + i * ROW_H;
      const barY = rowY + (ROW_H - 10) / 2;
      const sx = xOf(s.network);
      const size = totalHosts(s.prefix);
      const sw = Math.max(MIN_BAR_W, size * scale);
      const severity = severityOf(s, result.conflicts);
      const cidr = `${numberToIp(s.network)}/${s.prefix}`;

      parts.push(
        textEl(
          "text",
          {
            x: LABEL_X,
            y: rowY + ROW_H / 2 + 4,
            "font-family": FONT.mono,
            "font-size": 11,
            fill: COLOR.white,
          },
          displayName(s)
        ),
        el("rect", {
          x: sx,
          y: barY,
          width: sw,
          height: 10,
          fill: COLOR.teal,
          "fill-opacity": 0.35,
          stroke: COLOR.teal,
          "stroke-opacity": 0.6,
          "data-subnet": cidr,
        })
      );

      if (severity !== null) {
        parts.push(
          monoText(
            VIEW_W - LABEL_X,
            rowY + ROW_H / 2 + 4,
            severity === "error" ? "ERROR" : "WARN",
            {
              "text-anchor": "end",
              fill: severity === "error" ? ERR_COLOR : COLOR.amber,
              "font-size": 10,
              "data-role": "row-tag",
            }
          )
        );
      }
    });

    y = rowsBottom + GROUP_GAP;
  }

  return svgRoot(
    VIEW_W,
    height,
    {
      "aria-label": `Address-space map of ${result.subnets.length} subnets`,
      "data-visual": "space-map",
    },
    ...parts
  );
}
