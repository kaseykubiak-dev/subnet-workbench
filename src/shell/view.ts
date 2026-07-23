/**
 * Page shell view: Variant A "Command Deck" (chosen 2026-07-22 from
 * mockups/page-shell-mockups.html).
 *
 * Pure render functions: ShellState in, HTML strings out. No DOM access
 * here; src/shell/app.ts owns mounting and events. Regions render
 * separately (tabs / input / output / footer) so the app can re-render
 * results live without blowing away textarea focus.
 *
 * Layout: parallelogram tabs across the top, input pinned in a left
 * column, visual + text results on the right, hand-off buttons under the
 * results, opt-in share link in a persistent footer status bar.
 */

import { numberToIp } from "../engine/ipv4";
import { parseSubnetList } from "../engine/parse";
import type { ParseError, ParsedSubnet } from "../engine/parse";
import { calculate, renderCalculateText } from "../modes/calculate";
import { findOverlaps, renderOverlapText } from "../modes/overlap";
import {
  allocateVlsm,
  parseRequirementList,
  renderVlsmText,
} from "../modes/vlsm";
import { renderVendor, vendorById } from "../vendor/render";
import { VENDORS } from "../vendor/templates";
import { renderBitRibbon } from "../visuals/bitRibbon";
import { renderPrefixSplit } from "../visuals/prefixSplit";
import { renderSpaceMap } from "../visuals/spaceMap";
import { VLSM_LEDGER_CSS, renderVlsmLedger } from "../visuals/vlsmLedger";
import { COLOR, esc } from "../visuals/svg";
import type { ShellState } from "./state";
import {
  MODES,
  calculateEntries,
  effectiveSplitTarget,
  heldSubnetCount,
  selectedCalculateSubnet,
} from "./state";

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** The subnet as a hand-off line: label preserved when present. */
export function handoffLine(s: ParsedSubnet): string {
  const cidr = `${numberToIp(s.network)}/${s.prefix}`;
  return s.label !== undefined ? `${s.label}: ${cidr}` : cidr;
}

function errorsBlock(errors: ParseError[]): string {
  if (errors.length === 0) return "";
  const rows = errors
    .map(
      (e) =>
        `<div class="swb-error">line ${e.lineNumber}: ${esc(e.raw)} &mdash;&gt; ${esc(e.message)}</div>`
    )
    .join("");
  return `<div class="swb-errors">${rows}</div>`;
}

function pre(text: string): string {
  return `<pre class="swb-pre">${esc(text)}</pre>`;
}

/**
 * Empty-state hint: a small schematic SVG beside mono text (chosen
 * 2026-07-22 from mockups/shell-polish-mockups.html, piece 1). Both
 * arguments are trusted static markup built in this module — never route
 * user input through here.
 */
function hint(svg: string, body: string): string {
  return `<div class="swb-hint">${svg}<p>${body}</p></div>`;
}

const HINT_SVG_CALCULATE =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="24" width="9" height="16" fill="${COLOR.teal}" fill-opacity="0.16" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="13" y="24" width="9" height="16" fill="${COLOR.teal}" fill-opacity="0.16" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="24" y="24" width="9" height="16" fill="${COLOR.teal}" fill-opacity="0.16" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="35" y="24" width="9" height="16" fill="${COLOR.teal}" fill-opacity="0.16" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="46" y="24" width="9" height="16" fill="${COLOR.teal}" fill-opacity="0.16" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="59" y="24" width="9" height="16" fill="${COLOR.blue}" fill-opacity="0.12" stroke="${COLOR.dim}" stroke-opacity="0.6"/>` +
  `<rect x="70" y="24" width="9" height="16" fill="${COLOR.blue}" fill-opacity="0.12" stroke="${COLOR.dim}" stroke-opacity="0.6"/>` +
  `<rect x="81" y="24" width="9" height="16" fill="${COLOR.blue}" fill-opacity="0.12" stroke="${COLOR.dim}" stroke-opacity="0.6"/>` +
  `<line x1="57" y1="16" x2="57" y2="48" stroke="${COLOR.amber}" stroke-dasharray="3 3"/>` +
  `</svg>`;

const HINT_SVG_OVERLAP =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="14" width="54" height="14" fill="${COLOR.teal}" fill-opacity="0.12" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="34" y="36" width="42" height="14" fill="${COLOR.teal}" fill-opacity="0.12" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="34" y="14" width="22" height="36" fill="${COLOR.amber}" fill-opacity="0.14" stroke="${COLOR.amber}" stroke-dasharray="3 3"/>` +
  `</svg>`;

const HINT_SVG_VLSM =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="8" width="86" height="18" fill="none" stroke="${COLOR.dim}" stroke-dasharray="4 3"/>` +
  `<rect x="2" y="38" width="40" height="18" fill="${COLOR.teal}" fill-opacity="0.12" stroke="${COLOR.teal}"/>` +
  `<rect x="46" y="38" width="22" height="18" fill="${COLOR.teal}" fill-opacity="0.08" stroke="${COLOR.teal}" stroke-opacity="0.6"/>` +
  `<rect x="72" y="38" width="16" height="18" fill="none" stroke="${COLOR.amber}" stroke-dasharray="3 3"/>` +
  `<line x1="22" y1="26" x2="22" y2="38" stroke="${COLOR.dim}"/>` +
  `<line x1="57" y1="26" x2="57" y2="38" stroke="${COLOR.dim}"/>` +
  `</svg>`;

const HINT_SVG_VENDOR =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="6" width="86" height="52" fill="none" stroke="${COLOR.dim}" stroke-opacity="0.6"/>` +
  `<path d="M 12 24 L 20 32 L 12 40" fill="none" stroke="${COLOR.teal}"/>` +
  `<line x1="28" y1="22" x2="72" y2="22" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<line x1="28" y1="32" x2="62" y2="32" stroke="${COLOR.dim}"/>` +
  `<line x1="28" y1="42" x2="68" y2="42" stroke="${COLOR.dim}"/>` +
  `</svg>`;

function handoffRow(...buttons: string[]): string {
  return `<div class="swb-handoff">${buttons.join("")}</div>`;
}

function handoffBtn(action: string, line: string, label: string): string {
  return `<button class="swb-btn" data-action="${esc(action)}" data-line="${esc(line)}">&#8594; ${esc(label)}</button>`;
}

// ---------------------------------------------------------------------------
// Input panels (left column)
// ---------------------------------------------------------------------------

function textarea(field: string, value: string, rows: number, placeholder: string): string {
  return (
    `<textarea class="swb-input" data-field="${esc(field)}" rows="${rows}" ` +
    `placeholder="${esc(placeholder)}" spellcheck="false">${esc(value)}</textarea>`
  );
}

function fieldLabel(text: string): string {
  return `<div class="swb-field-label">${esc(text)}</div>`;
}

export function renderInputPanel(state: ShellState): string {
  switch (state.mode) {
    case "calculate": {
      const entries = calculateEntries(state);
      const rows = entries
        .map((line, i) => {
          const parsed = parseSubnetList(line);
          const s = parsed.subnets[0];
          const sel = i === state.calculateSelected ? " swb-sel" : "";
          const idx = String(i + 1).padStart(2, "0");
          if (s === undefined) {
            return (
              `<div class="swb-entry swb-entry-bad${sel}" data-action="select-entry" data-index="${i}">` +
              `<span class="swb-entry-idx">${idx}</span>` +
              `<span class="swb-entry-lbl">${esc(line)}</span>` +
              `<button class="swb-entry-x" data-action="remove-entry" data-index="${i}" aria-label="Remove entry">&times;</button>` +
              `</div>`
            );
          }
          const cidr = `${numberToIp(s.network)}/${s.prefix}`;
          return (
            `<div class="swb-entry${sel}" data-action="select-entry" data-index="${i}">` +
            `<span class="swb-entry-idx">${idx}</span>` +
            `<span class="swb-entry-lbl">${esc(s.label ?? "")}</span>` +
            `<span class="swb-entry-cidr">${esc(cidr)}</span>` +
            `<button class="swb-entry-x" data-action="remove-entry" data-index="${i}" aria-label="Remove entry">&times;</button>` +
            `</div>`
          );
        })
        .join("");
      const list =
        entries.length > 0
          ? fieldLabel(`Subnets · ${entries.length}`) +
            `<div class="swb-entries">${rows}</div>`
          : "";
      const draftErrors =
        state.calculateDraftError !== ""
          ? state.calculateDraftError
              .split("\n")
              .map((l) => `<div class="swb-error">${esc(l)}</div>`)
              .join("")
          : "";
      return (
        list +
        fieldLabel("Add subnet") +
        textarea("calculateDraft", state.calculateDraft, 2, "192.168.1.0/26 — label optional, Enter to add") +
        draftErrors +
        `<div class="swb-run">` +
        `<button class="swb-btn" data-action="commit-draft">Add</button>` +
        `<button class="swb-btn swb-ghost" data-action="clear-mode">Clear all</button>` +
        `</div>`
      );
    }
    case "overlap":
      return (
        fieldLabel("Subnet list (one per line)") +
        textarea("overlapInput", state.overlapInput, 12, "Knoxville: 10.10.0.0/16\nNashville: 10.10.32.0/20\n# labels optional, bad lines flagged inline") +
        `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Clear</button></div>`
      );
    case "vlsm":
      return (
        fieldLabel("Supernet") +
        textarea("vlsmSupernetInput", state.vlsmSupernetInput, 1, "10.0.0.0/24") +
        fieldLabel("Requirements (one per line)") +
        textarea("vlsmRequirementsInput", state.vlsmRequirementsInput, 8, "Engineering, 100 hosts\nSales: 50\n20") +
        fieldLabel("Growth headroom %") +
        `<input class="swb-input swb-num" data-field="vlsmHeadroom" type="number" min="0" max="400" value="${state.vlsmHeadroom}">` +
        `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Clear</button></div>`
      );
    case "vendor": {
      const options = VENDORS.map(
        (v) =>
          `<option value="${esc(v.id)}"${v.id === state.vendorId ? " selected" : ""}>${esc(v.name)}</option>`
      ).join("");
      return (
        fieldLabel("Platform") +
        `<select class="swb-input swb-select" data-field="vendorId">${options}</select>` +
        fieldLabel("Subnet list (one per line)") +
        textarea("vendorInput", state.vendorInput, 10, "Site A: 10.0.0.0/26") +
        `<div class="swb-run"><button class="swb-btn swb-ghost" data-action="clear-mode">Clear</button></div>`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Output panels (right column)
// ---------------------------------------------------------------------------

function renderCalculateOutput(state: ShellState): string {
  const entries = calculateEntries(state);
  if (entries.length === 0) {
    return hint(
      HINT_SVG_CALCULATE,
      "<b>Waiting on a subnet.</b> Enter CIDR, mask, or slash-mask &mdash; you get the full derivation, the 32-bit view, and a draggable prefix split. Add several and click between them."
    );
  }
  const first = selectedCalculateSubnet(state);
  if (first === undefined) {
    const line = entries[state.calculateSelected] ?? entries[0] ?? "";
    const { errors } = parseSubnetList(line);
    return errorsBlock(errors);
  }
  const result = calculate(first);
  const target = effectiveSplitTarget(state, first.prefix);
  const sliderDisabled = first.prefix === 32 ? " disabled" : "";
  const line = handoffLine(first);
  return (
    `<div class="swb-visual" id="swb-ribbon-visual">${renderBitRibbon(first.address, first.prefix, target)}</div>` +
    `<div class="swb-split-head">` +
    `<span class="swb-field-label swb-inline">Prefix split</span>` +
    `<input class="swb-slider" data-field="splitTarget" type="range" min="${first.prefix}" max="32" value="${target}"${sliderDisabled}>` +
    `<span class="swb-split-val" id="swb-split-val">/${target}</span>` +
    `</div>` +
    `<div class="swb-visual" id="swb-split-visual">${renderPrefixSplit({ network: first.network, prefix: first.prefix }, target)}</div>` +
    pre(renderCalculateText(result)) +
    handoffRow(
      handoffBtn("handoff-overlap", line, "Add to Overlap list"),
      handoffBtn("handoff-vlsm", `${numberToIp(first.network)}/${first.prefix}`, "Use as VLSM supernet"),
      handoffBtn("handoff-vendor", line, "Vendor syntax")
    )
  );
}

function renderOverlapOutput(state: ShellState): string {
  const { subnets, errors } = parseSubnetList(state.overlapInput);
  const result = findOverlaps(subnets);
  if (subnets.length === 0) {
    return (
      errorsBlock(errors) +
      hint(
        HINT_SVG_OVERLAP,
        "<b>Waiting on a list.</b> Paste subnets one per line and conflicts get flagged with severity. Labels make the report readable: &quot;Knoxville overlaps Nashville&quot; beats &quot;these two overlap&quot;."
      )
    );
  }
  return (
    errorsBlock(errors) +
    `<div class="swb-visual">${renderSpaceMap(result)}</div>` +
    pre(renderOverlapText(result)) +
    handoffRow(handoffBtn("overlap-to-vendor", "", "Send list to Vendor Syntax"))
  );
}

function renderVlsmOutput(state: ShellState): string {
  const supernetParse = parseSubnetList(state.vlsmSupernetInput);
  const reqParse = parseRequirementList(state.vlsmRequirementsInput);
  const supernet = supernetParse.subnets[0];
  const reqErrors = reqParse.errors.map((e) => ({
    lineNumber: e.lineNumber,
    raw: e.raw,
    message: e.message,
  }));
  if (supernet === undefined) {
    return (
      errorsBlock([...supernetParse.errors, ...reqErrors]) +
      hint(
        HINT_SVG_VLSM,
        "<b>Waiting on a supernet.</b> Give a network to carve plus per-requirement host counts; allocation is largest-first with stranded space shown explicitly."
      )
    );
  }
  if (reqParse.requirements.length === 0) {
    return (
      errorsBlock([...supernetParse.errors, ...reqErrors]) +
      hint(
        HINT_SVG_VLSM,
        "<b>Waiting on requirements.</b> Add host counts one per line and the ledger carves the supernet largest-first, showing stranded space and what remains."
      )
    );
  }
  const result = allocateVlsm(supernet, reqParse.requirements, {
    headroomPercent: state.vlsmHeadroom,
  });
  return (
    errorsBlock([...supernetParse.errors, ...reqErrors]) +
    `<div class="swb-visual swb-visual-html">${renderVlsmLedger(result)}</div>` +
    pre(renderVlsmText(result)) +
    (result.allocations.length > 0
      ? handoffRow(handoffBtn("vlsm-to-vendor", "", "Send allocations to Vendor Syntax"))
      : "")
  );
}

function renderVendorOutput(state: ShellState): string {
  const { subnets, errors } = parseSubnetList(state.vendorInput);
  if (subnets.length === 0) {
    return (
      errorsBlock(errors) +
      hint(
        HINT_SVG_VENDOR,
        "<b>Waiting on subnets.</b> Paste them or hand off from any mode &mdash; interface, route, address-object, and policy syntax render copy-ready. &lt;angle&gt; fields are yours to fill."
      )
    );
  }
  const vendor = vendorById(state.vendorId);
  const sections: string[] = [errorsBlock(errors)];
  subnets.forEach((s, si) => {
    const rendered = renderVendor(vendor, {
      network: s.network,
      prefix: s.prefix,
      ...(s.label !== undefined ? { label: s.label } : {}),
    });
    const blocks = rendered
      .map((r, ri) => {
        const blockId = `swb-code-${si}-${ri}`;
        return (
          `<div class="swb-codeblock">` +
          `<div class="swb-codehead"><span>${esc(r.title)}</span>` +
          `<button class="swb-btn swb-copy" data-action="copy-block" data-copy-target="${blockId}">Copy</button></div>` +
          `<pre class="swb-pre" id="${blockId}">${esc(r.text)}</pre>` +
          (r.note !== undefined ? `<div class="swb-note">${esc(r.note)}</div>` : "") +
          `</div>`
        );
      })
      .join("");
    sections.push(
      `<div class="swb-vendor-subnet">` +
        `<div class="swb-subhead">${esc(handoffLine(s))}</div>` +
        blocks +
        `</div>`
    );
  });
  return sections.join("");
}

export function renderOutput(state: ShellState): string {
  switch (state.mode) {
    case "calculate":
      return renderCalculateOutput(state);
    case "overlap":
      return renderOverlapOutput(state);
    case "vlsm":
      return renderVlsmOutput(state);
    case "vendor":
      return renderVendorOutput(state);
  }
}

// ---------------------------------------------------------------------------
// Tabs, footer, full shell
// ---------------------------------------------------------------------------

export function renderTabs(state: ShellState): string {
  return MODES.map((m) => {
    const active = m.id === state.mode ? " swb-active" : "";
    return (
      `<button class="swb-tab${active}" data-action="set-mode" data-mode="${m.id}">` +
      `<span class="swb-tabbg"></span><span class="swb-tablbl">${esc(m.label)}</span></button>`
    );
  }).join("");
}

export function renderFooter(state: ShellState): string {
  const mode = MODES.find((m) => m.id === state.mode);
  const held = heldSubnetCount(state);
  return (
    `<div class="swb-status">MODE <b>${esc(mode?.label.toUpperCase() ?? "")}</b>` +
    ` &nbsp;&middot;&nbsp; ${held} SUBNET${held === 1 ? "" : "S"} HELD</div>` +
    `<button class="swb-btn swb-ghost" data-action="copy-share">Copy shareable link</button>`
  );
}

export function renderShell(state: ShellState): string {
  return (
    `<div class="swb-app">` +
    `<span class="swb-corner swb-c-tl"></span><span class="swb-corner swb-c-tr"></span>` +
    `<span class="swb-corner swb-c-bl"></span><span class="swb-corner swb-c-br"></span>` +
    `<div class="swb-tabs" id="swb-tabs">${renderTabs(state)}</div>` +
    `<div class="swb-body">` +
    `<div class="swb-left" id="swb-input">${renderInputPanel(state)}</div>` +
    `<div class="swb-right" id="swb-output">${renderOutput(state)}</div>` +
    `</div>` +
    `<div class="swb-footer" id="swb-footer">${renderFooter(state)}</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

export const SHELL_CSS = `
.swb-app { --color-mid: #9dbcdf; --color-dim: #7fa6cd; position: relative; border: 1px solid rgba(77,166,255,0.45); background: var(--color-deep, #040a14); font-family: var(--font-body, 'Saira', sans-serif); color: var(--color-white, #eef6ff); box-shadow: 0 0 60px rgba(17,85,255,0.10); }
.swb-app::before { content: ""; position: absolute; top: -1px; left: 24px; right: 24px; height: 2px; background: linear-gradient(90deg, transparent, var(--color-teal, #00ffcc) 20%, rgba(17,85,255,0.9) 80%, transparent); z-index: 2; pointer-events: none; }
.swb-app::after { content: ""; position: absolute; bottom: -1px; left: 24px; right: 24px; height: 2px; background: linear-gradient(90deg, transparent, var(--color-teal, #00ffcc) 20%, rgba(17,85,255,0.9) 80%, transparent); z-index: 2; pointer-events: none; }
.swb-corner { position: absolute; width: 18px; height: 18px; border: 1px solid var(--color-teal, #00ffcc); opacity: 0.7; z-index: 2; pointer-events: none; }
.swb-c-tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
.swb-c-tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
.swb-c-bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
.swb-c-br { bottom: -1px; right: -1px; border-left: none; border-top: none; }
.swb-tabs { display: flex; gap: 6px; padding: 18px 24px 0; border-bottom: 1px solid rgba(77,166,255,0.45); background: var(--color-panel, #030812); overflow: hidden; }
.swb-tab { position: relative; font-family: var(--font-display, 'Chakra Petch', sans-serif); font-size: 0.78rem; letter-spacing: 0.08em; color: #6666ff; padding: 10px 22px 12px; cursor: pointer; background: none; border: none; }
.swb-tabbg { position: absolute; inset: 0; transform: skewX(-12deg) translateY(6px); border: 1px solid rgba(17,85,255,0.35); border-bottom: none; transition: transform 0.15s, border-color 0.15s; }
.swb-tablbl { position: relative; z-index: 1; }
.swb-tab:hover .swb-tabbg { transform: skewX(-12deg) translateY(2px); }
.swb-tab.swb-active { color: var(--color-white, #eef6ff); }
.swb-tab.swb-active .swb-tabbg { transform: skewX(-12deg) translateY(0); border-color: rgba(17,85,255,0.75); background: rgba(17,85,255,0.12); }
.swb-body { display: grid; grid-template-columns: 340px 1fr; }
.swb-left { padding: 22px 20px; border-right: 1px solid rgba(77,166,255,0.45); }
.swb-right { padding: 22px 24px; min-width: 0; background-image: linear-gradient(rgba(77,166,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(77,166,255,0.05) 1px, transparent 1px); background-size: 28px 28px; }
.swb-field-label { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.56rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-dim, #7fa6cd); margin: 14px 0 6px; }
.swb-field-label:first-child { margin-top: 0; }
.swb-input { width: 100%; box-sizing: border-box; background: var(--color-panel, #030812); border: 1px solid var(--bord, rgba(77,166,255,0.28)); color: var(--color-ice, #b0d8ff); font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.72rem; line-height: 1.7; padding: 10px 12px; resize: vertical; }
.swb-input:focus { outline: none; border-color: var(--bord-teal, rgba(0,255,204,0.36)); }
.swb-num { width: 90px; }
.swb-select { appearance: none; cursor: pointer; }
.swb-run { margin-top: 12px; display: flex; gap: 8px; }
.swb-btn { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-teal, #00ffcc); background: rgba(0,255,204,0.06); border: 1px solid var(--bord-teal, rgba(0,255,204,0.36)); padding: 6px 12px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s, background 0.15s, color 0.15s; }
.swb-btn:hover { background: rgba(0,255,204,0.14); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,255,204,0.15); }
.swb-ghost { color: var(--color-dim, #7fa6cd); background: transparent; border-color: var(--bord, rgba(77,166,255,0.28)); }
.swb-ghost:hover { color: var(--color-mid, #9dbcdf); background: rgba(77,166,255,0.06); }
.swb-visual { margin-bottom: 16px; }
.swb-visual svg { display: block; width: 100%; height: auto; }
.swb-split-head { display: flex; align-items: center; gap: 12px; margin: 4px 0 8px; }
.swb-inline { margin: 0; }
.swb-slider { flex: 1; accent-color: var(--color-teal, #00ffcc); }
.swb-split-val { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.72rem; color: var(--color-amber, #ffaa00); min-width: 34px; text-align: right; }
.swb-entries { border: 1px solid var(--bord, rgba(77,166,255,0.28)); background: var(--color-panel, #030812); padding: 4px 2px; margin-bottom: 16px; }
.swb-entry { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid rgba(77,166,255,0.12); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.swb-entry:last-child { border-bottom: none; }
.swb-entry:hover { background: rgba(77,166,255,0.05); }
.swb-entry.swb-sel { background: rgba(0,255,204,0.06); border-bottom-color: rgba(0,255,204,0.4); }
.swb-entry-idx { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; color: var(--color-dim, #7fa6cd); }
.swb-entry.swb-sel .swb-entry-idx { color: var(--color-amber, #ffaa00); }
.swb-entry-lbl { font-size: 0.72rem; color: var(--color-white, #eef6ff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.swb-entry-cidr { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; color: var(--color-mid, #9dbcdf); margin-left: auto; white-space: nowrap; }
.swb-entry.swb-sel .swb-entry-cidr { color: var(--color-teal, #00ffcc); }
.swb-entry-x { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.7rem; color: var(--color-dim, #7fa6cd); background: none; border: none; cursor: pointer; padding: 0 2px; }
.swb-entry-x:hover { color: var(--color-amber, #ffaa00); }
.swb-entry-bad .swb-entry-lbl { color: var(--color-amber, #ffaa00); }
.swb-entry-bad .swb-entry-x { margin-left: auto; }
.swb-pre { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.74rem; line-height: 1.9; color: var(--color-mid, #9dbcdf); white-space: pre; overflow-x: auto; margin: 0 0 10px; background: var(--color-panel, #030812); border: 1px solid rgba(77,166,255,0.2); border-left: 2px solid rgba(0,255,204,0.55); padding: 14px 16px; }
.swb-hint { display: flex; gap: 16px; align-items: center; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; line-height: 1.9; color: var(--color-dim, #7fa6cd); border: 1px dashed var(--bord, rgba(77,166,255,0.28)); background: var(--color-deep, #040a14); padding: 16px 18px; }
.swb-hint svg { flex-shrink: 0; }
.swb-hint p { margin: 0; }
.swb-hint b { color: var(--color-mid, #9dbcdf); font-weight: 400; }
.swb-errors { margin-bottom: 12px; }
.swb-error { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.62rem; line-height: 1.8; color: var(--color-amber, #ffaa00); border-left: 2px solid var(--color-amber, #ffaa00); background: rgba(255,170,0,0.06); padding: 4px 10px; margin-bottom: 4px; }
.swb-handoff { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(77,166,255,0.15); }
.swb-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-top: 1px solid rgba(77,166,255,0.45); background: var(--color-panel, #030812); }
.swb-status { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; letter-spacing: 0.16em; color: var(--color-dim, #7fa6cd); }
.swb-status b { color: var(--color-teal, #00ffcc); font-weight: 400; }
.swb-vendor-subnet { margin-bottom: 22px; }
.swb-subhead { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.68rem; letter-spacing: 0.1em; color: var(--color-teal, #00ffcc); margin-bottom: 10px; }
.swb-codeblock { border: 1px solid var(--bord, rgba(77,166,255,0.28)); background: var(--color-panel, #030812); margin-bottom: 10px; }
.swb-codehead { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; border-bottom: 1px solid rgba(77,166,255,0.15); font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-bright, #4da6ff); }
.swb-copy { padding: 3px 9px; font-size: 0.52rem; }
.swb-codeblock .swb-pre { padding: 10px 12px; }
.swb-note { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; line-height: 1.7; color: var(--color-dim, #7fa6cd); padding: 6px 12px 10px; }
@media (max-width: 768px) {
  .swb-body { grid-template-columns: 1fr; }
  .swb-left { border-right: none; border-bottom: 1px solid rgba(77,166,255,0.45); }
}
${VLSM_LEDGER_CSS}
`.trim();
