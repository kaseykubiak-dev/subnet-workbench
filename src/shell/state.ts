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
  /**
   * Calculate: index of the entry being edited in place; null = none.
   *
   * Editing is a separate concept from selection because the two answer
   * different questions: selection says which subnet the results panel is
   * about, editing says which row has been temporarily replaced by a text box.
   * Only one row can be in edit at a time, which is why this is an index and
   * not a set.
   */
  calculateEditing: number | null;
  /** Calculate: the inline editor's uncommitted text. */
  calculateEditDraft: string;
  /** Calculate: why the inline edit will not commit; "" = it will. */
  calculateEditError: string;
  /**
   * Calculate: indices ticked for a bulk action, ascending, no duplicates.
   *
   * An array rather than a Set so the state object stays plain JSON, which is
   * what the share-link encoder assumes of everything it walks. Ticking is
   * deliberately independent of selection: you routinely want to bulk-send
   * three rows while still reading the results for a fourth.
   */
  calculateChecked: number[];
  /** Calculate: prefix-slider target; null = derived default (prefix+2). */
  splitTarget: number | null;
  /** Overlap: committed entries, one subnet line each. */
  overlapInput: string;
  /**
   * Overlap: index of the focused entry; null means no filter.
   *
   * Unlike `calculateSelected` this is nullable, because the two lists mean
   * different things by selection. In Calculate a row is the subject and one
   * of them is always the subject; in Overlap the whole list is the subject
   * and focusing a row narrows the report, so "no filter" has to be a state
   * you can get back to.
   */
  overlapSelected: number | null;
  /** Overlap: uncommitted content of the add-subnet box. */
  overlapDraft: string;
  /** Overlap: lines that failed the last commit (newline-joined messages). */
  overlapDraftError: string;
  /**
   * Overlap: true while the roster is swapped for the raw textarea.
   *
   * Overlap's opening move is pasting thirty lines out of a spreadsheet and
   * then editing that block wholesale, which a committed-entry list makes
   * harder than the textarea it replaced. The toggle keeps both affordances
   * instead of trading one for the other.
   */
  overlapEditText: boolean;
  /** Overlap: index of the entry being edited in place; null = none. */
  overlapEditing: number | null;
  /** Overlap: the inline editor's uncommitted text. */
  overlapEditDraft: string;
  /** Overlap: why the inline edit will not commit; "" = it will. */
  overlapEditError: string;
  /** Overlap: indices ticked for a bulk action, ascending, no duplicates. */
  overlapChecked: number[];
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
  calculateEditing: null,
  calculateEditDraft: "",
  calculateEditError: "",
  calculateChecked: [],
  splitTarget: null,
  overlapInput: "",
  overlapSelected: null,
  overlapDraft: "",
  overlapDraftError: "",
  overlapEditText: false,
  overlapEditing: null,
  overlapEditDraft: "",
  overlapEditError: "",
  overlapChecked: [],
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

/**
 * Hand-off: push a subnet line into the Overlap list and switch there.
 *
 * The focus filter is dropped on arrival. You came here to find out whether
 * the subnet you just sent collides with anything, and a report still narrowed
 * to some other row would answer a question you are no longer asking.
 */
export function addToOverlap(state: ShellState, line: string): ShellState {
  return {
    ...state,
    mode: "overlap",
    overlapInput: appendLine(state.overlapInput, line),
    overlapSelected: null,
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

/** The committed lines of a list field, trimmed, empties dropped. */
function splitEntries(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Calculate entries: the committed lines, trimmed, empties dropped. */
export function calculateEntries(state: ShellState): string[] {
  return splitEntries(state.calculateInput);
}

/** Overlap entries: the committed lines, trimmed, empties dropped. */
export function overlapEntries(state: ShellState): string[] {
  return splitEntries(state.overlapInput);
}

/**
 * The text the Overlap report is parsed from.
 *
 * In roster mode this is the normalized entry join, which is what makes entry
 * index N and parse `lineNumber` N+1 the same row: `parseSubnetList` numbers
 * every line it is given, blanks included, so feeding it the raw field would
 * desynchronize the roster from its own findings. In text mode the raw field
 * is used instead, so the inline error line numbers match the textarea the
 * user is looking at.
 */
export function overlapSource(state: ShellState): string {
  return state.overlapEditText ? state.overlapInput : overlapEntries(state).join("\n");
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

interface DraftCommit {
  /** The entry list after the valid draft lines were appended. */
  entries: string[];
  /** The last valid line added, trimmed; undefined when none parsed. */
  lastAdded: string | undefined;
  /** What stays behind in the draft box (the lines that failed). */
  draft: string;
  /** Newline-joined "raw —> message" for each failed line. */
  draftError: string;
  /** False when the draft was blank, meaning the caller should not change state. */
  changed: boolean;
}

/**
 * Commit a draft box into an entry list. Shared by Calculate and Overlap so
 * the two rosters cannot drift on the things a user would notice: dedupe,
 * multi-line paste, and bad lines staying put with their reason attached
 * rather than being silently dropped.
 */
function commitDraftLines(input: string, draft: string): DraftCommit {
  const { subnets, errors } = parseSubnetList(draft);
  if (subnets.length === 0 && errors.length === 0) {
    return {
      entries: splitEntries(input),
      lastAdded: undefined,
      draft,
      draftError: "",
      changed: false,
    };
  }
  let next = input;
  for (const s of subnets) {
    next = appendLine(next, s.raw);
  }
  return {
    entries: splitEntries(next),
    lastAdded: subnets[subnets.length - 1]?.raw.trim(),
    draft: errors.map((e) => e.raw).join("\n"),
    draftError: errors.map((e) => `${e.raw} —> ${e.message}`).join("\n"),
    changed: true,
  };
}

/**
 * Commit the draft box: valid lines join the entry list (deduped), invalid
 * lines stay in the draft with their errors surfaced. Selection moves to
 * the last entry added.
 */
export function commitCalculateDraft(state: ShellState): ShellState {
  const commit = commitDraftLines(state.calculateInput, state.calculateDraft);
  if (!commit.changed) return state;
  const selected =
    commit.lastAdded !== undefined
      ? Math.max(0, commit.entries.indexOf(commit.lastAdded))
      : clampSelection(state.calculateSelected, commit.entries.length);
  return {
    ...state,
    calculateInput: commit.entries.join("\n"),
    calculateSelected: selected,
    calculateDraft: commit.draft,
    calculateDraftError: commit.draftError,
  };
}

/**
 * Commit the Overlap draft box. Same mechanics as Calculate, opposite
 * selection behavior: the filter is cleared rather than moved to the new row.
 * Adding a subnet is the moment you want to know whether it collides with
 * anything at all, and a report still narrowed to the row you were reading a
 * second ago would hide exactly that.
 */
export function commitOverlapDraft(state: ShellState): ShellState {
  const commit = commitDraftLines(state.overlapInput, state.overlapDraft);
  if (!commit.changed) return state;
  return {
    ...state,
    overlapInput: commit.entries.join("\n"),
    overlapSelected: null,
    overlapDraft: commit.draft,
    overlapDraftError: commit.draftError,
  };
}

/** Select a Calculate entry by index (clamped). */
export function selectCalculateEntry(state: ShellState, index: number): ShellState {
  const count = calculateEntries(state).length;
  return { ...state, calculateSelected: clampSelection(index, count) };
}

/** The removable indices in `raw`, deduped, in-range, ascending. */
function doomedIndices(raw: number[], count: number): number[] {
  return [...new Set(raw)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < count)
    .sort((a, b) => a - b);
}

/**
 * Where an index lands once `doomed` is cut, or null if it was cut itself.
 *
 * Every index the shell holds onto — the focus filter, the ticked set — is a
 * position in a list that removal renumbers underneath it. Doing that
 * arithmetic in one place is what keeps a bulk delete from silently reassigning
 * a tick to whichever row slid into the gap.
 */
function shiftIndex(index: number, doomed: number[]): number | null {
  if (doomed.includes(index)) return null;
  return index - doomed.filter((i) => i < index).length;
}

/** Renumber a ticked set across a removal, dropping the rows that went. */
function shiftChecked(checked: number[], doomed: number[]): number[] {
  const next: number[] = [];
  for (const index of checked) {
    const moved = shiftIndex(index, doomed);
    if (moved !== null) next.push(moved);
  }
  return next;
}

/**
 * Remove one or more Calculate entries in a single step.
 *
 * Plural for the same reason `removeOverlapEntries` is: the bulk bar deletes a
 * ticked set, and removing those one at a time would shift each remaining index
 * out from under the next removal. Indices resolve against the list as it
 * stands before anything is cut.
 */
export function removeCalculateEntries(state: ShellState, indices: number[]): ShellState {
  const entries = calculateEntries(state);
  const doomed = doomedIndices(indices, entries.length);
  if (doomed.length === 0) return state;
  const kept = entries.filter((_, i) => !doomed.includes(i));
  let selected = state.calculateSelected;
  selected -= doomed.filter((i) => i < selected).length;
  return {
    ...state,
    calculateInput: kept.join("\n"),
    calculateSelected: clampSelection(selected, kept.length),
    calculateChecked: shiftChecked(state.calculateChecked, doomed),
    // An in-flight edit is abandoned rather than renumbered. The draft belongs
    // to a row, and a row that just moved is not obviously the same row to the
    // person who was typing into it.
    calculateEditing: null,
    calculateEditDraft: "",
    calculateEditError: "",
  };
}

/** Remove a single Calculate entry; selection and ticks follow sensibly. */
export function removeCalculateEntry(state: ShellState, index: number): ShellState {
  return removeCalculateEntries(state, [index]);
}

/**
 * Focus an Overlap entry. Clicking the focused row again clears the filter,
 * so the way out of a narrowed report is the same gesture that got you in.
 */
export function selectOverlapEntry(state: ShellState, index: number): ShellState {
  if (index < 0 || index >= overlapEntries(state).length) return state;
  return { ...state, overlapSelected: state.overlapSelected === index ? null : index };
}

/** Drop the Overlap focus filter: the report shows every conflict again. */
export function clearOverlapFilter(state: ShellState): ShellState {
  return { ...state, overlapSelected: null };
}

/**
 * Remove one or more Overlap entries in a single step.
 *
 * Plural because the common repair for a duplicate entry is deleting both
 * sides of the conflict, and doing that as two separate removals means the
 * second index has already shifted under the user by the time they click it.
 * Indices are resolved against the list as it stands before anything is cut.
 */
export function removeOverlapEntries(state: ShellState, indices: number[]): ShellState {
  const entries = overlapEntries(state);
  const doomed = doomedIndices(indices, entries.length);
  if (doomed.length === 0) return state;
  const kept = entries.filter((_, i) => !doomed.includes(i));
  const selected =
    state.overlapSelected === null ? null : shiftIndex(state.overlapSelected, doomed);
  return {
    ...state,
    overlapInput: kept.join("\n"),
    overlapSelected: selected,
    overlapChecked: shiftChecked(state.overlapChecked, doomed),
    overlapEditing: null,
    overlapEditDraft: "",
    overlapEditError: "",
  };
}

interface EntryEdit {
  /** The entry list with the edited line replaced; unchanged when `error`. */
  entries: string[];
  /** Why the edit will not commit; "" when it will. */
  error: string;
}

/**
 * Replace one line of an entry list, or explain why not.
 *
 * Shared by both rosters so the rules cannot drift. Three of them are worth
 * stating out loud:
 *
 * - An empty field is an error, not a deletion. Clearing a field by accident
 *   and pressing Enter is common; having that silently delete the row is the
 *   kind of data loss an undo-less tool cannot afford.
 * - One entry holds one subnet. Pasting a block into a single row would
 *   renumber everything below it, which is what the add box is for.
 * - Duplicates ARE allowed here, unlike the draft box which dedupes. In Overlap
 *   an identical pair is precisely the conflict the tool exists to report, so
 *   editing a row into a collision has to be possible.
 */
function editEntryLines(entries: string[], index: number, draft: string): EntryEdit {
  if (index < 0 || index >= entries.length) return { entries, error: "" };
  const trimmed = draft.trim();
  if (trimmed === "") {
    return { entries, error: "An entry cannot be empty. Use the × to remove it." };
  }
  const { subnets, errors } = parseSubnetList(trimmed);
  if (subnets.length + errors.length > 1) {
    return { entries, error: "One subnet per entry. Use the add box for more." };
  }
  const subnet = subnets[0];
  if (subnet === undefined) {
    const failure = errors[0];
    return {
      entries,
      error:
        failure === undefined
          ? `${trimmed} —> not a subnet`
          : `${failure.raw} —> ${failure.message}`,
    };
  }
  const next = [...entries];
  next[index] = subnet.raw.trim();
  return { entries: next, error: "" };
}

/**
 * Open the inline editor on a Calculate row.
 *
 * Selection moves with it, because in Calculate the selected row is the one the
 * results panel describes and editing a row you cannot see the output for makes
 * no sense.
 */
export function beginEditCalculateEntry(state: ShellState, index: number): ShellState {
  const entries = calculateEntries(state);
  const line = entries[index];
  if (line === undefined) return state;
  return {
    ...state,
    calculateSelected: index,
    calculateEditing: index,
    calculateEditDraft: line,
    calculateEditError: "",
  };
}

/** Type into the Calculate inline editor. Errors clear as soon as you do. */
export function updateCalculateEditDraft(state: ShellState, draft: string): ShellState {
  if (state.calculateEditing === null) return state;
  return { ...state, calculateEditDraft: draft, calculateEditError: "" };
}

/** Commit the Calculate inline edit, or hold the row open with the reason. */
export function commitCalculateEditEntry(state: ShellState): ShellState {
  const index = state.calculateEditing;
  if (index === null) return state;
  const edit = editEntryLines(calculateEntries(state), index, state.calculateEditDraft);
  if (edit.error !== "") return { ...state, calculateEditError: edit.error };
  return {
    ...state,
    calculateInput: edit.entries.join("\n"),
    calculateEditing: null,
    calculateEditDraft: "",
    calculateEditError: "",
  };
}

/** Abandon the Calculate inline edit; the row comes back untouched. */
export function cancelCalculateEditEntry(state: ShellState): ShellState {
  if (state.calculateEditing === null) return state;
  return { ...state, calculateEditing: null, calculateEditDraft: "", calculateEditError: "" };
}

/**
 * Open the inline editor on an Overlap row.
 *
 * The focus filter is left alone, unlike Calculate's selection. Overlap's
 * selection narrows the report rather than naming a subject, and quietly
 * narrowing it because someone fixed a typo would hide the other conflicts they
 * were in the middle of reading.
 */
export function beginEditOverlapEntry(state: ShellState, index: number): ShellState {
  const line = overlapEntries(state)[index];
  if (line === undefined) return state;
  return { ...state, overlapEditing: index, overlapEditDraft: line, overlapEditError: "" };
}

/** Type into the Overlap inline editor. Errors clear as soon as you do. */
export function updateOverlapEditDraft(state: ShellState, draft: string): ShellState {
  if (state.overlapEditing === null) return state;
  return { ...state, overlapEditDraft: draft, overlapEditError: "" };
}

/** Commit the Overlap inline edit, or hold the row open with the reason. */
export function commitOverlapEditEntry(state: ShellState): ShellState {
  const index = state.overlapEditing;
  if (index === null) return state;
  const edit = editEntryLines(overlapEntries(state), index, state.overlapEditDraft);
  if (edit.error !== "") return { ...state, overlapEditError: edit.error };
  return {
    ...state,
    overlapInput: edit.entries.join("\n"),
    overlapEditing: null,
    overlapEditDraft: "",
    overlapEditError: "",
  };
}

/** Abandon the Overlap inline edit; the row comes back untouched. */
export function cancelOverlapEditEntry(state: ShellState): ShellState {
  if (state.overlapEditing === null) return state;
  return { ...state, overlapEditing: null, overlapEditDraft: "", overlapEditError: "" };
}

/** A ticked set reduced to what the list can actually hold, ascending. */
function normalizeChecked(indices: number[], count: number): number[] {
  return doomedIndices(indices, count);
}

/** Tick or untick one row. */
function toggleChecked(checked: number[], index: number, count: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= count) return checked;
  return checked.includes(index)
    ? checked.filter((i) => i !== index)
    : normalizeChecked([...checked, index], count);
}

/** Tick or untick a Calculate row. Independent of which row is selected. */
export function toggleCalculateChecked(state: ShellState, index: number): ShellState {
  const count = calculateEntries(state).length;
  return { ...state, calculateChecked: toggleChecked(state.calculateChecked, index, count) };
}

/** Set the Calculate ticked set outright; this is what All / None calls. */
export function setCalculateChecked(state: ShellState, indices: number[]): ShellState {
  const count = calculateEntries(state).length;
  return { ...state, calculateChecked: normalizeChecked(indices, count) };
}

/** Tick or untick an Overlap row. Independent of the focus filter. */
export function toggleOverlapChecked(state: ShellState, index: number): ShellState {
  const count = overlapEntries(state).length;
  return { ...state, overlapChecked: toggleChecked(state.overlapChecked, index, count) };
}

/** Set the Overlap ticked set outright; this is what All / None calls. */
export function setOverlapChecked(state: ShellState, indices: number[]): ShellState {
  const count = overlapEntries(state).length;
  return { ...state, overlapChecked: normalizeChecked(indices, count) };
}

/**
 * The Calculate lines currently ticked, in list order.
 *
 * List order rather than click order, because the bulk actions append to
 * another mode's list and arriving in the order you happened to tick them in
 * would scramble a roster someone had deliberately arranged.
 */
export function checkedCalculateEntries(state: ShellState): string[] {
  const entries = calculateEntries(state);
  return normalizeChecked(state.calculateChecked, entries.length).map(
    (i) => entries[i] as string
  );
}

/** The Overlap lines currently ticked, in list order. */
export function checkedOverlapEntries(state: ShellState): string[] {
  const entries = overlapEntries(state);
  return normalizeChecked(state.overlapChecked, entries.length).map((i) => entries[i] as string);
}

/**
 * Swap the Overlap roster for the raw textarea, or back.
 *
 * Both directions clear the focus filter, the ticked set and any in-flight
 * inline edit, because all three are entry indices and free-text editing can
 * move or delete the line underneath them. Leaving text mode also normalizes
 * the field, which is what keeps entry index and parse line number aligned for
 * the roster on the way back in.
 */
export function toggleOverlapEditText(state: ShellState): ShellState {
  const cleared = {
    overlapSelected: null,
    overlapChecked: [] as number[],
    overlapEditing: null,
    overlapEditDraft: "",
    overlapEditError: "",
  };
  if (state.overlapEditText) {
    return {
      ...state,
      ...cleared,
      overlapEditText: false,
      overlapInput: overlapEntries(state).join("\n"),
    };
  }
  return {
    ...state,
    ...cleared,
    overlapEditText: true,
    overlapDraft: "",
    overlapDraftError: "",
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
