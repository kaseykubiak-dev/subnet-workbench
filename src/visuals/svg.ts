/**
 * Subnet Workbench: shared SVG/HTML string helpers for the hero visuals.
 *
 * All four visuals are pure render functions: verified mode results in,
 * markup strings out. Strings (not framework components) so the same code
 * slots into both the Next.js page and the single-file standalone build.
 *
 * Brand colors are emitted as `var(--color-x, #fallback)` so the visuals
 * inherit the site's Light Tennessee palette when the CSS variables exist
 * and still render correctly standalone. Alpha tints use fill-opacity/stroke-opacity
 * attributes rather than rgba() so the var() fallbacks stay usable.
 */

/**
 * Light Tennessee palette, exposed as var() references with hex fallbacks.
 * Primary accent is Tennessee Orange; the second data tone (host bits) is a
 * warm neutral smokey so the two-tone diagrams stay legible on a light panel.
 * `white` maps to ink because diagram text sits on pale tints / white ground.
 */
export const COLOR = {
  void: "var(--color-void, #ffffff)",
  deep: "var(--color-deep, #f7f6f4)",
  panel: "var(--color-panel, #f1efec)",
  blue: "var(--color-smokey, #4b4b4b)",
  glow: "var(--color-orange, #ff8200)",
  bright: "var(--color-smokey, #4b4b4b)",
  ice: "var(--color-smokey, #4b4b4b)",
  teal: "var(--color-orange, #ff8200)",
  amber: "var(--color-orange-deep, #e07200)",
  white: "var(--color-ink, #2a2a2a)",
  mid: "var(--color-smokey, #4b4b4b)",
  dim: "var(--color-smokey-light, #6e6e6e)",
} as const;

/** Font stacks matching the site's next/font variables, with fallbacks. */
export const FONT = {
  mono: "var(--font-mono, 'IBM Plex Mono', monospace)",
  display: "var(--font-display, 'Chakra Petch', sans-serif)",
} as const;

/** Escape a string for use in SVG/HTML text content and attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type Attrs = Record<string, string | number | undefined>;

/** Render an attribute map. Undefined values are omitted. */
export function attrs(a: Attrs): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(a)) {
    if (value === undefined) continue;
    parts.push(`${key}="${esc(String(value))}"`);
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/** Element with children (children are already-rendered markup, NOT escaped). */
export function el(tag: string, a: Attrs, ...children: string[]): string {
  const inner = children.join("");
  return inner === ""
    ? `<${tag}${attrs(a)}/>`
    : `<${tag}${attrs(a)}>${inner}</${tag}>`;
}

/** Text element: content IS escaped. */
export function textEl(tag: string, a: Attrs, content: string): string {
  return `<${tag}${attrs(a)}>${esc(content)}</${tag}>`;
}

/** Root SVG element with the standard shared attributes. */
export function svgRoot(
  viewWidth: number,
  viewHeight: number,
  a: Attrs,
  ...children: string[]
): string {
  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${viewWidth} ${viewHeight}`,
      role: "img",
      ...a,
    },
    ...children
  );
}

/**
 * Diagonal hatch pattern defs used by the span map for conflict bands.
 * Uses stroke-opacity so the brand var() fallback stays intact.
 */
export function hatchDefs(): string {
  const stripe = (id: string, color: string): string =>
    el(
      "pattern",
      {
        id,
        width: 6,
        height: 6,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(45)",
      },
      el("line", {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 6,
        stroke: color,
        "stroke-width": 2,
        "stroke-opacity": 0.5,
      })
    );
  return el(
    "defs",
    {},
    stripe("swb-hatch", COLOR.amber),
    stripe("swb-hatch-err", "#d64550")
  );
}

/** Standard mono label attrs (eyebrow/HUD style text). */
export function monoText(
  x: number,
  y: number,
  content: string,
  extra: Attrs = {}
): string {
  return textEl(
    "text",
    {
      x,
      y,
      "font-family": FONT.mono,
      "font-size": 11,
      "letter-spacing": "0.12em",
      fill: COLOR.mid,
      ...extra,
    },
    content
  );
}
