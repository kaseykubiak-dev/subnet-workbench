/**
 * Hero visual 1A "Ribbon": the 32-bit view for Calculate mode.
 *
 * One row of 32 bit cells with a visible gap between octets, the address's
 * binary written into the cells, and an amber boundary line where the prefix
 * ends. NETWORK / HOST brackets underneath make the split legible at a
 * glance. Pure function: address + prefix in, SVG string out.
 */

import { numberToIp } from "../engine/ipv4";
import { COLOR, FONT, el, monoText, svgRoot, textEl } from "./svg";

// Geometry (exported for tests).
export const CELL_W = 28;
export const OCTET_GAP = 16;
export const X0 = 24;
export const Y0 = 70;
export const CELL_H = 44;
export const VIEW_W = 992;
export const VIEW_H = 200;

/** Left edge of bit cell i (0-31). Octet gaps accumulate every 8 bits. */
export function bitX(i: number): number {
  return X0 + i * CELL_W + Math.floor(i / 8) * OCTET_GAP;
}

/** X position of the amber boundary line for a given prefix. */
export function boundaryX(prefix: number): number {
  return bitX(prefix) - 2;
}

/**
 * Render the bit ribbon for an address and prefix.
 *
 * When `splitTarget` is past the prefix, a teal caret marker with a thin
 * drop line shows where the prefix-split boundary falls among the bits;
 * it tracks the split slider as the user drags.
 */
export function renderBitRibbon(
  address: number,
  prefix: number,
  splitTarget?: number
): string {
  const addr = address >>> 0;
  const ip = numberToIp(addr);
  const parts: string[] = [];

  // Octet decimal values centered above each 8-cell group.
  const octets = ip.split(".");
  for (let o = 0; o < 4; o++) {
    const left = bitX(o * 8);
    const right = bitX(o * 8 + 7) + CELL_W;
    parts.push(
      monoText((left + right) / 2, 40, octets[o] ?? "", {
        "text-anchor": "middle",
        "font-size": 14,
        fill: COLOR.bright,
      })
    );
  }

  // Bit cells.
  for (let i = 0; i < 32; i++) {
    const isNet = i < prefix;
    const bit = (addr >>> (31 - i)) & 1;
    const x = bitX(i);
    parts.push(
      el("rect", {
        x,
        y: Y0,
        width: CELL_W - 2,
        height: CELL_H,
        fill: isNet ? COLOR.teal : COLOR.blue,
        "fill-opacity": isNet ? 0.14 : 0.07,
        stroke: isNet ? COLOR.teal : COLOR.dim,
        "stroke-opacity": isNet ? 0.45 : 0.35,
        "data-bit-role": isNet ? "net" : "host",
      }),
      textEl(
        "text",
        {
          x: x + (CELL_W - 2) / 2,
          y: Y0 + CELL_H / 2 + 5,
          "text-anchor": "middle",
          "font-family": FONT.mono,
          "font-size": 14,
          fill: isNet ? COLOR.white : COLOR.mid,
          "data-role": "bit",
        },
        String(bit)
      )
    );
  }

  // Amber boundary line + prefix tag.
  const bx = boundaryX(prefix);
  parts.push(
    el("line", {
      x1: bx,
      y1: Y0 - 14,
      x2: bx,
      y2: Y0 + CELL_H + 14,
      stroke: COLOR.amber,
      "stroke-width": 2,
      "data-role": "boundary",
    }),
    monoText(bx, Y0 - 22, `/${prefix}`, {
      "text-anchor": "middle",
      fill: COLOR.amber,
      "font-size": 12,
    })
  );

  // Teal caret marker for the split target (only once it passes the mask).
  if (splitTarget !== undefined && splitTarget > prefix && splitTarget <= 32) {
    const sx = boundaryX(splitTarget);
    parts.push(
      el("path", {
        d: `M ${sx - 6} ${Y0 - 18} L ${sx + 6} ${Y0 - 18} L ${sx} ${Y0 - 8} Z`,
        fill: COLOR.teal,
        "data-role": "split-marker",
      }),
      el("line", {
        x1: sx,
        y1: Y0 - 8,
        x2: sx,
        y2: Y0 + CELL_H + 10,
        stroke: COLOR.teal,
        "stroke-width": 1.5,
        "stroke-opacity": 0.8,
        "data-role": "split-marker",
      }),
      monoText(sx, Y0 - 26, `/${splitTarget}`, {
        "text-anchor": "middle",
        fill: COLOR.teal,
        "font-size": 12,
        "data-role": "split-marker",
      })
    );
  }

  // NETWORK / HOST brackets under the row.
  const bktY = Y0 + CELL_H + 26;
  const bracket = (
    from: number,
    to: number,
    label: string,
    color: string
  ): void => {
    const left = bitX(from);
    const right = bitX(to) + CELL_W - 2;
    parts.push(
      el("path", {
        d: `M ${left} ${bktY} v 6 H ${right} v -6`,
        fill: "none",
        stroke: color,
        "stroke-opacity": 0.6,
      }),
      monoText((left + right) / 2, bktY + 22, label, {
        "text-anchor": "middle",
        fill: color,
        "font-size": 10,
      })
    );
  };
  if (prefix > 0) bracket(0, prefix - 1, `NETWORK (${prefix} bits)`, COLOR.teal);
  if (prefix < 32)
    bracket(prefix, 31, `HOST (${32 - prefix} bits)`, COLOR.bright);

  return svgRoot(
    VIEW_W,
    VIEW_H,
    { "aria-label": `Binary view of ${ip}/${prefix}`, "data-visual": "bit-ribbon" },
    ...parts
  );
}
