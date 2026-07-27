/**
 * The shared entry roster: Part 1 Variant A "inline field editing" and Part 2
 * Variant A "checkbox column" (both chosen 2026-07-26 from
 * mockups/entry-edit-multiselect-mockups.html).
 *
 * Calculate and Overlap grew the same list from opposite directions and had
 * been maintaining two copies of it. They differ only in row decoration —
 * Calculate marks a bad line, Overlap adds a severity edge and a chip — so the
 * shape lives here once and each caller supplies its own decorations and its
 * own action names.
 *
 * A leaf module on purpose: it imports nothing from view.ts or overlapView.ts,
 * so both can import it without the cycle that made those two restate each
 * other's fragments in the first place.
 *
 * Pure like every other view module: data in, HTML strings out, no DOM.
 *
 * Three deliberate departures from the mockup:
 *
 * 1. The inline editor carries a check and a × as well as responding to Enter
 *    and Esc. The mockup showed keys only, which leaves a mouse user with no
 *    visible way out of a row they opened by accident.
 *
 * 2. Blur does not commit and does not cancel. Committing on blur can silently
 *    delete a row somebody cleared by accident; cancelling on blur throws away
 *    typing. The row simply stays open, which is the only option that loses
 *    nothing.
 *
 * 3. All / None is two links rather than one toggling link. A single control
 *    that means "all" or "none" depending on invisible state is a coin flip
 *    from the user's side, and this one is next to a delete button.
 */

import { esc } from "../visuals/svg";

/** One row's display content, already parsed and decorated by the caller. */
export interface RosterRow {
  /** The raw line. Shown when the line does not parse; seeds the editor. */
  raw: string;
  /** Display label, "" when the line carries none. */
  label: string;
  /** Display CIDR; undefined when the line does not parse. */
  cidr: string | undefined;
  /** Extra classes on the row (severity edge, bad-line marker). */
  className: string;
  /** Markup slotted between the CIDR and the controls (Overlap's chip). */
  trailing: string;
  /** False for rows clicking through would say something untrue about. */
  selectable: boolean;
}

/** A button on the bulk bar. */
export interface BulkAction {
  action: string;
  label: string;
  /**
   * True when the action takes exactly one subnet, not a set. The button stays
   * visible but disabled rather than vanishing, so the reason a VLSM hand-off
   * is unavailable reads as "not with three ticked" instead of as an absence.
   */
  singleOnly?: boolean;
  danger?: boolean;
}

/** Per-roster `data-action` names, so the two rosters never cross wires. */
export interface RosterActions {
  select: string;
  check: string;
  checkAll: string;
  beginEdit: string;
  commitEdit: string;
  cancelEdit: string;
  remove: string;
}

export interface RosterSpec {
  rows: RosterRow[];
  /** The selected or focused row; null when none is. */
  selected: number | null;
  /** The row under inline edit; null when none is. */
  editing: number | null;
  editDraft: string;
  editError: string;
  checked: number[];
  /** `data-field` for the inline editor, so input events route correctly. */
  editField: string;
  actions: RosterActions;
  bulk: BulkAction[];
}

/** The head above a roster: a label, an optional badge, right-aligned links. */
export function renderRosterHead(
  label: string,
  badge: string,
  controls: string[]
): string {
  const right =
    controls.length > 0 ? `<span class="swb-roster-ctl">${controls.join("")}</span>` : "";
  return (
    `<div class="swb-roster-head">` +
    `<span class="swb-field-label swb-inline">${label}</span>` +
    badge +
    right +
    `</div>`
  );
}

/**
 * The All / None pair for a roster head.
 *
 * "All" carries the full index list rather than a flag, so the handler is the
 * same one-liner for both links and neither has to recount the list.
 */
export function renderCheckAll(action: string, count: number): string {
  if (count === 0) return "";
  const every = Array.from({ length: count }, (_, i) => i).join(",");
  return (
    `<span class="swb-allnone">` +
    `<button class="swb-textlink" data-action="${esc(action)}" data-indices="${every}">All</button>` +
    `<span class="swb-allnone-sep">/</span>` +
    `<button class="swb-textlink" data-action="${esc(action)}" data-indices="">None</button>` +
    `</span>`
  );
}

function controls(spec: RosterSpec, index: number): string {
  const { actions } = spec;
  return (
    `<button class="swb-entry-ed" data-action="${esc(actions.beginEdit)}" ` +
    `data-index="${index}" aria-label="Edit entry">&#9998;</button>` +
    `<button class="swb-entry-x" data-action="${esc(actions.remove)}" ` +
    `data-indices="${index}" aria-label="Remove entry">&times;</button>`
  );
}

function checkbox(spec: RosterSpec, index: number): string {
  const on = spec.checked.includes(index) ? " checked" : "";
  return (
    `<input type="checkbox" class="swb-entry-ck" data-action="${esc(spec.actions.check)}" ` +
    `data-index="${index}"${on} aria-label="Select entry ${index + 1}">`
  );
}

/**
 * The line under an open editor: the reason it will not commit, or the keys.
 *
 * Exported because app.ts swaps this node in place while someone is typing.
 * Redrawing the whole roster to clear a stale error would take the caret with
 * it, and the two modules must not disagree about what the slot looks like.
 *
 * `swb-entry-foot` carries no styling of its own; it is the selector app.ts
 * reaches for, and it is on both variants so the swap works in either
 * direction. The look comes from the second class.
 */
export function renderEditFoot(error: string): string {
  return error !== ""
    ? `<div class="swb-entry-foot swb-error swb-entry-err">${esc(error)}</div>`
    : `<div class="swb-entry-foot swb-entry-hint">Enter saves &middot; Esc cancels</div>`;
}

/**
 * The row swapped for a text box.
 *
 * The index stays put and the checkbox goes away: an editing row is already the
 * one you are acting on, and leaving a tickbox beside a half-typed line invites
 * bulk-deleting the thing you are in the middle of fixing.
 */
function editingRow(spec: RosterSpec, index: number): string {
  const idx = String(index + 1).padStart(2, "0");
  const foot = renderEditFoot(spec.editError);
  return (
    `<div class="swb-entry swb-entry-edit">` +
    `<span class="swb-entry-idx">${idx}</span>` +
    `<input class="swb-entry-inp" type="text" data-field="${esc(spec.editField)}" ` +
    `value="${esc(spec.editDraft)}" spellcheck="false" autocomplete="off" ` +
    `aria-label="Edit entry ${index + 1}">` +
    `<button class="swb-entry-ok" data-action="${esc(spec.actions.commitEdit)}" ` +
    `aria-label="Save entry">&#10003;</button>` +
    `<button class="swb-entry-x" data-action="${esc(spec.actions.cancelEdit)}" ` +
    `aria-label="Cancel edit">&times;</button>` +
    `</div>` +
    foot
  );
}

function row(spec: RosterSpec, index: number): string {
  if (index === spec.editing) return editingRow(spec, index);
  const r = spec.rows[index];
  if (r === undefined) return "";
  const idx = String(index + 1).padStart(2, "0");
  const sel = index === spec.selected ? " swb-sel" : "";
  const ticked = spec.checked.includes(index) ? " swb-ck" : "";
  const extra = r.className === "" ? "" : ` ${r.className}`;
  const open = r.selectable
    ? `<div class="swb-entry${extra}${sel}${ticked}" data-action="${esc(spec.actions.select)}" data-index="${index}">`
    : `<div class="swb-entry${extra}${sel}${ticked}">`;
  const body =
    r.cidr === undefined
      ? `<span class="swb-entry-lbl">${esc(r.raw)}</span>`
      : `<span class="swb-entry-lbl">${esc(r.label)}</span>` +
        `<span class="swb-entry-cidr">${esc(r.cidr)}</span>`;
  return (
    open +
    checkbox(spec, index) +
    `<span class="swb-entry-idx">${idx}</span>` +
    body +
    r.trailing +
    controls(spec, index) +
    `</div>`
  );
}

/**
 * The bulk bar, shown only while something is ticked.
 *
 * It sits under the list rather than floating over it, because the list is
 * short enough to see whole and a floating bar would cover the rows whose
 * ticks it is describing.
 */
function bulkBar(spec: RosterSpec): string {
  const n = spec.checked.length;
  if (n === 0 || spec.bulk.length === 0) return "";
  const buttons = spec.bulk
    .map((b) => {
      const off = b.singleOnly === true && n !== 1 ? " disabled" : "";
      const danger = b.danger === true ? " swb-bulk-del" : "";
      return (
        `<button class="swb-btn swb-ghost${danger}" data-action="${esc(b.action)}"${off}>` +
        `${esc(b.label)}</button>`
      );
    })
    .join("");
  return (
    `<div class="swb-bulk">` +
    `<span class="swb-bulk-count">${n} selected</span>` +
    buttons +
    `</div>`
  );
}

/** The roster and its bulk bar. Empty string when there is nothing to list. */
export function renderRoster(spec: RosterSpec): string {
  if (spec.rows.length === 0) return "";
  const rows = spec.rows.map((_, i) => row(spec, i)).join("");
  return `<div class="swb-entries">${rows}</div>` + bulkBar(spec);
}

export const ROSTER_CSS = `
.swb-roster-head { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; }
.swb-roster-head .swb-field-label { margin: 0; }
.swb-textlink { margin-left: auto; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.56rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); background: none; border: none; border-bottom: 1px solid rgba(75,75,75,0.3); padding: 0 0 1px; cursor: pointer; }
.swb-textlink:hover { color: var(--color-orange-deep, #e07200); border-bottom-color: var(--color-orange, #ff8200); }
.swb-roster-ctl { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.swb-roster-ctl .swb-textlink { margin-left: 0; }
.swb-allnone { display: inline-flex; align-items: center; gap: 5px; }
.swb-allnone-sep { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.56rem; color: var(--color-line-strong, #cfcac2); }
/* The tickbox is small and unaccented at rest so a roster nobody is
   bulk-editing still reads as a list rather than as a form. */
.swb-entry-ck { flex-shrink: 0; width: 12px; height: 12px; margin: 0; accent-color: var(--color-orange, #ff8200); cursor: pointer; }
.swb-entry.swb-ck { background: rgba(255,130,0,0.05); }
.swb-entry.swb-ck.swb-sel { background: rgba(255,130,0,0.12); }
/* Row controls stay invisible until the row is under the cursor: two icons on
   every line of a thirty-line roster is more chrome than content. Focus counts
   as hover so the keyboard path is not a hidden one. */
.swb-entry-ed { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.68rem; color: var(--color-smokey-light, #6e6e6e); background: none; border: none; cursor: pointer; padding: 0 2px; opacity: 0; transition: opacity 0.12s, color 0.12s; }
.swb-entry:hover .swb-entry-ed, .swb-entry-ed:focus-visible { opacity: 1; }
.swb-entry-ed:hover { color: var(--color-orange-deep, #e07200); }
.swb-entry-edit { background: rgba(255,130,0,0.06); cursor: default; }
.swb-entry-inp { flex: 1 1 auto; min-width: 0; font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.68rem; color: var(--color-ink, #2a2a2a); background: var(--color-void, #ffffff); border: 1px solid var(--color-orange, #ff8200); padding: 3px 6px; outline: none; }
.swb-entry-ok { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.7rem; color: var(--color-smokey-light, #6e6e6e); background: none; border: none; cursor: pointer; padding: 0 2px; }
.swb-entry-ok:hover { color: var(--color-orange-deep, #e07200); }
.swb-entry-hint { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-smokey-light, #6e6e6e); padding: 3px 10px 6px 34px; }
.swb-entry-err { margin: 0; padding: 3px 10px 6px 34px; }
.swb-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -16px 0 16px; padding: 8px 10px; border: 1px solid var(--color-line, #e4e1dc); border-top: none; background: var(--color-panel, #f1efec); }
.swb-bulk-count { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 0.54rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-orange-deep, #e07200); margin-right: 4px; }
.swb-bulk .swb-btn { font-size: 0.54rem; padding: 5px 8px; }
.swb-bulk .swb-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.swb-bulk-del:not([disabled]):hover { color: var(--tool-danger, #d64550); border-color: var(--tool-danger, #d64550); }
`.trim();
