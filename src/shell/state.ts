/**
 * Page shell state: one plain object, pure transition functions.
 *
 * The shell is framework-agnostic on purpose. The Next.js page and the
 * single-file standalone both mount the same shell (src/shell/app.ts); the
 * state layer here has no DOM dependency at all so every transition —
 * including the mode hand-offs that make this a toolkit rather than four
 * calculators — is unit-testable.
 */

import { parseSubnetList } from "../engine/parse";
import type { PlatformId } from "../cloud/platforms";
import type { VendorId } from "../vendor/templates";

export type Mode = "calculate" | "overlap" | "vlsm" | "vendor";

export const MODES: { id: Mode; label: string }[] = [
  { id: "calculate", label: "Calculate" },
  { id: "overlap", label: "Overlap" },
  { id: "vlsm", label: "VLSM" },
  { id: "vendor", label: "Vendor Syntax" },
];

export interface ShellState {
  mode: Mode;
  /**
   * Cloud platform context, global rather than per-mode.
   *
   * A subnet does not stop being an Azure subnet because you switched from
   * Calculate to Overlap, so this lives beside `mode` instead of inside any
   * one mode's fields. "none" is the default and means RFC behavior: with it
   * set, nothing anywhere in the shell changes from how the tool behaved
   * before cloud mode existed.
   */
  platform: PlatformId;
  /** Calculate: committed entries, one subnet line each. */
  calculateInput: string;
  /** Calculate: index of the selected entry. */
  calculateSelected: number;
  /** Calculate: uncommitted content of the add-subnet box. */
  calculateDraft: string;
  /** Calculate: lines that failed the last commit (newline-joined messages). */
  calculateDraftError: string;
  /** Calculate: prefix-slider target; null = derived default (prefix+2). */
  splitTarget: number | null;
  /** Overlap: one subnet per line. */
  overlapInput: string;
  /** VLSM: the supernet line. */
  vlsmSupernetInput: string;
  /** VLSM: one requirement per line. */
  vlsmRequirementsInput: string;
  /** VLSM: growth headroom percent. */
  vlsmHeadroom: number;
  /** Vendor: one subnet per line. */
  vendorInput: string;
  vendorId: VendorId;
}

export const initialState: ShellState = {
  mode: "calculate",
  platform: "none",
  calculateInput: "",
  calculateSelected: 0,
  calculateDraft: "",
  calculateDraftError: "",
  splitTarget: null,
  overlapInput: "",
  vlsmSupernetInput: "",
  vlsmRequirementsInput: "",
  vlsmHeadroom: 0,
  vendorInput: "",
  vendorId: "fortios",
};

/** Switch mode; everything else carries over (that is the point). */
export function setMode(state: ShellState, mode: Mode): ShellState {
  return { ...state, mode };
}

/**
 * Switch cloud platform. Deliberately touches nothing else: the platform is
 * a lens over the same addressing, so the subnets you are holding should
 * survive being looked at as Azure, then as AWS, then as neither.
 */
export function setPlatform(state: ShellState, platform: PlatformId): ShellState {
  return { ...state, platform };
}

/** True when a cloud platform is selected (i.e. not on-prem/RFC). */
export function isCloudMode(state: ShellState): boolean {
  return state.platform !== "none";
}

/** Append a line to a newline-separated field without duplicating it. */
function appendLine(existing: string, line: string): string {
  const lines = existing
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.includes(line.trim())) return existing;
  lines.push(line.trim());
  return lines.join("\n");
}

/** Hand-off: push a subnet line into the Overlap list and switch there. */
export function addToOverlap(state: ShellState, line: string): ShellState {
  return {
    ...state,
    mode: "overlap",
    overlapInput: appendLine(state.overlapInput, line),
  };
}

/** Hand-off: use a subnet as the VLSM supernet and switch there. */
export function useAsVlsmSupernet(state: ShellState, line: string): ShellState {
  return { ...state, mode: "vlsm", vlsmSupernetInput: line.trim() };
}

/** Hand-off: push a subnet line into the Vendor list and switch there. */
export function sendToVendor(state: ShellState, line: string): ShellState {
  return {
    ...state,
    mode: "vendor",
    vendorInput: appendLine(state.vendorInput, line),
  };
}

/** Calculate entries: the committed lines, trimmed, empties dropped. */
export function calculateEntries(state: ShellState): string[] {
  return state.calculateInput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** The parsed subnet for the selected Calculate entry, if valid. */
export function selectedCalculateSubnet(state: ShellState) {
  const entries = calculateEntries(state);
  const line = entries[clampSelection(state.calculateSelected, entries.length)];
  if (line === undefined) return undefined;
  return parseSubnetList(line).subnets[0];
}

function clampSelection(index: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(0, index), count - 1);
}

/**
 * Commit the draft box: valid lines join the entry list (deduped), invalid
 * lines stay in the draft with their errors surfaced. Selection moves to
 * the last entry added.
 */
export function commitCalculateDraft(state: ShellState): ShellState {
  const { subnets, errors } = parseSubnetList(state.calculateDraft);
  if (subnets.length === 0 && errors.length === 0) return state;
  let input = state.calculateInput;
  for (const s of subnets) {
    input = appendLine(input, s.raw);
  }
  const entries = input
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lastAdded = subnets[subnets.length - 1];
  const selected =
    lastAdded !== undefined
      ? Math.max(0, entries.indexOf(lastAdded.raw.trim()))
      : clampSelection(state.calculateSelected, entries.length);
  return {
    ...state,
    calculateInput: entries.join("\n"),
    calculateSelected: selected,
    calculateDraft: errors.map((e) => e.raw).join("\n"),
    calculateDraftError: errors
      .map((e) => `${e.raw} —> ${e.message}`)
      .join("\n"),
  };
}

/** Select a Calculate entry by index (clamped). */
export function selectCalculateEntry(state: ShellState, index: number): ShellState {
  const count = calculateEntries(state).length;
  return { ...state, calculateSelected: clampSelection(index, count) };
}

/** Remove a Calculate entry; selection follows sensibly. */
export function removeCalculateEntry(state: ShellState, index: number): ShellState {
  const entries = calculateEntries(state);
  if (index < 0 || index >= entries.length) return state;
  entries.splice(index, 1);
  let selected = state.calculateSelected;
  if (index < selected) selected -= 1;
  return {
    ...state,
    calculateInput: entries.join("\n"),
    calculateSelected: clampSelection(selected, entries.length),
  };
}

/** Subnets currently held across the list inputs (footer status). */
export function heldSubnetCount(state: ShellState): number {
  const held = new Set<string>();
  for (const text of [state.overlapInput, state.vendorInput]) {
    for (const s of parseSubnetList(text).subnets) {
      held.add(`${s.network}/${s.prefix}`);
    }
  }
  return held.size;
}

/** Clamp the slider target into [prefix, 32]; default prefix+2, capped. */
export function effectiveSplitTarget(
  state: ShellState,
  prefix: number
): number {
  const fallback = Math.min(prefix + 2, 32);
  const raw = state.splitTarget ?? fallback;
  return Math.min(32, Math.max(prefix, raw));
}
