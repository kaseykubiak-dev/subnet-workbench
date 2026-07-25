/**
 * Cloud-mode view fragments: Variant A "Inline strip" (chosen 2026-07-25 from
 * mockups/cloud-mode-mockups.html), with the platform fact block borrowed from
 * Variant B and the verdict line from Variant C.
 *
 * Pure like the rest of src/shell/view.ts: state in, HTML strings out, no DOM.
 * It lives in its own module rather than inside view.ts because the cloud block
 * is the one part of the shell that renders nothing at all when the platform is
 * "none", and keeping that early-return in one place makes it obvious that the
 * pre-cloud behavior of the tool is untouched by default.
 *
 * Two deliberate departures from the mockup:
 *
 * 1. The platform picker is a <select> in the tab bar, not the skewed segmented
 *    control from the mockup body. That was Kasey's "option 1": the platform is
 *    global state, so it belongs in the global chrome rather than in whichever
 *    mode happens to be showing.
 *
 * 2. Variant C's three severity filter chips are replaced by a single <details>
 *    around the info findings. The chips would need filter state in ShellState
 *    to survive a re-render; a disclosure element keeps its own open/closed
 *    state in the DOM and buys the same thing, which is stopping the long
 *    platform reserved-address string from burying the one error above it.
 */

import type { ParsedSubnet } from "../engine/parse";
import {
  PLATFORMS,
  cloudUsableHosts,
  platformById,
  type Platform,
} from "../cloud/platforms";
import {
  isDeployable,
  validateCloudSubnet,
  type CloudFinding,
  type Severity,
} from "../cloud/validate";
import { esc } from "../visuals/svg";
import type { ShellState } from "./state";

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

/** Thousands separators so a /8's 16,777,211 is readable at a glance. */
function num(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * The platform picker for the tab bar. Always rendered, including at "none",
 * because it is how you get into cloud mode in the first place.
 */
export function renderPlatformSelect(state: ShellState): string {
  const options = PLATFORMS.map(
    (p) =>
      `<option value="${esc(p.id)}"${p.id === state.platform ? " selected" : ""}>${esc(p.name)}</option>`
  ).join("");
  return (
    `<div class="swb-platbar">` +
    `<span class="swb-field-label swb-inline">Platform</span>` +
    `<select class="swb-input swb-select swb-plat-select" data-field="platform" ` +
    `aria-label="Cloud platform">${options}</select>` +
    `</div>`
  );
}

/**
 * Borrowed from Variant B: the platform's standing facts, collapsed by default.
 *
 * The resize policy is the reason this is on screen at all. "An AWS subnet's
 * CIDR is immutable once created" is the single most expensive thing to learn
 * late, and it is not derivable from any number the calculator shows you.
 */
export function renderCloudFacts(state: ShellState): string {
  if (state.platform === "none") return "";
  const platform = platformById(state.platform);
  const resize = platform.resize.resizable ? "Resizable, with caveats" : "Immutable";
  const facts = [
    ["Reserved per subnet", `${platform.reservedPerSubnet} · ${platform.reservedDetail}`],
    [
      "Legal prefix range",
      `/${platform.minPrefix} to /${platform.maxPrefix} ` +
        `(${num(cloudUsableHosts(platform.maxPrefix, platform))} usable at the small end)`,
    ],
    ["Resize policy", `${resize}. ${platform.resize.detail}`],
  ]
    .map(
      ([term, detail]) =>
        `<div class="swb-fact"><dt>${esc(term ?? "")}</dt><dd>${esc(detail ?? "")}</dd></div>`
    )
    .join("");
  return (
    `<details class="swb-facts">` +
    `<summary>${esc(platform.name)} constraints</summary>` +
    `<dl>${facts}</dl>` +
    `</details>`
  );
}

/** One finding row: severity chip, message, and the rule or platform it came from. */
function findingRow(finding: CloudFinding): string {
  const blocking = finding.severity === "error" ? " swb-f-err" : "";
  return (
    `<div class="swb-f${blocking}">` +
    `<span class="swb-sev swb-sev-${finding.severity}">${SEVERITY_LABEL[finding.severity]}</span>` +
    `<div class="swb-f-msg">${esc(finding.message)}` +
    `<span class="swb-f-src">${esc(finding.source)}</span></div>` +
    `</div>`
  );
}

/** The reserved-address readout pinned to the right of the strip. */
function reservedReadout(prefix: number, platform: Platform): string {
  const usable = cloudUsableHosts(prefix, platform);
  const total = 2 ** (32 - prefix);
  return (
    `<div class="swb-reserved">` +
    `<div class="swb-reserved-num">${num(usable)} / ${num(total)}</div>` +
    `<div class="swb-reserved-lbl">usable · ${esc(platform.name)} reserves ${platform.reservedPerSubnet}</div>` +
    `</div>`
  );
}

/**
 * The whole cloud block for one subnet: verdict, reserved readout, blocking and
 * advisory findings, and the info findings behind a disclosure.
 *
 * Returns "" at platform "none" so callers can concatenate unconditionally.
 * The subnet's label doubles as its name, which is what makes this work without
 * a new input field: "GatewaySubnet: 10.0.0.0/27" already parses into a label
 * and a prefix, and that label is exactly what Azure matches reserved names on.
 */
export function renderCloudBlock(state: ShellState, subnet: ParsedSubnet): string {
  if (state.platform === "none") return "";
  const platform = platformById(state.platform);
  const findings = validateCloudSubnet({
    platform: state.platform,
    prefix: subnet.prefix,
    ...(subnet.label !== undefined ? { name: subnet.label } : {}),
  });

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");
  const ok = isDeployable(findings);

  const verdictText = ok
    ? warnings.length === 0
      ? `Deployable on ${platform.name}.`
      : `Deployable on ${platform.name}, with ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to look at.`
    : `${platform.name} will reject this: ${errors.length} blocking issue${errors.length === 1 ? "" : "s"}.`;

  const verdict =
    `<div class="swb-verdict${ok ? " swb-verdict-ok" : ""}">` +
    `<span class="swb-verdict-mark">${ok ? "&#10003;" : "&times;"}</span>` +
    `<span class="swb-verdict-txt">${esc(verdictText)}</span>` +
    `</div>`;

  const strip =
    `<div class="swb-cloud-strip">` +
    verdict +
    reservedReadout(subnet.prefix, platform) +
    `</div>`;

  const blocking = [...errors, ...warnings].map(findingRow).join("");
  const context =
    infos.length === 0
      ? ""
      : `<details class="swb-context">` +
        `<summary>${infos.length} context note${infos.length === 1 ? "" : "s"}</summary>` +
        `<div class="swb-findings">${infos.map(findingRow).join("")}</div>` +
        `</details>`;

  return (
    `<div class="swb-cloud">` +
    strip +
    (blocking === "" ? "" : `<div class="swb-findings">${blocking}</div>`) +
    context +
    `</div>`
  );
}

export const CLOUD_CSS = `
.swb-platbar { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; flex-shrink: 0; }
.swb-plat-select { width: auto; padding: 6px 9px; font-size: 0.7rem; }
.swb-facts { margin-top: 16px; border: 1px solid var(--color-line, #e4e1dc); background: var(--color-deep, #f7f6f4); }
.swb-facts > summary { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-orange-deep, #e07200); padding: 9px 12px; cursor: pointer; }
.swb-facts dl { margin: 0; padding: 0 12px 10px; }
.swb-fact { margin-bottom: 12px; }
.swb-fact:last-child { margin-bottom: 0; }
.swb-fact dt { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); }
.swb-fact dd { margin: 4px 0 0; font-size: 0.7rem; line-height: 1.65; color: var(--color-ink, #2a2a2a); }
.swb-cloud { margin-bottom: 18px; border: 1px solid var(--color-line, #e4e1dc); background: var(--color-void, #ffffff); padding: 0 18px; }
.swb-cloud-strip { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; padding: 16px 0; border-bottom: 1px solid var(--color-line, #e4e1dc); }
.swb-verdict { display: flex; align-items: center; gap: 12px; }
.swb-verdict-mark { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 1.5rem; font-weight: 700; line-height: 1; color: var(--tool-danger, #d64550); }
.swb-verdict-ok .swb-verdict-mark { color: var(--color-orange-deep, #e07200); }
.swb-verdict-txt { font-size: 0.86rem; font-weight: 300; color: var(--color-ink, #2a2a2a); }
.swb-reserved { margin-left: auto; text-align: right; }
.swb-reserved-num { font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 1.4rem; font-weight: 700; line-height: 1; color: var(--color-orange-deep, #e07200); }
.swb-reserved-lbl { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.56rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); margin-top: 6px; }
.swb-findings { margin: 0; }
.swb-f { display: grid; grid-template-columns: 76px 1fr; gap: 14px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--color-line, #e4e1dc); }
.swb-f:last-child { border-bottom: none; }
.swb-f-msg { font-size: 0.84rem; line-height: 1.55; font-weight: 300; color: var(--color-ink, #2a2a2a); }
.swb-f-src { display: block; margin-top: 4px; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.64rem; color: var(--color-smokey-light, #6e6e6e); }
.swb-f-err { background: var(--tool-danger-bg, rgba(214,69,80,0.08)); margin: 0 -18px; padding-left: 18px; padding-right: 18px; border-bottom-color: rgba(214,69,80,0.2); }
.swb-sev { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 3px 7px; white-space: nowrap; text-align: center; }
.swb-sev-error { background: var(--tool-danger-bg, rgba(214,69,80,0.08)); color: var(--tool-danger, #d64550); border: 1px solid rgba(214,69,80,0.35); }
.swb-sev-warning { background: var(--tool-warn-bg, rgba(224,114,0,0.08)); color: var(--color-orange-deep, #e07200); border: 1px solid rgba(224,114,0,0.35); }
.swb-sev-info { background: var(--color-panel, #f1efec); color: var(--color-smokey-light, #6e6e6e); border: 1px solid var(--color-line, #e4e1dc); }
.swb-context { border-top: 1px solid var(--color-line, #e4e1dc); }
.swb-context > summary { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); padding: 10px 0; cursor: pointer; }
.swb-context > summary:hover { color: var(--color-orange-deep, #e07200); }
`.trim();
