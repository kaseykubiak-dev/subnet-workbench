/**
 * Platform-services view fragments: Variant B "Subnet cards" (chosen
 * 2026-07-25 from mockups/cloud-services-mockups.html).
 *
 * Pure like its peers: state in, HTML strings out, no DOM. It is a separate
 * module from capacityView rather than a branch inside it because the two
 * answer different shapes of question. Kubernetes capacity produces ONE subnet
 * and spends its output space explaining how big; a services plan produces
 * SEVERAL and spends its output space explaining why they cannot be one.
 *
 * Three things the card layout is carrying that a flat ledger could not:
 *
 * 1. Sharing is the whole point. A dozen private endpoints are a dozen
 *    addresses in one subnet; a dozen App Service integrations are a dozen
 *    SUBNETS, because a delegated subnet is handed to the resource provider
 *    and can hold nothing else. One card per subnet makes that structural,
 *    not a footnote.
 *
 * 2. A card can say "no published figure" in the place where the number would
 *    be. Container Instances, RDS and Lambda have no vendor-published address
 *    count, and rendering that as a zero would be a lie the layout invites.
 *
 * 3. Committed is shown beside consumed. Rounding four subnets up to prefixes
 *    is where a services plan quietly doubles in size, and the rollup is the
 *    only place that becomes visible before someone deploys it.
 */

import {
  SERVICE_CONSUMERS,
  estimateServices,
  type ServiceSubnet,
  type ServicesEstimate,
} from "../cloud/capacity";
import {
  cloudUsableHosts,
  platformById,
  type Platform,
  type PlatformId,
} from "../cloud/platforms";
import { esc } from "../visuals/svg";
import type { ShellState } from "./state";
import { serviceSelectionsFor } from "./state";

/** Thousands separators, matching capacityView. */
function num(value: number): string {
  return value.toLocaleString("en-US");
}

/** Total addresses in a prefix. */
function blockSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

// ---------------------------------------------------------------------------
// The estimate for the current state
// ---------------------------------------------------------------------------

/** The services estimate implied by the current state. Empty on-prem. */
export function servicesEstimateFor(state: ShellState): ServicesEstimate {
  return estimateServices(serviceSelectionsFor(state), state.platform);
}

/** The catalogue rows that belong to the selected platform. */
export function servicesCatalogueFor(state: ShellState) {
  if (state.platform === "none") return [];
  return SERVICE_CONSUMERS.filter((c) => c.platform === state.platform);
}

// ---------------------------------------------------------------------------
// Input panel
// ---------------------------------------------------------------------------

function subNumField(field: string, label: string, value: number, min: number): string {
  return (
    `<div class="swb-svc-sub-f">` +
    `<label class="swb-svc-sub-l" for="swb-${esc(field)}">${esc(label)}</label>` +
    `<input class="swb-input swb-num swb-svc-sub-n" id="swb-${esc(field)}" ` +
    `data-field="${esc(field)}" type="number" min="${min}" value="${value}"></div>`
  );
}

/**
 * The extra inputs a formula service needs, shown only while it is ticked.
 *
 * These live inside the row rather than in a panel of their own so the numbers
 * sit next to the service they belong to. An App Gateway instance count in a
 * separate box three rows down is an invitation to size the wrong gateway.
 */
function serviceSubFields(id: string, state: ShellState): string {
  if (id === "azure-sql-mi") {
    return (
      `<div class="swb-svc-sub">` +
      subNumField("sqlMiGeneralPurpose", "General Purpose", state.sqlMiGeneralPurpose, 0) +
      subNumField("sqlMiBusinessCritical", "Business Critical", state.sqlMiBusinessCritical, 0) +
      subNumField("sqlMiZoneRedundant", "Zone redundant", state.sqlMiZoneRedundant, 0) +
      subNumField("sqlMiVmGroups", "VM groups", state.sqlMiVmGroups, 0) +
      `</div>`
    );
  }
  if (id === "azure-app-gateway") {
    return (
      `<div class="swb-svc-sub">` +
      subNumField("appGwMaxInstances", "Max instances each", state.appGwMaxInstances, 1) +
      `<label class="swb-cap-check swb-svc-check"><input type="checkbox" ` +
      `data-field="appGwPrivateFrontend"${state.appGwPrivateFrontend ? " checked" : ""}> ` +
      `Private frontend IP</label>` +
      `</div>`
    );
  }
  return "";
}

/** One catalogue row: tick, count, and any sub-plan the service needs. */
function serviceRow(
  consumer: (typeof SERVICE_CONSUMERS)[number],
  state: ShellState
): string {
  const count = state.serviceCounts[consumer.id];
  const on = count !== undefined;
  const tag =
    consumer.sharing === "shared"
      ? `<span class="swb-svc-tag swb-svc-shared">Shared</span>`
      : consumer.sharing === "delegated"
        ? `<span class="swb-svc-tag swb-svc-deleg">Delegated</span>`
        : `<span class="swb-svc-tag swb-svc-dedic">Dedicated</span>`;
  const counter = on
    ? `<input class="swb-input swb-num swb-svc-n" type="number" min="0" ` +
      `data-service-count="${esc(consumer.id)}" value="${count}">` +
      `<span class="swb-svc-unit">${esc(consumer.unit)}${count === 1 ? "" : "s"}</span>`
    : "";
  return (
    `<div class="swb-svc-row${on ? " swb-svc-row-on" : ""}">` +
    `<label class="swb-svc-tick"><input type="checkbox" data-service="${esc(consumer.id)}"` +
    `${on ? " checked" : ""}> <span class="swb-svc-name">${esc(consumer.name)}</span></label>` +
    tag +
    `<div class="swb-svc-count">${counter}</div>` +
    (on ? serviceSubFields(consumer.id, state) : "") +
    `</div>`
  );
}

/** The services left column. */
export function renderServicesInputs(state: ShellState): string {
  if (state.platform === "none") {
    return (
      `<p class="swb-cap-nudge">Platform services are the addresses nobody budgets for: ` +
      `private endpoints, delegated subnets, managed instances. Pick Azure or AWS above and ` +
      `the catalogue appears here.</p>`
    );
  }
  const rows = servicesCatalogueFor(state)
    .map((c) => serviceRow(c, state))
    .join("");
  return (
    `<div class="swb-field-label">Services in this plan</div>` +
    `<div class="swb-svc-list">${rows}</div>` +
    `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Reset</button></div>`
  );
}

// ---------------------------------------------------------------------------
// Output panel
// ---------------------------------------------------------------------------

/** The mini bar inside a card: reserved, consumed, then the rounding waste. */
function renderCardBar(subnet: ServiceSubnet, platform: Platform): string {
  if (subnet.prefix === null) return "";
  const total = blockSize(subnet.prefix);
  if (subnet.addresses === null) {
    // No published figure, so there is no fill to draw. Hatching the whole
    // block says "this much is committed, nobody knows how much is used",
    // which is the honest reading.
    return (
      `<div class="swb-cap-bar swb-svc-bar"><div class="swb-cap-seg swb-cap-free" ` +
      `style="width:100%" title="No published address count"></div></div>`
    );
  }
  const free = Math.max(0, cloudUsableHosts(subnet.prefix, platform) - subnet.addresses);
  const parts: { cls: string; addresses: number; label: string }[] = [
    { cls: "swb-cap-res", addresses: platform.reservedPerSubnet, label: `${platform.name} reserved` },
    { cls: "swb-cap-u0", addresses: subnet.addresses, label: "Consumed" },
    { cls: "swb-cap-free", addresses: free, label: "Free" },
  ];
  const bars = parts
    .map(
      (p) =>
        `<div class="swb-cap-seg ${p.cls}" style="width:${((p.addresses / total) * 100).toFixed(2)}%" ` +
        `title="${esc(p.label)}: ${num(p.addresses)}"></div>`
    )
    .join("");
  return `<div class="swb-cap-bar swb-svc-bar">${bars}</div>`;
}

function renderCardLines(subnet: ServiceSubnet): string {
  if (subnet.lines.length === 0) return "";
  const rows = subnet.lines
    .map(
      (line) =>
        `<tr><td class="swb-cap-lbl">${esc(line.label)}</td>` +
        `<td>${esc(line.detail ?? "")}</td>` +
        `<td class="swb-cap-n">${num(line.addresses)}</td></tr>`
    )
    .join("");
  return `<table class="swb-cap-table swb-svc-table"><tbody>${rows}</tbody></table>`;
}

function renderCard(subnet: ServiceSubnet, platform: Platform): string {
  const tag =
    subnet.sharing === "shared"
      ? `<span class="swb-svc-tag swb-svc-shared">Shared</span>`
      : subnet.sharing === "delegated"
        ? `<span class="swb-svc-tag swb-svc-deleg">Delegated</span>`
        : `<span class="swb-svc-tag swb-svc-dedic">Dedicated</span>`;
  const deleg =
    subnet.delegation === undefined
      ? ""
      : `<span class="swb-cap-tag">${esc(subnet.delegation)}</span>`;
  // Null and zero must not render the same way: zero means the service costs
  // nothing, null means the vendor never published what it costs.
  const consumed =
    subnet.addresses === null
      ? `No published address count`
      : `${num(subnet.addresses)} usable address${subnet.addresses === 1 ? "" : "es"}`;
  const committed =
    subnet.prefix === null ? "&mdash;" : `${num(blockSize(subnet.prefix))} committed`;
  const warnings = subnet.warnings
    .map(
      (w) =>
        `<div class="swb-cap-warn"><span class="swb-sev swb-sev-warning">Warning</span>` +
        `<span>${esc(w)}</span></div>`
    )
    .join("");
  const notes = subnet.notes
    .map((n) => `<li>${esc(n)}</li>`)
    .join("");
  return (
    `<div class="swb-svc-card">` +
    `<div class="swb-svc-head">` +
    `<h4>${esc(subnet.name)}</h4>${tag}${deleg}` +
    `<div class="swb-svc-prefix">${subnet.prefix === null ? "&mdash;" : `/${subnet.prefix}`}</div>` +
    `</div>` +
    `<div class="swb-svc-sub-line">${consumed} &middot; ${committed}</div>` +
    renderCardBar(subnet, platform) +
    renderCardLines(subnet) +
    `<p class="swb-svc-reason">${esc(subnet.prefixReason)}</p>` +
    warnings +
    (notes === "" ? "" : `<ul class="swb-svc-notes">${notes}</ul>`) +
    `</div>`
  );
}

const HINT_SVG_SERVICES =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="8" width="40" height="20" fill="none" stroke="#9a9a9a" stroke-opacity="0.7"/>` +
  `<rect x="2" y="8" width="26" height="20" fill="#e07200" fill-opacity="0.6"/>` +
  `<rect x="48" y="8" width="40" height="20" fill="none" stroke="#9a9a9a" stroke-opacity="0.7"/>` +
  `<rect x="48" y="8" width="14" height="20" fill="#ff8200" fill-opacity="0.55"/>` +
  `<rect x="2" y="36" width="40" height="20" fill="none" stroke="#9a9a9a" stroke-opacity="0.7"/>` +
  `<rect x="2" y="36" width="34" height="20" fill="#ff8200" fill-opacity="0.4"/>` +
  `<rect x="48" y="36" width="40" height="20" fill="none" stroke="#9a9a9a" stroke-opacity="0.7" stroke-dasharray="3 3"/>` +
  `</svg>`;

/** The services right column. */
export function renderServicesOutput(state: ShellState): string {
  if (state.platform === "none") {
    return (
      `<div class="swb-hint">${HINT_SVG_SERVICES}<p><b>Waiting on a platform.</b> ` +
      `Which services need a subnet of their own, and how many addresses each one takes, ` +
      `is entirely a matter of whose cloud you are in. Choose Azure or AWS in the platform ` +
      `picker.</p></div>`
    );
  }
  const estimate = servicesEstimateFor(state);
  if (estimate.subnets.length === 0) {
    return (
      `<div class="swb-hint">${HINT_SVG_SERVICES}<p><b>Nothing selected yet.</b> ` +
      `Tick the services this environment will run. Anything that can share a subnet pools ` +
      `into one; anything delegated or dedicated gets a card of its own, which is usually ` +
      `where a plan turns out bigger than expected.</p></div>`
    );
  }
  const platform = platformById(state.platform as PlatformId);
  const supernet =
    estimate.supernetPrefix === null ? "&mdash;" : `/${estimate.supernetPrefix}`;
  const warnings = estimate.warnings
    .map(
      (w) =>
        `<div class="swb-cap-warn"><span class="swb-sev swb-sev-warning">Warning</span>` +
        `<span>${esc(w)}</span></div>`
    )
    .join("");
  const count = estimate.subnets.length;

  return (
    `<div class="swb-cap-answer"><div class="swb-cap-big">${supernet}</div>` +
    `<div class="swb-cap-sub">${count} subnet${count === 1 ? "" : "s"} &middot; ` +
    `${num(estimate.consumed)} consumed &middot; ${num(estimate.committed)} committed</div></div>` +
    warnings +
    `<div class="swb-svc-cards">` +
    estimate.subnets.map((s) => renderCard(s, platform)).join("") +
    `</div>` +
    renderRollup(estimate) +
    `<div class="swb-run">` +
    `<button class="swb-btn" data-action="handoff-plan">Send to Plan mode &#8594;</button>` +
    `</div>`
  );
}

/**
 * The line that makes rounding visible.
 *
 * Consumed is what the services actually use; committed is what the subnets
 * cost once each is rounded up to a prefix. On a plan of four small subnets
 * the gap is routinely most of the address space, and it is invisible until
 * somebody puts the two numbers side by side.
 */
function renderRollup(estimate: ServicesEstimate): string {
  const waste = estimate.committed - estimate.consumed;
  const pct =
    estimate.committed === 0 ? 0 : Math.round((waste / estimate.committed) * 100);
  return (
    `<div class="swb-svc-rollup">` +
    `<div><span class="swb-svc-rl">Consumed</span>${num(estimate.consumed)}</div>` +
    `<div><span class="swb-svc-rl">Committed</span>${num(estimate.committed)}</div>` +
    `<div><span class="swb-svc-rl">Lost to rounding</span>${num(waste)} (${pct}%)</div>` +
    `<div><span class="swb-svc-rl">Smallest supernet</span>` +
    `${estimate.supernetPrefix === null ? "&mdash;" : `/${estimate.supernetPrefix}`}</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

export const SERVICES_CSS = `
.swb-svc-list { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; }
.swb-svc-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid transparent; border-bottom-color: var(--color-line, #e4e1dc); }
.swb-svc-row-on { border-color: var(--tool-bord-strong, rgba(255,130,0,0.5)); background: var(--tool-row-sel, rgba(255,130,0,0.1)); }
.swb-svc-tick { display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0; }
.swb-svc-tick input { accent-color: var(--color-orange, #ff8200); flex-shrink: 0; }
.swb-svc-name { font-size: 0.78rem; font-weight: 300; color: var(--color-ink, #2a2a2a); line-height: 1.4; }
.swb-svc-tag { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.5rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 6px; border: 1px solid var(--color-line, #e4e1dc); white-space: nowrap; }
.swb-svc-shared { color: var(--color-smokey-light, #6e6e6e); background: var(--color-panel, #f1efec); }
.swb-svc-dedic { color: var(--color-orange-deep, #e07200); background: var(--tool-warn-bg, rgba(224,114,0,0.08)); border-color: var(--tool-bord-strong, rgba(255,130,0,0.5)); }
.swb-svc-deleg { color: var(--color-ink, #2a2a2a); background: var(--color-warm, #e9e6e1); }
.swb-svc-count { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
.swb-svc-count:empty { display: none; }
.swb-svc-n { width: 80px; }
.swb-svc-unit { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.62rem; color: var(--color-smokey-light, #6e6e6e); }
.swb-svc-sub { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 10px 14px; padding-top: 4px; }
.swb-svc-sub-f { display: flex; flex-direction: column; gap: 4px; }
.swb-svc-sub-l { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.52rem; letter-spacing: 0.13em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); }
.swb-svc-sub-n { width: 74px; }
.swb-svc-check { margin-top: 0; align-self: flex-end; }
.swb-svc-cards { display: flex; flex-direction: column; gap: 16px; margin: 20px 0; }
.swb-svc-card { border: 1px solid var(--color-line, #e4e1dc); padding: 16px 18px; background: var(--color-deep, #f7f6f4); }
.swb-svc-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.swb-svc-head h4 { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 0.92rem; font-weight: 600; margin: 0; color: var(--color-ink, #2a2a2a); }
.swb-svc-prefix { margin-left: auto; font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 1.5rem; font-weight: 700; color: var(--color-orange-deep, #e07200); line-height: 1; }
.swb-svc-sub-line { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; color: var(--color-smokey, #4b4b4b); margin-top: 6px; }
.swb-svc-bar { height: 22px; margin: 10px 0 12px; }
.swb-svc-table { margin-bottom: 10px; }
.swb-svc-table td { font-size: 0.74rem; padding: 8px 12px 8px 0; }
.swb-svc-reason { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.62rem; line-height: 1.8; color: var(--color-smokey-light, #6e6e6e); margin: 0; }
.swb-svc-notes { margin: 12px 0 0; padding-left: 18px; }
.swb-svc-notes li { font-size: 0.74rem; font-weight: 300; line-height: 1.65; color: var(--color-smokey, #4b4b4b); margin-bottom: 5px; }
.swb-svc-rollup { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; border-top: 1px solid var(--color-line, #e4e1dc); padding-top: 16px; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.86rem; color: var(--color-ink, #2a2a2a); }
.swb-svc-rl { display: block; font-size: 0.52rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); margin-bottom: 5px; }
@media (max-width: 768px) {
  .swb-svc-prefix { margin-left: 0; }
}
`.trim();
