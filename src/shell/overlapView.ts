/**
 * Overlap-mode view fragments: Variant A "Verdict roster" (chosen 2026-07-26
 * from mockups/overlap-list-mockups.html), with sub-pick 2 (the edit-as-text
 * escape hatch) and a "remove both sides" repair on every conflict.
 *
 * Pure like src/shell/view.ts, cloudView.ts, capacityView.ts and planView.ts:
 * state in, HTML strings out, no DOM.
 *
 * Variant A is Calculate's indexed ledger with one idea added: in Overlap the
 * list IS the subject of the analysis, so a row already knows whether it
 * collides with anything. It wears that verdict as a severity edge and a chip,
 * clean rows carry nothing, and focusing a row narrows the report on the right
 * to that subnet's conflicts.
 *
 * Three deliberate departures from the mockup:
 *
 * 1. The report is HTML rows rather than the mockup's <pre>. A conflict has to
 *    carry a "Remove both" button, and a button cannot live inside preformatted
 *    text. The plain-text artifact is not lost: it moves behind a disclosure
 *    with the same copy control the vendor blocks use, because the thing people
 *    do with an overlap report is paste it into a ticket.
 *
 * 2. "Remove both" is hidden in text mode. Its indices are entry positions, and
 *    they only line up with parse line numbers while the field is normalized;
 *    reaching into a textarea somebody is mid-edit in and deleting two lines
 *    would be a worse surprise than making them do it themselves.
 *
 * 3. The all-clear state gets the cloud verdict treatment (a check mark and a
 *    sentence) rather than a summary line above an empty list. "No conflicts
 *    across N subnets" is usually the answer the user is hoping for, and it
 *    must not be mistakable for a report that failed to render.
 */

import { parseSubnetList } from "../engine/parse";
import type { ParseError, ParsedSubnet } from "../engine/parse";
import {
  cidrOf,
  conflictsForLine,
  describeConflict,
  displayName,
  findOverlaps,
  renderOverlapText,
  severityForLine,
  type Conflict,
  type ConflictSeverity,
  type OverlapResult,
} from "../modes/overlap";
import { COLOR, esc } from "../visuals/svg";
import { renderSpaceMap } from "../visuals/spaceMap";
import type { ShellState } from "./state";
import { overlapEntries, overlapSource } from "./state";

const SEVERITY_LABEL: Record<ConflictSeverity, string> = {
  error: "Error",
  warning: "Warn",
};

const HINT_SVG =
  `<svg width="90" height="64" viewBox="0 0 90 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="2" y="14" width="54" height="14" fill="${COLOR.teal}" fill-opacity="0.12" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="34" y="36" width="42" height="14" fill="${COLOR.teal}" fill-opacity="0.12" stroke="${COLOR.teal}" stroke-opacity="0.7"/>` +
  `<rect x="34" y="14" width="22" height="36" fill="${COLOR.amber}" fill-opacity="0.14" stroke="${COLOR.amber}" stroke-dasharray="3 3"/>` +
  `</svg>`;

/**
 * Everything both panels need, computed once.
 *
 * `byLine` is the bridge between the two halves of the screen: the roster is a
 * list of entry strings and the report is a list of conflicts keyed by parse
 * line number, and in roster mode entry index N is line number N+1 because
 * `overlapSource` hands the parser the normalized entry join.
 */
interface OverlapModel {
  entries: string[];
  subnets: ParsedSubnet[];
  errors: ParseError[];
  result: OverlapResult;
  byLine: Map<number, ParsedSubnet>;
  /** The focused entry index, or null when the report shows everything. */
  focused: number | null;
}

function overlapModel(state: ShellState): OverlapModel {
  const entries = overlapEntries(state);
  const { subnets, errors } = parseSubnetList(overlapSource(state));
  const byLine = new Map<number, ParsedSubnet>();
  for (const s of subnets) byLine.set(s.lineNumber, s);
  // A focus restored from a share link can point past the end of a list that
  // has since been edited, so it is range-checked here rather than trusted.
  const sel = state.overlapSelected;
  const focused =
    state.overlapEditText || sel === null || sel < 0 || sel >= entries.length ? null : sel;
  return { entries, subnets, errors, result: findOverlaps(subnets), byLine, focused };
}

/** The name to call entry N in prose: its label, its CIDR, or the raw line. */
function entryName(model: OverlapModel, index: number): string {
  const s = model.byLine.get(index + 1);
  return s !== undefined ? displayName(s) : (model.entries[index] ?? "");
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

// ---------------------------------------------------------------------------
// Input panel (left column)
// ---------------------------------------------------------------------------

/** The count-and-verdict line above the roster, plus the text-mode toggle. */
function rosterHead(model: OverlapModel): string {
  const { entries, result } = model;
  let tally = "";
  if (entries.length >= 2 && result.status === "conflicts") {
    const worst = result.conflicts.some((c) => c.severity === "error") ? "err" : "warn";
    const n = result.conflicts.length;
    tally = `<span class="swb-tally swb-tally-${worst}">${n} conflict${n === 1 ? "" : "s"}</span>`;
  } else if (entries.length >= 2 && result.status === "all-clear") {
    tally = `<span class="swb-tally swb-tally-ok">clear</span>`;
  }
  return (
    `<div class="swb-roster-head">` +
    `<span class="swb-field-label swb-inline">Subnets &middot; ${entries.length}</span>` +
    tally +
    `<button class="swb-textlink" data-action="toggle-overlap-text">Edit as text</button>` +
    `</div>`
  );
}

function rosterRow(model: OverlapModel, index: number): string {
  const line = model.entries[index] ?? "";
  const idx = String(index + 1).padStart(2, "0");
  const sel = index === model.focused ? " swb-sel" : "";
  const remove =
    `<button class="swb-entry-x" data-action="remove-overlap-entry" ` +
    `data-indices="${index}" aria-label="Remove entry">&times;</button>`;
  const subnet = model.byLine.get(index + 1);
  if (subnet === undefined) {
    return (
      `<div class="swb-entry swb-entry-bad${sel}">` +
      `<span class="swb-entry-idx">${idx}</span>` +
      `<span class="swb-entry-lbl">${esc(line)}</span>` +
      remove +
      `</div>`
    );
  }
  const severity = severityForLine(model.result, index + 1);
  const edge = severity === null ? "" : ` swb-ov-${severity}`;
  const chip =
    severity === null
      ? ""
      : `<span class="swb-sev swb-sev-${severity}">${SEVERITY_LABEL[severity]}</span>`;
  return (
    `<div class="swb-entry${edge}${sel}" data-action="select-overlap-entry" data-index="${index}">` +
    `<span class="swb-entry-idx">${idx}</span>` +
    `<span class="swb-entry-lbl">${esc(subnet.label ?? "")}</span>` +
    `<span class="swb-entry-cidr">${esc(cidrOf(subnet))}</span>` +
    chip +
    remove +
    `</div>`
  );
}

function draftErrors(text: string): string {
  if (text === "") return "";
  return text
    .split("\n")
    .map((l) => `<div class="swb-error">${esc(l)}</div>`)
    .join("");
}

/**
 * The left column for Overlap: the verdict roster and its add box, or the raw
 * textarea when the user has switched to editing as text.
 */
export function renderOverlapInputs(state: ShellState): string {
  if (state.overlapEditText) {
    return (
      `<div class="swb-roster-head">` +
      `<span class="swb-field-label swb-inline">Subnet list &middot; one per line</span>` +
      `</div>` +
      `<textarea class="swb-input" data-field="overlapInput" rows="14" spellcheck="false" ` +
      `placeholder="Knoxville: 10.10.0.0/16&#10;Nashville: 10.10.32.0/20&#10;# labels optional, bad lines flagged inline">` +
      `${esc(state.overlapInput)}</textarea>` +
      `<div class="swb-run">` +
      `<button class="swb-btn" data-action="toggle-overlap-text">Back to list</button>` +
      `<button class="swb-btn swb-ghost" data-action="clear-mode">Clear all</button>` +
      `</div>`
    );
  }
  const model = overlapModel(state);
  const roster =
    model.entries.length > 0
      ? rosterHead(model) +
        `<div class="swb-entries">` +
        model.entries.map((_, i) => rosterRow(model, i)).join("") +
        `</div>`
      : `<div class="swb-roster-head">` +
        `<span class="swb-field-label swb-inline">Subnets &middot; 0</span>` +
        `<button class="swb-textlink" data-action="toggle-overlap-text">Edit as text</button>` +
        `</div>`;
  return (
    roster +
    `<div class="swb-field-label">Add subnet</div>` +
    `<textarea class="swb-input" data-field="overlapDraft" rows="2" spellcheck="false" ` +
    `placeholder="Knoxville: 10.10.0.0/16 — paste several, Enter to add">${esc(state.overlapDraft)}</textarea>` +
    draftErrors(state.overlapDraftError) +
    `<div class="swb-run">` +
    `<button class="swb-btn" data-action="commit-overlap-draft">Add</button>` +
    `<button class="swb-btn swb-ghost" data-action="clear-mode">Clear all</button>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Output panel (right column)
// ---------------------------------------------------------------------------

/**
 * One conflict: severity chip, the sentence, and the repair.
 *
 * "Remove both" exists because deleting a duplicate is the common fix and
 * doing it as two separate row removals means the second index has already
 * shifted under the user by the time they reach for it.
 */
function conflictRow(c: Conflict, repairable: boolean): string {
  const indices = `${c.a.lineNumber - 1},${c.b.lineNumber - 1}`;
  const repair = repairable
    ? `<button class="swb-btn swb-ghost swb-ovc-fix" data-action="remove-overlap-entry" ` +
      `data-indices="${indices}">Remove both</button>`
    : "";
  return (
    `<div class="swb-ovc swb-ovc-${c.severity}">` +
    `<span class="swb-sev swb-sev-${c.severity}">${SEVERITY_LABEL[c.severity]}</span>` +
    `<div class="swb-ovc-msg">${esc(describeConflict(c))}</div>` +
    repair +
    `</div>`
  );
}

/** The all-clear banner: deliberately not a summary line above an empty list. */
function allClear(text: string): string {
  return (
    `<div class="swb-verdict swb-verdict-ok">` +
    `<span class="swb-verdict-mark">&#10003;</span>` +
    `<span class="swb-verdict-txt">${esc(text)}</span>` +
    `</div>`
  );
}

/** The plain-text report, kept copyable behind a disclosure. */
function textReport(result: OverlapResult): string {
  return (
    `<details class="swb-ov-text">` +
    `<summary>Plain-text report</summary>` +
    `<div class="swb-ov-textwrap">` +
    `<button class="swb-btn swb-copy" data-action="copy-block" data-copy-target="swb-overlap-text">Copy</button>` +
    `<pre class="swb-pre" id="swb-overlap-text">${esc(renderOverlapText(result))}</pre>` +
    `</div>` +
    `</details>`
  );
}

function renderReport(model: OverlapModel, repairable: boolean): string {
  const { result, focused } = model;
  if (result.status === "empty") {
    return `<div class="swb-ov-summary">${esc(result.summary)}</div>`;
  }
  if (focused === null) {
    if (result.status === "all-clear") return allClear(result.summary);
    return (
      `<div class="swb-ov-summary">${esc(result.summary)}</div>` +
      result.conflicts.map((c) => conflictRow(c, repairable)).join("")
    );
  }
  const name = entryName(model, focused);
  const mine = conflictsForLine(result, focused + 1);
  const total = result.conflicts.length;
  const back =
    `<button class="swb-textlink" data-action="clear-overlap-filter">` +
    `show all ${total} conflict${total === 1 ? "" : "s"}</button>`;
  if (mine.length === 0) {
    return (
      `<div class="swb-ov-summary">${esc(name)} is clean; nothing overlaps it. ${back}</div>` +
      (total === 0 ? allClear(result.summary) : "")
    );
  }
  return (
    `<div class="swb-ov-summary">Showing ${mine.length} conflict${mine.length === 1 ? "" : "s"} ` +
    `for ${esc(name)}. ${back}</div>` +
    mine.map((c) => conflictRow(c, repairable)).join("")
  );
}

export function renderOverlapOutput(state: ShellState): string {
  const model = overlapModel(state);
  if (model.subnets.length === 0) {
    return (
      errorsBlock(model.errors) +
      `<div class="swb-hint">${HINT_SVG}<p><b>Waiting on a list.</b> ` +
      `Add subnets one at a time or paste a block, and conflicts get flagged with severity. ` +
      `Labels make the report readable: &quot;Knoxville overlaps Nashville&quot; beats ` +
      `&quot;these two overlap&quot;.</p></div>`
    );
  }
  return (
    errorsBlock(model.errors) +
    `<div class="swb-visual">${renderSpaceMap(model.result)}</div>` +
    renderReport(model, !state.overlapEditText) +
    textReport(model.result) +
    `<div class="swb-handoff">` +
    `<button class="swb-btn" data-action="overlap-to-vendor" data-line="">` +
    `&#8594; Send list to Vendor Syntax</button>` +
    `</div>`
  );
}

export const OVERLAP_CSS = `
.swb-roster-head { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; }
.swb-roster-head .swb-field-label { margin: 0; }
.swb-tally { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 6px; }
.swb-tally-err { color: var(--tool-danger, #d64550); background: var(--tool-danger-bg, rgba(214,69,80,0.08)); border: 1px solid rgba(214,69,80,0.35); }
.swb-tally-warn { color: var(--color-orange-deep, #e07200); background: var(--tool-warn-bg, rgba(224,114,0,0.08)); border: 1px solid rgba(224,114,0,0.35); }
.swb-tally-ok { color: var(--color-smokey-light, #6e6e6e); background: var(--color-panel, #f1efec); border: 1px solid var(--color-line, #e4e1dc); }
.swb-textlink { margin-left: auto; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.56rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); background: none; border: none; border-bottom: 1px solid rgba(75,75,75,0.3); padding: 0 0 1px; cursor: pointer; }
.swb-textlink:hover { color: var(--color-orange-deep, #e07200); border-bottom-color: var(--color-orange, #ff8200); }
/* Severity edge as an inset shadow, not a border: a border would shift the
   row's content 2px and break alignment with the clean rows above it. */
.swb-ov-error { box-shadow: inset 2px 0 0 var(--tool-danger, #d64550); }
.swb-ov-warning { box-shadow: inset 2px 0 0 var(--color-orange, #ff8200); }
.swb-entry .swb-sev { flex-shrink: 0; }
.swb-ov-summary { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.66rem; letter-spacing: 0.04em; line-height: 1.8; color: var(--color-smokey, #4b4b4b); margin-bottom: 10px; }
.swb-ov-summary .swb-textlink { margin-left: 4px; }
.swb-ovc { display: grid; grid-template-columns: 62px 1fr auto; gap: 14px; align-items: center; padding: 11px 14px; border: 1px solid var(--color-line, #e4e1dc); border-left-width: 2px; background: var(--color-void, #ffffff); margin-bottom: 6px; }
.swb-ovc-error { border-left-color: var(--tool-danger, #d64550); }
.swb-ovc-warning { border-left-color: var(--color-orange, #ff8200); }
.swb-ovc-msg { font-size: 0.8rem; line-height: 1.6; font-weight: 300; color: var(--color-ink, #2a2a2a); }
.swb-ovc-fix { flex-shrink: 0; white-space: nowrap; }
.swb-ov-text { margin-top: 14px; border: 1px solid var(--color-line, #e4e1dc); background: var(--color-deep, #f7f6f4); }
.swb-ov-text > summary { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); padding: 9px 12px; cursor: pointer; }
.swb-ov-text > summary:hover { color: var(--color-orange-deep, #e07200); }
.swb-ov-textwrap { position: relative; padding: 0 12px 12px; }
.swb-ov-textwrap .swb-copy { position: absolute; top: 8px; right: 20px; z-index: 1; }
@media (max-width: 768px) {
  .swb-ovc { grid-template-columns: 62px 1fr; }
  .swb-ovc-fix { grid-column: 2; justify-self: start; }
}
`.trim();
