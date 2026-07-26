/**
 * Capacity-mode view fragments: Variant A "Stacked fill bar" (chosen
 * 2026-07-25 from mockups/cloud-capacity-mockups.html), with the mode
 * comparison card borrowed from Variant B.
 *
 * Pure like src/shell/view.ts and src/shell/cloudView.ts: state in, HTML
 * strings out, no DOM. It is a peer of cloudView rather than part of it
 * because capacity answers a different question — cloudView asks "will this
 * subnet deploy", capacity asks "how big does it have to be" — and the two
 * share nothing but the platform.
 *
 * Three deliberate departures from the mockup:
 *
 * 1. There is no workload toggle. Which estimator runs is decided by the
 *    global platform: Azure gives AKS, AWS gives EKS, on-prem gives a nudge
 *    toward the picker. A local toggle would let you look at EKS numbers
 *    under Azure's constraints, which is a wrong answer the tool can simply
 *    refuse to render.
 *
 * 2. The mockup's fill bar hard-codes four segments (reserved / node / pod /
 *    free) because it draws one worked example. Here the used segments come
 *    from `estimate.breakdown`, but only when the lines actually sum to the
 *    total. EKS's breakdown does not: its first line is per-node and its
 *    second is the cluster rollup, so stacking them would double-count.
 *    See `capacitySegments`.
 *
 * 3. The address ticks under the bar are replaced by prefix / total / free.
 *    Capacity estimates a size, not a placement, so there is no first or last
 *    address to label. Pretending otherwise would invite someone to read a
 *    made-up network address off the chart.
 */

import {
  AKS_DEFAULT_MAX_PODS,
  estimateAks,
  estimateEks,
  type AksNetworkMode,
  type CapacityEstimate,
  type EksIpMode,
} from "../cloud/capacity";
import {
  cloudUsableHosts,
  platformById,
  type Platform,
  type PlatformId,
} from "../cloud/platforms";
import { esc } from "../visuals/svg";
import type { ShellState } from "./state";
import { AKS_MODES, EKS_MODES, aksPlanFor, eksPlanFor } from "./state";

/** Thousands separators, matching cloudView. */
function num(value: number): string {
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// The estimate for the current state
// ---------------------------------------------------------------------------

/**
 * The estimate implied by the current state, or null on-prem.
 *
 * The estimators throw RangeError rather than guess at a nonsensical plan.
 * State clamps every field before it gets here, so a throw would mean a real
 * defect; catching it anyway keeps a bad shared link from blanking the page.
 */
export function capacityEstimateFor(state: ShellState): CapacityEstimate | null {
  if (state.platform === "none") return null;
  try {
    return state.platform === "aws"
      ? estimateEks(eksPlanFor(state), "aws")
      : estimateAks(aksPlanFor(state), "azure");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The fill bar
// ---------------------------------------------------------------------------

export interface CapacitySegment {
  label: string;
  addresses: number;
  kind: "reserved" | "used" | "free";
}

/**
 * Segments for the fill bar, in draw order: reserved, then the used space,
 * then whatever is left in the chosen prefix.
 *
 * The used space is `estimate.breakdown` only when those lines sum to
 * `estimate.addresses`. AKS's node-subnet breakdown does sum (nodes + pods);
 * EKS's does not, because "Addresses held per node" is a per-node figure and
 * "Cluster total" is the rollup of it. Rendering both as stacked segments
 * would draw a bar longer than the subnet. Falling back to one honest
 * "Addresses required" segment is better than a chart that lies.
 *
 * Returns [] when nothing fits, because there is no block to draw.
 */
export function capacitySegments(
  estimate: CapacityEstimate,
  platform: Platform
): CapacitySegment[] {
  if (estimate.prefix === null) return [];
  const total = 2 ** (32 - estimate.prefix);
  const usable = cloudUsableHosts(estimate.prefix, platform);
  const sum = estimate.breakdown.reduce((t, line) => t + line.addresses, 0);
  const additive = estimate.breakdown.length > 1 && sum === estimate.addresses;
  const used: CapacitySegment[] = additive
    ? estimate.breakdown.map((line) => ({
        label: line.label,
        addresses: line.addresses,
        kind: "used" as const,
      }))
    : [{ label: "Addresses required", addresses: estimate.addresses, kind: "used" as const }];
  const all: CapacitySegment[] = [
    {
      label: `${platform.name} reserved`,
      addresses: platform.reservedPerSubnet,
      kind: "reserved",
    },
    ...used,
    {
      label: "Free",
      addresses: Math.max(0, usable - estimate.addresses),
      kind: "free",
    },
  ];
  // Free always shows, even at zero, because "no headroom left" is the single
  // most useful thing the bar can say. Empty used segments just drop out.
  return all
    .filter((seg) => seg.addresses > 0 || seg.kind === "free")
    .map((seg) => ({ ...seg, addresses: Math.min(seg.addresses, total) }));
}

/** Class for a segment: used segments alternate so adjacent ones separate. */
function segmentClass(seg: CapacitySegment, usedIndex: number): string {
  if (seg.kind === "reserved") return "swb-cap-res";
  if (seg.kind === "free") return "swb-cap-free";
  return usedIndex % 2 === 0 ? "swb-cap-u0" : "swb-cap-u1";
}

function renderBar(segments: CapacitySegment[], total: number): string {
  let usedIndex = 0;
  const bars = segments
    .map((seg) => {
      const cls = segmentClass(seg, usedIndex);
      if (seg.kind === "used") usedIndex += 1;
      // Percentages are rounded for CSS but the labels beside them carry the
      // exact counts, so a sub-pixel segment is never the only readout.
      const pct = ((seg.addresses / total) * 100).toFixed(2);
      return (
        `<div class="swb-cap-seg ${cls}" style="width:${pct}%" ` +
        `title="${esc(seg.label)}: ${num(seg.addresses)}"></div>`
      );
    })
    .join("");
  return `<div class="swb-cap-bar">${bars}</div>`;
}

function renderLegend(segments: CapacitySegment[]): string {
  let usedIndex = 0;
  const items = segments
    .map((seg) => {
      const cls = segmentClass(seg, usedIndex);
      if (seg.kind === "used") usedIndex += 1;
      return (
        `<div class="swb-cap-key"><span class="swb-cap-sw ${cls}"></span>` +
        `${esc(seg.label)} &middot; ${num(seg.addresses)}</div>`
      );
    })
    .join("");
  return `<div class="swb-cap-legend">${items}</div>`;
}

// ---------------------------------------------------------------------------
// Breakdown, warnings, companions
// ---------------------------------------------------------------------------

function renderBreakdown(estimate: CapacityEstimate): string {
  const rows = estimate.breakdown
    .map(
      (line) =>
        `<tr><td class="swb-cap-lbl">${esc(line.label)}</td>` +
        `<td>${esc(line.detail ?? "")}</td>` +
        `<td class="swb-cap-n">${num(line.addresses)}</td></tr>`
    )
    .join("");
  return (
    `<table class="swb-cap-table">` +
    `<thead><tr><th>Line</th><th>Arithmetic</th><th class="swb-cap-n">Addresses</th></tr></thead>` +
    `<tbody>${rows}` +
    `<tr class="swb-cap-total"><td class="swb-cap-lbl">Total</td>` +
    `<td>Usable addresses required. The platform's reserved set is added when the ` +
    `prefix is chosen, never here.</td>` +
    `<td class="swb-cap-n">${num(estimate.addresses)}</td></tr>` +
    `</tbody></table>`
  );
}

function renderWarnings(estimate: CapacityEstimate): string {
  return estimate.warnings
    .map(
      (w) =>
        `<div class="swb-cap-warn"><span class="swb-sev swb-sev-warning">Warning</span>` +
        `<span>${esc(w)}</span></div>`
    )
    .join("");
}

function renderCompanions(estimate: CapacityEstimate): string {
  return estimate.companions
    .map((c) => {
      const tag = c.separateFromVnet
        ? `<span class="swb-cap-tag">Outside the VNet</span>`
        : `<span class="swb-cap-tag">Additional subnet</span>`;
      return (
        `<div class="swb-cap-companion">` +
        `<h4>${esc(c.name)} &middot; ${num(c.addresses)} addresses ${tag}</h4>` +
        `<p>${esc(c.detail)}</p>` +
        `</div>`
      );
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Mode comparison (borrowed from Variant B)
// ---------------------------------------------------------------------------

/**
 * The same workload costed under every networking mode.
 *
 * This is the card that earns the whole panel: on Azure, flipping node-subnet
 * to overlay takes 50 nodes from a /21 to a /26 and moves 13,056 addresses
 * into a CIDR outside the VNet. Nobody discovers that by reading one estimate.
 */
function renderComparison(state: ShellState): string {
  const cards =
    state.platform === "aws"
      ? EKS_MODES.map((m) => comparisonCard(m.label, m.id === state.eksMode, () =>
          estimateEks({ ...eksPlanFor(state), mode: m.id as EksIpMode }, "aws")
        ))
      : AKS_MODES.map((m) => comparisonCard(m.label, m.id === state.aksMode, () =>
          estimateAks({ ...aksPlanFor(state), mode: m.id as AksNetworkMode }, "azure")
        ));
  return (
    `<div class="swb-field-label">Same workload, every mode</div>` +
    `<div class="swb-cap-compare">${cards.join("")}</div>`
  );
}

function comparisonCard(label: string, active: boolean, run: () => CapacityEstimate): string {
  let estimate: CapacityEstimate;
  try {
    estimate = run();
  } catch {
    return "";
  }
  const companion = estimate.companions[0];
  const note =
    companion !== undefined
      ? `${num(estimate.addresses)} in the subnet, plus a ${num(companion.addresses)}-address ` +
        `${companion.name.toLowerCase()}.`
      : `${num(estimate.addresses)} addresses in the subnet.`;
  return (
    `<div class="swb-cap-card${active ? " swb-cap-card-on" : ""}">` +
    `<h4>${esc(label)}</h4>` +
    `<div class="swb-cap-card-p">${estimate.prefix === null ? "&mdash;" : `/${estimate.prefix}`}</div>` +
    `<p>${esc(note)}</p>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Input panel
// ---------------------------------------------------------------------------

function numField(field: string, label: string, value: number, min: number): string {
  return (
    `<div class="swb-cap-field"><label class="swb-field-label" for="swb-${esc(field)}">${esc(label)}</label>` +
    `<input class="swb-input swb-num" id="swb-${esc(field)}" data-field="${esc(field)}" ` +
    `type="number" min="${min}" value="${value}"></div>`
  );
}

function selectField(
  field: string,
  label: string,
  options: { id: string; label: string }[],
  selected: string
): string {
  const opts = options
    .map(
      (o) =>
        `<option value="${esc(o.id)}"${o.id === selected ? " selected" : ""}>${esc(o.label)}</option>`
    )
    .join("");
  return (
    `<label class="swb-field-label" for="swb-${esc(field)}">${esc(label)}</label>` +
    `<select class="swb-input swb-select" id="swb-${esc(field)}" data-field="${esc(field)}">${opts}</select>`
  );
}

/** The Capacity left column. Which estimator's inputs show is the platform's call. */
export function renderCapacityInputs(state: ShellState): string {
  if (state.platform === "none") {
    return (
      `<div class="swb-field-label">Workload</div>` +
      `<p class="swb-cap-nudge">Capacity sizes a Kubernetes node subnet against a real ` +
      `platform's reserved addresses and prefix limits. Pick Azure or AWS above and the ` +
      `matching inputs appear here.</p>`
    );
  }
  if (state.platform === "aws") {
    return (
      selectField("eksMode", "VPC CNI mode", EKS_MODES, state.eksMode) +
      `<div class="swb-cap-fields">` +
      numField("eksNodes", "Nodes", state.eksNodes, 0) +
      numField("eksPodsPerNode", "Pods / node", state.eksPodsPerNode, 0) +
      numField("eksEnisPerNode", "ENIs / node", state.eksEnisPerNode, 1) +
      numField("eksIpsPerEni", "IPs / ENI", state.eksIpsPerEni, 2) +
      `</div>` +
      `<label class="swb-cap-check"><input type="checkbox" data-field="eksCustomNetworking"` +
      `${state.eksCustomNetworking ? " checked" : ""}> Custom networking (pods on a secondary CIDR)</label>` +
      `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Reset</button></div>`
    );
  }
  // The placeholder carries the mode's own default, which differs by more than
  // 8x across modes, so an empty box still tells you what it will assume.
  const podsDefault = AKS_DEFAULT_MAX_PODS[state.aksMode];
  return (
    selectField("aksMode", "Network mode", AKS_MODES, state.aksMode) +
    `<div class="swb-cap-fields">` +
    numField("aksNodes", "Nodes", state.aksNodes, 0) +
    `<div class="swb-cap-field"><label class="swb-field-label" for="swb-aksMaxPods">Max pods / node</label>` +
    `<input class="swb-input swb-num" id="swb-aksMaxPods" data-field="aksMaxPods" type="number" ` +
    `min="0" placeholder="${podsDefault}" value="${state.aksMaxPods ?? ""}"></div>` +
    numField("aksMaxSurge", "Max surge", state.aksMaxSurge, 0) +
    `</div>` +
    `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Reset</button></div>`
  );
}

// ---------------------------------------------------------------------------
// Output panel
// ---------------------------------------------------------------------------

const HINT_SVG_CAPACITY =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="22" width="86" height="20" fill="none" stroke="#9a9a9a" stroke-opacity="0.7"/>` +
  `<rect x="2" y="22" width="6" height="20" fill="#4b4b4b" fill-opacity="0.5"/>` +
  `<rect x="8" y="22" width="14" height="20" fill="#e07200" fill-opacity="0.7"/>` +
  `<rect x="22" y="22" width="44" height="20" fill="#ff8200" fill-opacity="0.55"/>` +
  `<line x1="66" y1="18" x2="66" y2="46" stroke="#e07200" stroke-dasharray="3 3"/>` +
  `</svg>`;

/** The Capacity right column. */
export function renderCapacityOutput(state: ShellState): string {
  if (state.platform === "none") {
    return (
      `<div class="swb-hint">${HINT_SVG_CAPACITY}<p><b>Waiting on a platform.</b> ` +
      `Pod addressing is the thing that sinks a cloud subnet, and how much it costs depends ` +
      `entirely on whose network you are on. Choose Azure or AWS in the platform picker.</p></div>`
    );
  }
  const estimate = capacityEstimateFor(state);
  const platform = platformById(state.platform as PlatformId);
  if (estimate === null) {
    return (
      `<div class="swb-errors"><div class="swb-error">` +
      `That plan cannot be costed. Check the node, pod, and ENI counts.` +
      `</div></div>`
    );
  }

  const prefix = estimate.prefix;
  if (prefix === null) {
    // Nothing fits, so there is no block to draw and no free space to report.
    // The breakdown and the comparison cards still earn their place: the whole
    // point is usually that another networking mode does fit.
    return (
      `<div class="swb-cap-answer"><div class="swb-cap-big">&mdash;</div>` +
      `<div class="swb-cap-sub">${num(estimate.addresses)} addresses needed &middot; ` +
      `more than one ${esc(platform.name)} subnet can hold</div></div>` +
      renderBreakdown(estimate) +
      renderWarnings(estimate) +
      renderCompanions(estimate) +
      renderComparison(state)
    );
  }

  const total = 2 ** (32 - prefix);
  const usable = cloudUsableHosts(prefix, platform);
  const free = Math.max(0, usable - estimate.addresses);
  const segments = capacitySegments(estimate, platform);

  return (
    `<div class="swb-cap-answer"><div class="swb-cap-big">/${prefix}</div>` +
    `<div class="swb-cap-sub">${num(estimate.addresses)} addresses needed &middot; ` +
    `${num(usable)} usable in a /${prefix} &middot; ${num(free)} free</div></div>` +
    renderBar(segments, total) +
    `<div class="swb-cap-ticks"><span>/${prefix}</span>` +
    `<span>${num(total)} addresses</span>` +
    `<span>${num(free)} free</span></div>` +
    renderLegend(segments) +
    renderBreakdown(estimate) +
    renderWarnings(estimate) +
    renderCompanions(estimate) +
    renderComparison(state)
  );
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

export const CAPACITY_CSS = `
.swb-cap-fields { display: flex; flex-wrap: wrap; gap: 12px; }
.swb-cap-field { display: flex; flex-direction: column; }
.swb-cap-field .swb-field-label { margin-top: 14px; }
.swb-cap-field .swb-num { width: 96px; }
.swb-cap-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; font-size: 0.74rem; font-weight: 300; line-height: 1.5; color: var(--color-smokey, #4b4b4b); cursor: pointer; }
.swb-cap-check input { accent-color: var(--color-orange, #ff8200); margin-top: 2px; }
.swb-cap-nudge { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; line-height: 1.9; color: var(--color-smokey-light, #6e6e6e); margin: 0; }
.swb-cap-answer { display: flex; align-items: baseline; flex-wrap: wrap; gap: 14px; margin-bottom: 6px; }
.swb-cap-big { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 2.4rem; font-weight: 700; color: var(--color-orange-deep, #e07200); line-height: 1; }
.swb-cap-sub { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.72rem; color: var(--color-smokey, #4b4b4b); }
.swb-cap-bar { display: flex; height: 42px; border: 1px solid var(--color-line, #e4e1dc); margin: 18px 0 8px; overflow: hidden; }
.swb-cap-seg { min-width: 1px; }
.swb-cap-res { background: var(--color-smokey, #4b4b4b); }
.swb-cap-u0 { background: var(--color-orange-deep, #e07200); }
.swb-cap-u1 { background: var(--color-orange, #ff8200); }
.swb-cap-free { background: var(--color-warm, #e9e6e1); background-image: repeating-linear-gradient(45deg, rgba(75,75,75,0.10) 0 4px, transparent 4px 9px); }
.swb-cap-ticks { display: flex; justify-content: space-between; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.62rem; color: var(--color-smokey-light, #6e6e6e); margin-bottom: 18px; }
.swb-cap-legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
.swb-cap-key { display: flex; align-items: center; gap: 8px; font-size: 0.74rem; font-weight: 300; color: var(--color-smokey, #4b4b4b); }
.swb-cap-sw { width: 13px; height: 13px; flex-shrink: 0; border: 1px solid rgba(75,75,75,0.16); }
.swb-cap-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
.swb-cap-table th { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); text-align: left; padding: 0 12px 8px 0; border-bottom: 1px solid var(--color-line, #e4e1dc); font-weight: 400; }
.swb-cap-table td { padding: 11px 12px 11px 0; border-bottom: 1px solid var(--color-line, #e4e1dc); font-size: 0.78rem; font-weight: 300; line-height: 1.6; vertical-align: top; color: var(--color-smokey, #4b4b4b); }
.swb-cap-table .swb-cap-n { font-family: var(--font-mono, 'IBM Plex Mono', monospace); text-align: right; width: 96px; padding-right: 0; color: var(--color-ink, #2a2a2a); white-space: nowrap; }
.swb-cap-table .swb-cap-lbl { width: 190px; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.72rem; color: var(--color-ink, #2a2a2a); }
.swb-cap-total td { border-bottom: none; padding-top: 14px; color: var(--color-ink, #2a2a2a); }
.swb-cap-total .swb-cap-n { color: var(--color-orange-deep, #e07200); font-size: 0.86rem; }
.swb-cap-warn { margin-top: 16px; display: flex; gap: 12px; align-items: flex-start; background: var(--tool-warn-bg, rgba(224,114,0,0.08)); border-left: 2px solid var(--color-orange, #ff8200); padding: 12px 14px; font-size: 0.78rem; font-weight: 300; line-height: 1.6; color: var(--color-smokey, #4b4b4b); }
.swb-cap-companion { margin-top: 18px; border: 1px dashed var(--color-line, #e4e1dc); background: var(--color-deep, #f7f6f4); padding: 14px 16px; }
.swb-cap-companion h4 { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 0.86rem; font-weight: 600; margin: 0 0 6px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; color: var(--color-ink, #2a2a2a); }
.swb-cap-companion p { margin: 0; font-size: 0.78rem; font-weight: 300; line-height: 1.65; color: var(--color-smokey, #4b4b4b); }
.swb-cap-tag { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.52rem; letter-spacing: 0.14em; text-transform: uppercase; background: var(--color-panel, #f1efec); padding: 2px 7px; border: 1px solid var(--color-line, #e4e1dc); color: var(--color-smokey-light, #6e6e6e); }
.swb-cap-compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.swb-cap-card { border: 1px solid var(--color-line, #e4e1dc); padding: 14px 16px; }
.swb-cap-card-on { border-color: var(--tool-bord-strong, rgba(255,130,0,0.5)); background: var(--tool-row-sel, rgba(255,130,0,0.1)); }
.swb-cap-card h4 { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 0.8rem; font-weight: 600; margin: 0 0 4px; color: var(--color-ink, #2a2a2a); }
.swb-cap-card-p { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 1.5rem; font-weight: 700; color: var(--color-orange-deep, #e07200); line-height: 1.1; }
.swb-cap-card p { margin: 6px 0 0; font-size: 0.74rem; font-weight: 300; line-height: 1.6; color: var(--color-smokey, #4b4b4b); }
@media (max-width: 768px) {
  .swb-cap-table .swb-cap-lbl { width: auto; }
}
`.trim();
