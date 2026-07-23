/**
 * Hero visual 2A "Splitting Bar": the prefix-slider view.
 *
 * A single horizontal bar representing the supernet, divided into the blocks
 * a target prefix produces. Alternating fills keep adjacent blocks distinct;
 * dashed ghost lines mark where the NEXT split (target+1) would cut each
 * block. The slider control itself is page-shell UI; this renders the bar
 * for a given (supernet, targetPrefix) pair. Pure function: SVG string out.
 *
 * Blocks are capped at MAX_BLOCKS: beyond that, 63 real blocks render and a
 * final cell summarizes the remainder ("+k more").
 */

import { numberToIp, totalHosts } from "../engine/ipv4";
import type { Subnet } from "../engine/ipv4";
import { COLOR, FONT, el, monoText, svgRoot, textEl } from "./svg";

export const MAX_BLOCKS = 64;

// Geometry (exported for tests).
export const VIEW_W = 992;
export const VIEW_H = 150;
export const BAR_X = 24;
export const BAR_W = 944;
export const BAR_Y = 56;
export const BAR_H = 40;

/**
 * Label for a block: the dotted tail starting at the first octet the split
 * can change. Full quad when the split reaches into the first octet.
 */
export function blockLabel(network: number, supernetPrefix: number): string {
  const octetIdx = Math.min(3, Math.floor(supernetPrefix / 8));
  const octets = numberToIp(network).split(".");
  const tail = octets.slice(octetIdx).join(".");
  return octetIdx === 0 ? tail : `.${tail}`;
}

/** Render the splitting bar. targetPrefix must be >= supernet.prefix. */
export function renderPrefixSplit(
  supernet: Subnet,
  targetPrefix: number
): string {
  const count = 2 ** (targetPrefix - supernet.prefix);
  const blockAddresses = totalHosts(targetPrefix);
  const shown = count > MAX_BLOCKS ? MAX_BLOCKS - 1 : count;
  const cidr = `${numberToIp(supernet.network)}/${supernet.prefix}`;
  const parts: string[] = [];

  // Header: supernet on the left, split summary on the right.
  parts.push(
    monoText(BAR_X, 34, cidr, { fill: COLOR.teal, "font-size": 13 }),
    monoText(BAR_X + BAR_W, 34, `-> ${count} x /${targetPrefix}`, {
      "text-anchor": "end",
      fill: COLOR.amber,
      "font-size": 13,
    })
  );

  const blockW = BAR_W / count;
  const showLabels = count <= 16;

  for (let i = 0; i < shown; i++) {
    const x = BAR_X + i * blockW;
    const network = (supernet.network + i * blockAddresses) >>> 0;
    parts.push(
      el("rect", {
        x,
        y: BAR_Y,
        width: blockW,
        height: BAR_H,
        fill: COLOR.teal,
        "fill-opacity": i % 2 === 0 ? 0.14 : 0.07,
        stroke: COLOR.teal,
        "stroke-opacity": 0.4,
        "data-block": numberToIp(network),
      })
    );
    if (showLabels) {
      parts.push(
        textEl(
          "text",
          {
            x: x + blockW / 2,
            y: BAR_Y + BAR_H / 2 + 4,
            "text-anchor": "middle",
            "font-family": FONT.mono,
            "font-size": 11,
            fill: COLOR.white,
          },
          blockLabel(network, supernet.prefix)
        )
      );
    }
    // Dashed ghost line at the block midpoint: where target+1 would cut.
    if (targetPrefix < 32) {
      parts.push(
        el("line", {
          x1: x + blockW / 2,
          y1: BAR_Y + 3,
          x2: x + blockW / 2,
          y2: BAR_Y + BAR_H - 3,
          stroke: COLOR.amber,
          "stroke-opacity": 0.45,
          "stroke-dasharray": "3 4",
          "data-role": "ghost",
        })
      );
    }
  }

  // Truncation cell.
  if (count > MAX_BLOCKS) {
    const x = BAR_X + shown * blockW;
    const w = BAR_W - shown * blockW;
    parts.push(
      el("rect", {
        x,
        y: BAR_Y,
        width: w,
        height: BAR_H,
        fill: COLOR.amber,
        "fill-opacity": 0.08,
        stroke: COLOR.amber,
        "stroke-opacity": 0.4,
        "stroke-dasharray": "4 3",
      }),
      textEl(
        "text",
        {
          x: x + w / 2,
          y: BAR_Y + BAR_H / 2 + 4,
          "text-anchor": "middle",
          "font-family": FONT.mono,
          "font-size": 11,
          fill: COLOR.amber,
        },
        `+${count - shown} more`
      )
    );
  }

  // Footer: per-block size.
  parts.push(
    monoText(
      BAR_X,
      BAR_Y + BAR_H + 30,
      `${blockAddresses.toLocaleString("en-US")} addresses per /${targetPrefix}`,
      { fill: COLOR.dim, "font-size": 11 }
    )
  );

  return svgRoot(
    VIEW_W,
    VIEW_H,
    {
      "aria-label": `${cidr} split into ${count} /${targetPrefix} blocks`,
      "data-visual": "prefix-split",
    },
    ...parts
  );
}
