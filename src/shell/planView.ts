/**
 * Plan-mode view fragments: Variant A "Indented tree with inline utilization"
 * (chosen 2026-07-25 from mockups/cloud-hierarchy-mockups.html), with the
 * four-stat strip borrowed from Variant B.
 *
 * Pure like src/shell/view.ts, cloudView.ts and capacityView.ts: state in,
 * HTML strings out, no DOM.
 *
 * Variant A won on the strength of one idea: free blocks render as hatched
 * rows in the position they actually occupy, so "where can the next subnet go"
 * is answered in the same glance as "what is already there". It is also just
 * more rows, which is what a plan becomes when it grows to forty subnets.
 *
 * Four deliberate departures from the mockup:
 *
 * 1. VNet rows carry their CIDR inline beside the name. The mockup spends the
 *    middle column on the utilization bar and drops the VNet's own prefix,
 *    which is the one number a person reads a plan to find.
 *
 * 2. The four VnetUtilization numbers come back as a plan-wide strip above the
 *    tree rather than a per-VNet panel. Per-VNet they would triple the height
 *    of every row group; aggregated they say the thing nobody budgets for,
 *    which is how many addresses the platform's reserved set has quietly
 *    taken across every subnet in the plan.
 *
 * 3. Subnets that escaped their VNet are listed after the free blocks, not
 *    interleaved by address. They are not part of the free-space arithmetic,
 *    so sorting them into it would imply an accounting they are outside of.
 *
 * 4. Declared external ranges get their own rows at the foot of the tree. The
 *    mockup shows them only through the findings they cause, which leaves a
 *    plan that happens to be clean silently forgetting they were declared.
 */

import { contains, numberToIp, totalHosts } from "../engine/ipv4";
import type { ParseError } from "../engine/parse";
import {
  blockCidr,
  pathText,
  renderPlanText,
  validatePlan,
  vnetUtilization,
  type AddressPlan,
  type PlanFinding,
  type PlanPath,
  type PlanRegion,
  type PlanReport,
  type PlanSeverity,
  type PlanSubnet,
  type PlanVnet,
  type VnetUtilization,
} from "../cloud/hierarchy";
import { parsePlanText } from "../cloud/planText";
import { esc } from "../visuals/svg";
import type { ShellState } from "./state";

/** Thousands separators, matching cloudView and capacityView. */
function num(value: number): string {
  return value.toLocaleString("en-US");
}

const SEVERITY_LABEL: Record<PlanSeverity, string> = {
  error: "Error",
  warning: "Warning",
};

// ---------------------------------------------------------------------------
// The plan and its report for the current state
// ---------------------------------------------------------------------------

export interface PlanViewModel {
  plan: AddressPlan;
  report: PlanReport;
  errors: ParseError[];
}

/** Parse the pasted plan and validate it. Bad lines are reported, not fatal. */
export function planViewModel(state: ShellState): PlanViewModel {
  const { plan, errors } = parsePlanText(state.planInput, state.platform);
  return { plan, report: validatePlan(plan), errors };
}

// ---------------------------------------------------------------------------
// Flagging rows from findings
// ---------------------------------------------------------------------------

/**
 * Worst severity per tree path, so a row can be flagged without re-running any
 * of the checks. Both sides of a two-sided finding are flagged: an overlap is
 * not the fault of whichever object the sort happened to put first.
 */
export function severityByPath(findings: PlanFinding[]): Map<string, PlanSeverity> {
  const worst = new Map<string, PlanSeverity>();
  const mark = (path: PlanPath | undefined, severity: PlanSeverity): void => {
    if (path === undefined) return;
    const key = pathText(path);
    if (worst.get(key) === "error") return;
    worst.set(key, severity);
  };
  for (const finding of findings) {
    mark(finding.a, finding.severity);
    mark(finding.b, finding.severity);
  }
  return worst;
}

function flagClass(severity: PlanSeverity | undefined): string {
  if (severity === undefined) return "";
  return severity === "error" ? " swb-plan-flag" : " swb-plan-flag swb-plan-flag-w";
}

// ---------------------------------------------------------------------------
// Tree rows
// ---------------------------------------------------------------------------

function regionRow(region: PlanRegion, severity: PlanSeverity | undefined): string {
  return (
    `<div class="swb-plan-row swb-plan-region${flagClass(severity)}">` +
    `<span class="swb-plan-name"><span class="swb-plan-kind">Region</span>${esc(region.name)}</span>` +
    `<span class="swb-plan-cidr">${esc(blockCidr(region))}</span>` +
    `<span class="swb-plan-pct"></span>` +
    `</div>`
  );
}

function vnetRow(
  vnet: PlanVnet,
  util: VnetUtilization,
  severity: PlanSeverity | undefined
): string {
  const pct = util.allocatedFraction * 100;
  // Clamped for the bar only: a VNet whose subnets overlap can allocate more
  // than it holds, and a bar wider than its track is a rendering bug, not a
  // finding. The percentage beside it still reads over 100 and says so.
  const width = Math.min(100, Math.max(0, pct)).toFixed(1);
  return (
    `<div class="swb-plan-row swb-plan-vnet${flagClass(severity)}">` +
    `<span class="swb-plan-name">${esc(vnet.name)}` +
    `<span class="swb-plan-inline-cidr">${esc(blockCidr(vnet))}</span></span>` +
    `<span class="swb-plan-util"><i style="width:${width}%"></i></span>` +
    `<span class="swb-plan-pct">${pct.toFixed(1)}%</span>` +
    `</div>`
  );
}

function subnetRow(
  subnet: PlanSubnet,
  severity: PlanSeverity | undefined,
  outside: boolean
): string {
  const tag = outside ? `<span class="swb-plan-tag">outside VNet</span>` : "";
  return (
    `<div class="swb-plan-row swb-plan-subnet${flagClass(severity)}">` +
    `<span class="swb-plan-name">${esc(subnet.name)}${tag}</span>` +
    `<span class="swb-plan-cidr">${esc(blockCidr(subnet))}</span>` +
    `<span class="swb-plan-pct">${num(totalHosts(subnet.prefix))}</span>` +
    `</div>`
  );
}

function freeRow(block: { network: number; prefix: number }, largest: boolean): string {
  const note = largest ? ` &nbsp;&#8592; largest free block` : "";
  return (
    `<div class="swb-plan-free">free &middot; <b>${esc(blockCidr(block))}</b> &middot; ` +
    `${num(totalHosts(block.prefix))}${note}</div>`
  );
}

/**
 * One VNet's rows: header, then subnets and free blocks interleaved in address
 * order, then anything that escaped the VNet entirely.
 */
function vnetGroup(
  region: PlanRegion,
  vnet: PlanVnet,
  util: VnetUtilization,
  worst: Map<string, PlanSeverity>
): string {
  const sevFor = (subnet: string): PlanSeverity | undefined =>
    worst.get(pathText({ region: region.name, vnet: vnet.name, subnet }));

  const inside = vnet.subnets.filter((s) => contains(vnet, s));
  const outside = vnet.subnets.filter((s) => !contains(vnet, s));
  const largestKey =
    util.largestFree === null
      ? null
      : `${util.largestFree.network}/${util.largestFree.prefix}`;

  type Row = { network: number; html: string };
  const rows: Row[] = [
    ...inside.map((s) => ({ network: s.network, html: subnetRow(s, sevFor(s.name), false) })),
    ...util.free.map((b) => ({
      network: b.network,
      html: freeRow(b, `${b.network}/${b.prefix}` === largestKey),
    })),
  ].sort((a, b) => a.network - b.network);

  return (
    vnetRow(vnet, util, worst.get(pathText({ region: region.name, vnet: vnet.name }))) +
    rows.map((r) => r.html).join("") +
    outside.map((s) => subnetRow(s, sevFor(s.name) ?? "error", true)).join("")
  );
}

function renderTree(plan: AddressPlan, report: PlanReport): string {
  const worst = severityByPath(report.findings);
  const utilByPath = new Map(report.utilization.map((u) => [pathText(u.path), u]));

  const body = plan.regions
    .map((region) => {
      const groups = region.vnets
        .map((vnet) => {
          const key = pathText({ region: region.name, vnet: vnet.name });
          const util =
            utilByPath.get(key) ?? vnetUtilization(region, vnet, plan.platform);
          return vnetGroup(region, vnet, util, worst);
        })
        .join("");
      return regionRow(region, worst.get(pathText({ region: region.name }))) + groups;
    })
    .join("");

  const external = plan.external ?? [];
  const externalRows =
    external.length === 0
      ? ""
      : `<div class="swb-plan-row swb-plan-region"><span class="swb-plan-name">` +
        `<span class="swb-plan-kind">External</span>Declared ranges</span>` +
        `<span class="swb-plan-cidr"></span><span class="swb-plan-pct"></span></div>` +
        external
          .map(
            (range) =>
              `<div class="swb-plan-row swb-plan-subnet swb-plan-ext">` +
              `<span class="swb-plan-name">${esc(range.name)}` +
              (range.detail !== undefined
                ? `<span class="swb-plan-tag">${esc(range.detail)}</span>`
                : "") +
              `</span>` +
              `<span class="swb-plan-cidr">${esc(blockCidr(range))}</span>` +
              `<span class="swb-plan-pct">${num(totalHosts(range.prefix))}</span>` +
              `</div>`
          )
          .join("");

  return `<div class="swb-plan-tree">${body}${externalRows}</div>`;
}

// ---------------------------------------------------------------------------
// Stats strip (borrowed from Variant B)
// ---------------------------------------------------------------------------

function stat(label: string, value: string, note: string): string {
  return (
    `<div class="swb-plan-stat"><dt>${esc(label)}</dt>` +
    `<dd>${esc(value)}</dd><span>${esc(note)}</span></div>`
  );
}

/**
 * The four VnetUtilization numbers, summed across the plan.
 *
 * Reserved overhead is the one that earns the strip. Every subnet in a cloud
 * VNet gives up five addresses rather than the two RFC 1918 would take, and
 * across thirty subnets that is a whole /24 nobody put in the spreadsheet.
 */
export function renderPlanStats(report: PlanReport): string {
  if (report.utilization.length === 0) return "";
  const total = report.utilization.reduce((t, u) => t + u.totalAddresses, 0);
  const allocated = report.utilization.reduce((t, u) => t + u.allocatedAddresses, 0);
  const overhead = report.utilization.reduce((t, u) => t + u.reservedOverhead, 0);
  const largest = report.utilization
    .map((u) => u.largestFree)
    .filter((b): b is { network: number; prefix: number } => b !== null)
    .sort((a, b) => a.prefix - b.prefix)[0];
  const pct = total === 0 ? 0 : (allocated / total) * 100;

  return (
    `<dl class="swb-plan-stats">` +
    stat("Address space", num(total), `${report.utilization.length} VNets`) +
    stat("Allocated", `${pct.toFixed(1)}%`, `${num(allocated)} addresses`) +
    stat(
      "Largest free block",
      largest === undefined ? "none" : blockCidr(largest),
      largest === undefined ? "every VNet is full" : `${num(totalHosts(largest.prefix))} addresses`
    ) +
    stat("Reserved overhead", num(overhead), "lost to platform reservations") +
    `</dl>`
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function findingBlock(finding: PlanFinding): string {
  const cls = finding.severity === "error" ? "swb-plan-f-err" : "swb-plan-f-warn";
  const paths = [finding.a, finding.b]
    .filter((p): p is PlanPath => p !== undefined)
    .map((p) => `<span class="swb-plan-path">${esc(pathText(p))}</span>`)
    .join("");
  const range =
    finding.range === undefined
      ? ""
      : `<div class="swb-plan-range">overlap ${esc(numberToIp(finding.range.first))} ` +
        `&ndash; ${esc(numberToIp(finding.range.last))}</div>`;
  return (
    `<div class="swb-plan-finding ${cls}">` +
    `<div class="swb-plan-f-top">` +
    `<span class="swb-sev swb-sev-${finding.severity}">${SEVERITY_LABEL[finding.severity]}</span>` +
    paths +
    `</div>` +
    `<div class="swb-plan-msg">${esc(finding.message)}</div>` +
    `<div class="swb-plan-cons">${esc(finding.consequence)}</div>` +
    range +
    `</div>`
  );
}

function renderFindings(report: PlanReport): string {
  if (report.findings.length === 0) return "";
  return `<div class="swb-plan-findings">${report.findings.map(findingBlock).join("")}</div>`;
}

function renderSummary(report: PlanReport): string {
  const cls = report.status === "problems" ? " swb-plan-bad" : "";
  return `<div class="swb-plan-summary${cls}">${esc(report.summary)}</div>`;
}

function renderErrors(errors: ParseError[]): string {
  if (errors.length === 0) return "";
  const rows = errors
    .map(
      (e) =>
        `<div class="swb-error">line ${e.lineNumber}: ${esc(e.raw)} &mdash;&gt; ${esc(e.message)}</div>`
    )
    .join("");
  return `<div class="swb-errors">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Input panel
// ---------------------------------------------------------------------------

const PLACEHOLDER = [
  "region eastus 10.20.0.0/14",
  "  vnet hub 10.20.0.0/22",
  "    GatewaySubnet 10.20.0.0/27",
  "  vnet prod-aks 10.20.8.0/21",
  "    aks-nodes 10.20.8.0/22",
  "",
  "external on-prem 10.20.8.0/22  # ExpressRoute",
].join("\n");

/** The Plan left column. */
export function renderPlanInputs(state: ShellState): string {
  return (
    `<div class="swb-field-label">Address plan</div>` +
    `<textarea class="swb-input" data-field="planInput" rows="16" ` +
    `placeholder="${esc(PLACEHOLDER)}" spellcheck="false">${esc(state.planInput)}</textarea>` +
    `<p class="swb-plan-help">Indent to nest, or lead with <b>region</b> / <b>vnet</b> / ` +
    `<b>subnet</b> / <b>external</b>. Either works, and mixing them works. Regions are ` +
    `optional. A trailing <b>#</b> comment on an external range becomes its consequence ` +
    `text.</p>` +
    `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Clear</button></div>`
  );
}

// ---------------------------------------------------------------------------
// Output panel
// ---------------------------------------------------------------------------

const HINT_SVG_PLAN =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="6" width="86" height="10" fill="#f7f6f4" stroke="#9a9a9a" stroke-opacity="0.7"/>` +
  `<rect x="12" y="20" width="76" height="10" fill="#ff8200" fill-opacity="0.18" stroke="#e07200" stroke-opacity="0.7"/>` +
  `<rect x="24" y="34" width="40" height="8" fill="#ff8200" fill-opacity="0.45"/>` +
  `<rect x="66" y="34" width="22" height="8" fill="none" stroke="#9a9a9a" stroke-dasharray="3 3"/>` +
  `<rect x="12" y="48" width="76" height="10" fill="none" stroke="#d64550" stroke-opacity="0.8"/>` +
  `</svg>`;

/** The Plan right column. */
export function renderPlanOutput(state: ShellState): string {
  const { plan, report, errors } = planViewModel(state);
  if (report.status === "empty") {
    return (
      renderErrors(errors) +
      `<div class="swb-hint">${HINT_SVG_PLAN}<p><b>Waiting on a plan.</b> ` +
      `Overlap mode compares a flat list, which catches the cheap conflicts and misses the ` +
      `expensive ones. Paste a region / VNet / subnet tree and you get cross-region collisions, ` +
      `containment breaks, and the free blocks left in every VNet.</p></div>`
    );
  }
  return (
    renderErrors(errors) +
    renderSummary(report) +
    renderPlanStats(report) +
    renderTree(plan, report) +
    renderFindings(report) +
    `<pre class="swb-pre">${esc(renderPlanText(report))}</pre>`
  );
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

export const PLAN_CSS = `
.swb-plan-help { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.62rem; line-height: 1.9; color: var(--color-smokey-light, #6e6e6e); margin: 10px 0 0; }
.swb-plan-help b { color: var(--color-orange-deep, #e07200); font-weight: 500; }
.swb-plan-summary { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.8rem; color: var(--color-ink, #2a2a2a); padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--color-line, #e4e1dc); }
.swb-plan-bad { color: var(--tool-danger, #d64550); }
.swb-plan-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 0 0 22px; }
.swb-plan-stat dt { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); }
.swb-plan-stat dd { margin: 5px 0 0; font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 1.2rem; font-weight: 600; color: var(--color-ink, #2a2a2a); }
.swb-plan-stat span { display: block; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.6rem; color: var(--color-smokey-light, #6e6e6e); margin-top: 3px; }
.swb-plan-tree { border-top: 1px solid var(--color-line, #e4e1dc); margin-bottom: 24px; }
.swb-plan-row { display: grid; grid-template-columns: 1fr 210px 92px; gap: 14px; align-items: center; padding: 9px 10px; border-bottom: 1px solid var(--color-line, #e4e1dc); }
.swb-plan-row:hover { background: var(--tool-row-hover, rgba(255,130,0,0.06)); }
.swb-plan-name { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swb-plan-kind { font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); margin-right: 9px; }
.swb-plan-region { background: var(--color-deep, #f7f6f4); }
.swb-plan-region .swb-plan-name { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 0.92rem; font-weight: 600; letter-spacing: 0.03em; color: var(--color-ink, #2a2a2a); }
.swb-plan-vnet .swb-plan-name { padding-left: 22px; font-weight: 500; color: var(--color-ink, #2a2a2a); }
.swb-plan-subnet .swb-plan-name { padding-left: 46px; color: var(--color-smokey, #4b4b4b); }
.swb-plan-inline-cidr { font-size: 0.7rem; color: var(--color-smokey-light, #6e6e6e); margin-left: 10px; font-weight: 400; }
.swb-plan-tag { font-size: 0.56rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); border: 1px solid var(--color-line, #e4e1dc); background: var(--color-panel, #f1efec); padding: 1px 6px; margin-left: 10px; }
.swb-plan-flag { box-shadow: inset 3px 0 0 var(--tool-danger, #d64550); }
.swb-plan-flag-w { box-shadow: inset 3px 0 0 var(--color-orange, #ff8200); }
.swb-plan-util { height: 10px; background: var(--color-panel, #f1efec); position: relative; }
.swb-plan-util i { position: absolute; inset: 0 auto 0 0; background: var(--color-orange, #ff8200); display: block; }
.swb-plan-pct { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.7rem; color: var(--color-smokey-light, #6e6e6e); text-align: right; }
.swb-plan-cidr { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.74rem; color: var(--color-smokey-light, #6e6e6e); }
.swb-plan-free { padding: 9px 10px 9px 46px; border-bottom: 1px solid var(--color-line, #e4e1dc); font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.72rem; color: var(--color-smokey-light, #6e6e6e); background: repeating-linear-gradient(45deg, rgba(75,75,75,0.045) 0 4px, transparent 4px 9px); }
.swb-plan-free b { color: var(--color-orange-deep, #e07200); font-weight: 500; }
.swb-plan-ext .swb-plan-name { padding-left: 22px; }
.swb-plan-findings { margin-bottom: 20px; }
.swb-plan-finding { border-left: 2px solid var(--color-line, #e4e1dc); padding: 12px 14px; margin-bottom: 12px; }
.swb-plan-f-err { border-left-color: var(--tool-danger, #d64550); background: var(--tool-danger-bg, rgba(214,69,80,0.08)); }
.swb-plan-f-warn { border-left-color: var(--color-orange, #ff8200); background: var(--tool-warn-bg, rgba(224,114,0,0.08)); }
.swb-plan-f-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
.swb-plan-path { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; letter-spacing: 0.04em; color: var(--color-smokey-light, #6e6e6e); }
.swb-plan-msg { font-size: 0.84rem; font-weight: 400; line-height: 1.5; color: var(--color-ink, #2a2a2a); }
.swb-plan-cons { font-size: 0.82rem; font-weight: 300; line-height: 1.6; color: var(--color-smokey, #4b4b4b); margin-top: 5px; }
.swb-plan-range { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.7rem; color: var(--color-smokey-light, #6e6e6e); margin-top: 6px; }
@media (max-width: 768px) {
  .swb-plan-row { grid-template-columns: 1fr 90px 76px; gap: 8px; }
  .swb-plan-subnet .swb-plan-name { padding-left: 28px; }
  .swb-plan-free { padding-left: 28px; }
}
`.trim();
