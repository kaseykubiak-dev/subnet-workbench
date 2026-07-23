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
  /** Calculate: single subnet input. */
  calculateInput: string;
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
  calculateInput: "",
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
