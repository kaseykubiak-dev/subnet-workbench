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
import type {
  AksNetworkMode,
  AksPlan,
  EksIpMode,
  EksPlan,
  ServiceSelection,
} from "../cloud/capacity";
import { SERVICE_CONSUMERS } from "../cloud/capacity";
import type { PlatformId } from "../cloud/platforms";
import type { VendorId } from "../vendor/templates";

export type Mode = "calculate" | "overlap" | "vlsm" | "capacity" | "plan" | "vendor";

export const MODES: { id: Mode; label: string }[] = [
  { id: "calculate", label: "Calculate" },
  { id: "overlap", label: "Overlap" },
  { id: "vlsm", label: "VLSM" },
  { id: "capacity", label: "Capacity" },
  { id: "plan", label: "Plan" },
  { id: "vendor", label: "Vendor Syntax" },
];

/**
 * Selectable AKS networking modes.
 *
 * Lives here beside MODES rather than in the view because share.ts also needs
 * the id list to whitelist a decoded payload, and share.ts must not import a
 * view module.
 */
export const AKS_MODES: { id: AksNetworkMode; label: string }[] = [
  { id: "azure-cni-node-subnet", label: "Azure CNI · node subnet" },
  { id: "azure-cni-overlay", label: "Azure CNI · overlay" },
  { id: "azure-cni-pod-subnet", label: "Azure CNI · pod subnet" },
  { id: "kubenet", label: "kubenet" },
];

/** Selectable AWS VPC CNI address modes. */
export const EKS_MODES: { id: EksIpMode; label: string }[] = [
  { id: "secondary-ip", label: "Secondary IP" },
  { id: "prefix-delegation", label: "Prefix delegation" },
];

/**
 * The two questions Capacity mode can answer.
 *
 * Unlike the AKS/EKS split, which the platform decides on the user's behalf,
 * this one is a genuine choice: Kubernetes and the managed services are two
 * different workloads on the same platform, and someone sizing a landing zone
 * needs both. The platform still picks which catalogue is shown.
 */
export type CapacityWorkload = "kubernetes" | "services";

export const CAPACITY_WORKLOADS: { id: CapacityWorkload; label: string }[] = [
  { id: "kubernetes", label: "Kubernetes" },
  { id: "services", label: "Platform services" },
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
  /**
   * Capacity: the AKS/EKS plan inputs.
   *
   * Which set is live is decided by `platform` rather than by a mode-local
   * toggle, so the workload always matches the constraints already on screen.
   * Both sets persist regardless, because switching Azure to AWS to compare
   * and back should not cost you the numbers you typed.
   */
  aksMode: AksNetworkMode;
  aksNodes: number;
  /** Max pods per node; null means "use whatever this mode defaults to". */
  aksMaxPods: number | null;
  aksMaxSurge: number;
  eksMode: EksIpMode;
  eksNodes: number;
  eksEnisPerNode: number;
  eksIpsPerEni: number;
  eksPodsPerNode: number;
  eksCustomNetworking: boolean;
  /** Capacity: which of the two workloads is on screen. */
  capacityWorkload: CapacityWorkload;
  /**
   * Capacity / services: consumer id to unit count.
   *
   * Presence in the map IS selection, which is why an unticked service is
   * deleted rather than set to zero: zero endpoints is a thing someone might
   * legitimately type on the way to typing twelve, and it should not make the
   * row vanish. Keys are not filtered by platform here, so switching Azure to
   * AWS and back keeps the counts you already entered.
   */
  serviceCounts: Record<string, number>;
  /** Capacity / services: the SQL Managed Instance mix. */
  sqlMiGeneralPurpose: number;
  sqlMiBusinessCritical: number;
  sqlMiZoneRedundant: number;
  sqlMiVmGroups: number;
  /**
   * Capacity / services: Application Gateway sizing.
   *
   * The model takes a per-gateway array because gateways can be configured
   * differently; the UI offers one number applied to every gateway, which is
   * the common case and keeps the panel from growing a nested table. Anyone
   * with heterogeneous gateways can cost them one at a time.
   */
  appGwMaxInstances: number;
  appGwPrivateFrontend: boolean;
  /**
   * Plan: the whole address plan as indented text.
   *
   * One field rather than a structured tree, because the parser in
   * src/cloud/planText.ts is the only thing that needs the structure and the
   * textarea is what people actually paste into. It also means the plan
   * round-trips through a share link as-typed.
   */
  planInput: string;
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
  // Microsoft's own worked example (50 nodes, node subnet, surge 1 -> /21).
  // Capacity has no meaningful empty state — every field is a number with a
  // real default — so arriving on a documented example beats arriving on zero.
  aksMode: "azure-cni-node-subnet",
  aksNodes: 50,
  aksMaxPods: null,
  aksMaxSurge: 1,
  // A c5.large: 3 ENIs at 10 addresses each, which is AWS's worked example.
  eksMode: "secondary-ip",
  eksNodes: 20,
  eksEnisPerNode: 3,
  eksIpsPerEni: 10,
  eksPodsPerNode: 17,
  eksCustomNetworking: false,
  capacityWorkload: "kubernetes",
  serviceCounts: {},
  // Microsoft's smallest supported mix: one General Purpose instance, which
  // lands on the published 32-address floor and so shows the floor doing its
  // job the moment the row is ticked.
  sqlMiGeneralPurpose: 1,
  sqlMiBusinessCritical: 0,
  sqlMiZoneRedundant: 0,
  sqlMiVmGroups: 0,
  appGwMaxInstances: 10,
  appGwPrivateFrontend: true,
  planInput: "",
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

/**
 * Hand-off: drop generated plan text into Plan mode and switch there.
 *
 * Unlike the other hand-offs this one REPLACES rather than appends. A services
 * plan is a whole tree with its own supernet, so appending it under whatever
 * was already in the box would produce an invalid document. Anything already
 * there was a different plan, and silently welding two together would be worse
 * than the swap.
 */
export function sendToPlan(state: ShellState, text: string): ShellState {
  const trimmed = text.trim();
  if (trimmed === "") return state;
  return { ...state, mode: "plan", planInput: trimmed };
}

/** Toggle a service on or off. Off deletes the key; see `serviceCounts`. */
export function toggleService(state: ShellState, id: string): ShellState {
  const counts = { ...state.serviceCounts };
  if (id in counts) {
    delete counts[id];
  } else {
    counts[id] = 1;
  }
  return { ...state, serviceCounts: counts };
}

/** Set a selected service's unit count. Ticking is `toggleService`'s job. */
export function setServiceCount(state: ShellState, id: string, count: number): ShellState {
  if (!(id in state.serviceCounts)) return state;
  return {
    ...state,
    serviceCounts: { ...state.serviceCounts, [id]: clampInt(count, 0) },
  };
}

/**
 * The selections the estimator wants, built from the flat state fields.
 *
 * The two formula services get their sub-plan attached here rather than in the
 * view, so `estimateServices` sees the same inputs no matter who calls it. App
 * Gateway is left without one at zero gateways: an empty instance array cannot
 * be costed, and the estimator's "needs the configured maximum" warning says
 * that better than a silent zero would.
 */
export function serviceSelectionsFor(state: ShellState): ServiceSelection[] {
  const selections: ServiceSelection[] = [];
  for (const consumer of SERVICE_CONSUMERS) {
    const count = state.serviceCounts[consumer.id];
    if (count === undefined) continue;
    const selection: ServiceSelection = { id: consumer.id, count: clampInt(count, 0) };
    if (consumer.id === "azure-sql-mi") {
      selection.sqlMi = {
        generalPurpose: clampInt(state.sqlMiGeneralPurpose, 0),
        businessCritical: clampInt(state.sqlMiBusinessCritical, 0),
        zoneRedundant: clampInt(state.sqlMiZoneRedundant, 0),
        vmGroups: clampInt(state.sqlMiVmGroups, 0),
      };
    }
    if (consumer.id === "azure-app-gateway" && selection.count > 0) {
      const instances = clampInt(state.appGwMaxInstances, 1);
      selection.appGateway = {
        maxInstancesPerGateway: Array.from({ length: selection.count }, () => instances),
        gatewaysWithPrivateFrontend: state.appGwPrivateFrontend ? selection.count : 0,
      };
    }
    selections.push(selection);
  }
  return selections;
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

/**
 * Coerce a typed number into the integer the estimators demand.
 *
 * `estimateAks` and `estimateEks` throw RangeError on a fractional or
 * out-of-bounds input by design — they refuse to invent an answer. A text box
 * can hold "" or "3.5" mid-keystroke, so clamping happens here, once, rather
 * than being caught downstream in the view.
 */
function clampInt(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.floor(value));
}

/** The AKS plan implied by the current state, every field clamped legal. */
export function aksPlanFor(state: ShellState): AksPlan {
  const plan: AksPlan = {
    mode: state.aksMode,
    nodes: clampInt(state.aksNodes, 0),
    maxSurge: clampInt(state.aksMaxSurge, 0),
  };
  if (state.aksMaxPods !== null) {
    plan.maxPodsPerNode = clampInt(state.aksMaxPods, 0);
  }
  return plan;
}

/** The EKS plan implied by the current state, every field clamped legal. */
export function eksPlanFor(state: ShellState): EksPlan {
  return {
    mode: state.eksMode,
    nodes: clampInt(state.eksNodes, 0),
    // An instance always has at least one ENI, and an ENI always has at least
    // its own primary address plus one it could hand out.
    enisPerNode: clampInt(state.eksEnisPerNode, 1),
    ipsPerEni: clampInt(state.eksIpsPerEni, 2),
    podsPerNode: clampInt(state.eksPodsPerNode, 0),
    customNetworking: state.eksCustomNetworking,
  };
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
