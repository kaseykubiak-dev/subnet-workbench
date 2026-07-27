/**
 * Page shell app: mounting and event wiring. The only DOM-aware module.
 *
 * All rendering comes from src/shell/view.ts (pure strings); all state
 * transitions from src/shell/state.ts. Events are delegated from the root:
 * typing re-renders only the output/footer regions so textarea focus is
 * never lost, and the prefix slider updates its visual in place so drags
 * stay smooth.
 */

import { parseSubnetList } from "../engine/parse";
import { allocationCidr, allocateVlsm, parseRequirementList, requirementName } from "../modes/vlsm";
import { renderBitRibbon } from "../visuals/bitRibbon";
import { renderPrefixSplit } from "../visuals/prefixSplit";
import type { CapacityWorkload, Mode, ShellState } from "./state";
import {
  addToOverlap,
  beginEditCalculateEntry,
  beginEditOverlapEntry,
  cancelCalculateEditEntry,
  cancelOverlapEditEntry,
  checkedCalculateEntries,
  checkedOverlapEntries,
  clearOverlapFilter,
  commitCalculateDraft,
  commitCalculateEditEntry,
  commitOverlapDraft,
  commitOverlapEditEntry,
  effectiveSplitTarget,
  initialState,
  overlapSource,
  removeCalculateEntries,
  removeOverlapEntries,
  selectCalculateEntry,
  selectOverlapEntry,
  selectedCalculateSubnet,
  sendToPlan,
  sendToVendor,
  setCalculateChecked,
  setMode,
  setOverlapChecked,
  setPlatform,
  setServiceCount,
  toggleCalculateChecked,
  toggleOverlapChecked,
  toggleOverlapEditText,
  toggleService,
  updateCalculateEditDraft,
  updateOverlapEditDraft,
  useAsVlsmSupernet,
} from "./state";
import { decodeShare, shareUrl } from "./share";
import { renderEditFoot } from "./rosterView";
import { handoffLine, renderFooter, renderOutput, renderShell } from "./view";
import { servicesEstimateFor } from "./servicesView";
import type { AksNetworkMode, EksIpMode } from "../cloud/capacity";
import { servicePlanText } from "../cloud/capacity";
import { ipToNumber, numberToIp } from "../engine/ipv4";
import type { PlatformId } from "../cloud/platforms";
import type { VendorId } from "../vendor/templates";

/**
 * Where a generated services plan is placed before anyone renumbers it.
 *
 * The shape of the tree is real; the base is not. Plan mode is where the
 * overlap checking lives, so arriving there with a valid document at a
 * placeholder base is more useful than refusing to generate one at all.
 */
const SERVICE_PLAN_BASE = ipToNumber("10.0.0.0") ?? 0;

/** Capacity fields that are plain integer boxes with no special empty case. */
const CAPACITY_NUMBER_FIELDS = [
  "aksNodes",
  "aksMaxSurge",
  "eksNodes",
  "eksEnisPerNode",
  "eksIpsPerEni",
  "eksPodsPerNode",
  "sqlMiGeneralPurpose",
  "sqlMiBusinessCritical",
  "sqlMiZoneRedundant",
  "sqlMiVmGroups",
  "appGwMaxInstances",
] as const;

type CapacityNumberField = (typeof CAPACITY_NUMBER_FIELDS)[number];

function isCapacityNumberField(field: string): field is CapacityNumberField {
  return (CAPACITY_NUMBER_FIELDS as readonly string[]).includes(field);
}

export interface MountOptions {
  /** Location fragment to restore state from (opt-in share links). */
  initialHash?: string;
  /** Base URL for "Copy shareable link"; defaults to location without hash. */
  baseUrl?: string;
}

export interface ShellHandle {
  getState: () => ShellState;
}

export function mountShell(root: HTMLElement, options: MountOptions = {}): ShellHandle {
  let state: ShellState = { ...initialState };
  if (options.initialHash !== undefined) {
    const restored = decodeShare(options.initialHash);
    if (restored !== null) state = { ...state, ...restored };
  }

  const rerenderFull = (): void => {
    root.innerHTML = renderShell(state);
  };
  const rerenderResults = (): void => {
    const out = root.querySelector("#swb-output");
    if (out !== null) out.innerHTML = renderOutput(state);
    rerenderFooter();
  };
  const rerenderFooter = (): void => {
    const foot = root.querySelector("#swb-footer");
    if (foot !== null) foot.innerHTML = renderFooter(state);
  };

  /**
   * After a full rerender, put focus and the caret back in a text field.
   *
   * Covers both the add-subnet textareas and the inline entry editors, which
   * are `<input>` rather than `<textarea>`; a full rerender replaces the
   * element either way, so the caret has to be restored by hand.
   */
  const refocusField = (
    field: "calculateDraft" | "overlapDraft" | "calculateEditDraft" | "overlapEditDraft"
  ): void => {
    const box = root.querySelector(`[data-field="${field}"]`);
    if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  };

  /** The bare CIDR of a roster line, label dropped; null when it will not parse. */
  const bareCidr = (line: string): string | null => {
    const s = parseSubnetList(line).subnets[0];
    return s === undefined ? null : `${numberToIp(s.network)}/${s.prefix}`;
  };

  /** Slider drag: swap only the visuals so the slider element survives. */
  const rerenderSplitVisual = (): void => {
    const first = selectedCalculateSubnet(state);
    if (first === undefined) return;
    const target = effectiveSplitTarget(state, first.prefix);
    const ribbon = root.querySelector("#swb-ribbon-visual");
    if (ribbon !== null) {
      ribbon.innerHTML = renderBitRibbon(first.address, first.prefix, target);
    }
    const visual = root.querySelector("#swb-split-visual");
    if (visual !== null) {
      visual.innerHTML = renderPrefixSplit(
        { network: first.network, prefix: first.prefix },
        target
      );
    }
    const val = root.querySelector("#swb-split-val");
    if (val !== null) val.textContent = `/${target}`;
  };

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;

    // The services catalogue is keyed by consumer id rather than by a fixed
    // field name, so it is matched before the data-field dispatch below.
    const serviceId = el.dataset["service"];
    if (serviceId !== undefined && el instanceof HTMLInputElement) {
      // Full rerender: ticking a row reveals its count box and any sub-plan
      // fields, which live in the left column the results rerender skips.
      state = toggleService(state, serviceId);
      rerenderFull();
      return;
    }
    const countId = el.dataset["serviceCount"];
    if (countId !== undefined && el instanceof HTMLInputElement) {
      state = setServiceCount(state, countId, Number(el.value));
      rerenderResults();
      return;
    }

    const field = el.dataset["field"];
    if (field === undefined) return;

    if (field === "splitTarget" && el instanceof HTMLInputElement) {
      state = { ...state, splitTarget: Number(el.value) };
      rerenderSplitVisual();
      return;
    }
    if (field === "vlsmHeadroom" && el instanceof HTMLInputElement) {
      const n = Number(el.value);
      state = { ...state, vlsmHeadroom: Number.isFinite(n) && n >= 0 ? n : 0 };
      rerenderResults();
      return;
    }
    if (field === "vendorId" && el instanceof HTMLSelectElement) {
      state = { ...state, vendorId: el.value as VendorId };
      rerenderResults();
      return;
    }
    if (field === "platform" && el instanceof HTMLSelectElement) {
      // Full rerender: the platform changes the left column too (the fact
      // block), not just the results, and the select survives because it is
      // re-rendered with the new value already selected.
      state = setPlatform(state, el.value as PlatformId);
      rerenderFull();
      return;
    }
    if (isCapacityNumberField(field) && el instanceof HTMLInputElement) {
      // Values stay unclamped in state so a half-typed "" or "-" does not fight
      // the cursor; aksPlanFor / eksPlanFor clamp at the point of use.
      state = { ...state, [field]: Number(el.value) };
      rerenderResults();
      return;
    }
    if (field === "aksMaxPods" && el instanceof HTMLInputElement) {
      // Empty means "the mode's default", which is a real choice rather than
      // zero pods, so it round-trips as null instead of collapsing to a number.
      state = { ...state, aksMaxPods: el.value.trim() === "" ? null : Number(el.value) };
      rerenderResults();
      return;
    }
    if (field === "eksCustomNetworking" && el instanceof HTMLInputElement) {
      state = { ...state, eksCustomNetworking: el.checked };
      rerenderResults();
      return;
    }
    if (field === "appGwPrivateFrontend" && el instanceof HTMLInputElement) {
      state = { ...state, appGwPrivateFrontend: el.checked };
      rerenderResults();
      return;
    }
    if (field === "aksMode" && el instanceof HTMLSelectElement) {
      // Full rerender: the mode changes the max-pods placeholder in the left
      // column, which is the only cue for what an empty box will assume.
      state = { ...state, aksMode: el.value as AksNetworkMode };
      rerenderFull();
      return;
    }
    if (field === "eksMode" && el instanceof HTMLSelectElement) {
      state = { ...state, eksMode: el.value as EksIpMode };
      rerenderResults();
      return;
    }
    if (
      el instanceof HTMLTextAreaElement &&
      (field === "calculateDraft" || field === "overlapDraft")
    ) {
      // Draft typing never re-renders: the output tracks committed entries.
      state = { ...state, [field]: el.value };
      return;
    }
    if (
      el instanceof HTMLInputElement &&
      (field === "calculateEditDraft" || field === "overlapEditDraft")
    ) {
      // Same deal for the inline editors: no rerender, because replacing the
      // input would take the caret with it. But typing does clear a rejected
      // edit's error, and leaving that message sitting under the box while the
      // user fixes it reads as though the fix has not registered. So the one
      // line that changed is swapped in place instead.
      const calc = field === "calculateEditDraft";
      const had = calc ? state.calculateEditError : state.overlapEditError;
      state = calc
        ? updateCalculateEditDraft(state, el.value)
        : updateOverlapEditDraft(state, el.value);
      if (had !== "") {
        const foot = root.querySelector(".swb-entry-foot");
        if (foot !== null) foot.outerHTML = renderEditFoot("");
      }
      return;
    }
    if (
      el instanceof HTMLTextAreaElement &&
      (field === "overlapInput" ||
        field === "vlsmSupernetInput" ||
        field === "vlsmRequirementsInput" ||
        field === "planInput" ||
        field === "vendorInput")
    ) {
      state = { ...state, [field]: el.value };
      rerenderResults();
    }
  });

  root.addEventListener("keydown", (event) => {
    const el = event.target;

    // The inline entry editors are <input>, so they are matched before the
    // textarea guard below rather than after it.
    if (el instanceof HTMLInputElement) {
      const field = el.dataset["field"];
      if (field !== "calculateEditDraft" && field !== "overlapEditDraft") return;
      const calc = field === "calculateEditDraft";
      if (event.key === "Enter") {
        event.preventDefault();
        state = calc ? commitCalculateEditEntry(state) : commitOverlapEditEntry(state);
        rerenderFull();
        // A rejected edit keeps its row open with the reason attached, so the
        // caret goes back into the box the user is about to fix.
        const stillOpen = calc ? state.calculateEditing : state.overlapEditing;
        if (stillOpen !== null) refocusField(field);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        state = calc ? cancelCalculateEditEntry(state) : cancelOverlapEditEntry(state);
        rerenderFull();
      }
      return;
    }

    if (!(el instanceof HTMLTextAreaElement)) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    const field = el.dataset["field"];
    if (field === "calculateDraft") {
      event.preventDefault();
      state = commitCalculateDraft(state);
      rerenderFull();
      refocusField("calculateDraft");
      return;
    }
    if (field === "overlapDraft") {
      event.preventDefault();
      state = commitOverlapDraft(state);
      rerenderFull();
      refocusField("overlapDraft");
    }
  });

  root.addEventListener("click", (event) => {
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (el === null || el === undefined) return;
    const action = el.dataset["action"];
    const line = el.dataset["line"] ?? "";

    switch (action) {
      case "set-mode":
        state = setMode(state, el.dataset["mode"] as Mode);
        rerenderFull();
        break;
      case "clear-mode":
        state = clearCurrentMode(state);
        rerenderFull();
        break;
      case "set-workload":
        state = {
          ...state,
          capacityWorkload: el.dataset["workload"] as CapacityWorkload,
        };
        rerenderFull();
        break;
      case "handoff-plan": {
        const text = servicePlanText(servicesEstimateFor(state), SERVICE_PLAN_BASE);
        state = sendToPlan(state, text);
        rerenderFull();
        break;
      }
      case "commit-draft":
        state = commitCalculateDraft(state);
        rerenderFull();
        refocusField("calculateDraft");
        break;
      case "select-entry":
        state = selectCalculateEntry(state, Number(el.dataset["index"]));
        rerenderFull();
        break;
      case "toggle-entry-check":
        state = toggleCalculateChecked(state, Number(el.dataset["index"]));
        rerenderFull();
        break;
      case "set-entry-checks":
        // "All" carries every index, "None" carries an empty attribute.
        state = setCalculateChecked(state, parseIndexList(el.dataset["indices"]));
        rerenderFull();
        break;
      case "edit-entry":
        state = beginEditCalculateEntry(state, Number(el.dataset["index"]));
        rerenderFull();
        refocusField("calculateEditDraft");
        break;
      case "commit-entry-edit":
        state = commitCalculateEditEntry(state);
        rerenderFull();
        if (state.calculateEditing !== null) refocusField("calculateEditDraft");
        break;
      case "cancel-entry-edit":
        state = cancelCalculateEditEntry(state);
        rerenderFull();
        break;
      case "remove-entry":
        state = removeCalculateEntries(state, parseIndexList(el.dataset["indices"]));
        rerenderFull();
        break;
      case "commit-overlap-draft":
        state = commitOverlapDraft(state);
        rerenderFull();
        refocusField("overlapDraft");
        break;
      case "select-overlap-entry":
        state = selectOverlapEntry(state, Number(el.dataset["index"]));
        rerenderFull();
        break;
      case "toggle-overlap-check":
        state = toggleOverlapChecked(state, Number(el.dataset["index"]));
        rerenderFull();
        break;
      case "set-overlap-checks":
        state = setOverlapChecked(state, parseIndexList(el.dataset["indices"]));
        rerenderFull();
        break;
      case "edit-overlap-entry":
        state = beginEditOverlapEntry(state, Number(el.dataset["index"]));
        rerenderFull();
        refocusField("overlapEditDraft");
        break;
      case "commit-overlap-edit":
        state = commitOverlapEditEntry(state);
        rerenderFull();
        if (state.overlapEditing !== null) refocusField("overlapEditDraft");
        break;
      case "cancel-overlap-edit":
        state = cancelOverlapEditEntry(state);
        rerenderFull();
        break;
      case "clear-overlap-filter":
        state = clearOverlapFilter(state);
        rerenderFull();
        break;
      case "remove-overlap-entry":
        // Both the single "x" and the "remove both sides" button land here;
        // the only difference is how many indices the row carried.
        state = removeOverlapEntries(state, parseIndexList(el.dataset["indices"]));
        rerenderFull();
        break;
      case "toggle-overlap-text":
        state = toggleOverlapEditText(state);
        rerenderFull();
        break;
      case "handoff-overlap":
        state = addToOverlap(state, line);
        rerenderFull();
        break;
      case "handoff-vlsm":
        state = useAsVlsmSupernet(state, line);
        rerenderFull();
        break;
      case "handoff-vendor":
        state = sendToVendor(state, line);
        rerenderFull();
        break;
      // The bulk bar is the ticked set's version of the per-result handoff
      // buttons. Each one folds the same single-line transition over every
      // ticked row, then empties the ticks: the hand-off is done, and leaving
      // them lit invites doing it a second time on the way back.
      case "bulk-overlap": {
        for (const l of checkedCalculateEntries(state)) state = addToOverlap(state, l);
        state = setCalculateChecked(state, []);
        rerenderFull();
        break;
      }
      case "bulk-vendor": {
        for (const l of checkedCalculateEntries(state)) state = sendToVendor(state, l);
        state = setCalculateChecked(state, []);
        rerenderFull();
        break;
      }
      case "bulk-vlsm": {
        // VLSM takes one supernet, which is why the button is disabled unless
        // exactly one row is ticked. The label is dropped: the supernet box is
        // asking for an address block, not for the name someone gave it.
        const first = checkedCalculateEntries(state)[0];
        const cidr = first === undefined ? null : bareCidr(first);
        if (cidr !== null) {
          state = useAsVlsmSupernet(state, cidr);
          state = setCalculateChecked(state, []);
          rerenderFull();
        }
        break;
      }
      case "bulk-remove":
        state = removeCalculateEntries(state, state.calculateChecked);
        rerenderFull();
        break;
      case "bulk-overlap-vendor": {
        for (const l of checkedOverlapEntries(state)) state = sendToVendor(state, l);
        state = setOverlapChecked(state, []);
        rerenderFull();
        break;
      }
      case "bulk-overlap-vlsm": {
        const first = checkedOverlapEntries(state)[0];
        const cidr = first === undefined ? null : bareCidr(first);
        if (cidr !== null) {
          state = useAsVlsmSupernet(state, cidr);
          state = setOverlapChecked(state, []);
          rerenderFull();
        }
        break;
      }
      case "bulk-overlap-remove":
        state = removeOverlapEntries(state, state.overlapChecked);
        rerenderFull();
        break;
      case "overlap-to-vendor": {
        for (const s of parseSubnetList(overlapSource(state)).subnets) {
          state = sendToVendor(state, handoffLine(s));
        }
        rerenderFull();
        break;
      }
      case "vlsm-to-vendor": {
        const supernet = parseSubnetList(state.vlsmSupernetInput).subnets[0];
        if (supernet !== undefined) {
          const result = allocateVlsm(
            supernet,
            parseRequirementList(state.vlsmRequirementsInput).requirements,
            { headroomPercent: state.vlsmHeadroom }
          );
          for (const a of result.allocations) {
            state = sendToVendor(
              state,
              `${requirementName(a.requirement)}: ${allocationCidr(a)}`
            );
          }
          rerenderFull();
        }
        break;
      }
      case "copy-share": {
        const base =
          options.baseUrl ??
          window.location.href.replace(window.location.hash, "");
        void copyWithFeedback(el, shareUrl(base, state));
        break;
      }
      case "copy-block": {
        const targetId = el.dataset["copyTarget"];
        if (targetId !== undefined) {
          const block = root.querySelector(`#${targetId}`);
          if (block !== null) {
            void copyWithFeedback(el, block.textContent ?? "");
          }
        }
        break;
      }
      default:
        break;
    }
  });

  rerenderFull();
  return { getState: () => state };
}

/** Clear the active mode's inputs only. */
export function clearCurrentMode(state: ShellState): ShellState {
  switch (state.mode) {
    case "calculate":
      return {
        ...state,
        calculateInput: "",
        calculateSelected: 0,
        calculateDraft: "",
        calculateDraftError: "",
        // Everything index-shaped goes with the list it pointed into.
        calculateEditing: null,
        calculateEditDraft: "",
        calculateEditError: "",
        calculateChecked: [],
        splitTarget: null,
      };
    case "overlap":
      return {
        ...state,
        overlapInput: "",
        overlapSelected: null,
        overlapDraft: "",
        overlapDraftError: "",
        overlapEditing: null,
        overlapEditDraft: "",
        overlapEditError: "",
        overlapChecked: [],
        // The edit-as-text toggle is a view preference rather than content, so
        // clearing the list leaves you in whichever editor you were using.
      };
    case "vlsm":
      return {
        ...state,
        vlsmSupernetInput: "",
        vlsmRequirementsInput: "",
        vlsmHeadroom: 0,
      };
    case "capacity":
      // Reset clears the workload on screen, not both. Someone resetting a
      // half-built services list has no reason to lose the node counts they
      // set up under Kubernetes, and vice versa.
      if (state.capacityWorkload === "services") {
        return {
          ...state,
          serviceCounts: {},
          sqlMiGeneralPurpose: initialState.sqlMiGeneralPurpose,
          sqlMiBusinessCritical: initialState.sqlMiBusinessCritical,
          sqlMiZoneRedundant: initialState.sqlMiZoneRedundant,
          sqlMiVmGroups: initialState.sqlMiVmGroups,
          appGwMaxInstances: initialState.appGwMaxInstances,
          appGwPrivateFrontend: initialState.appGwPrivateFrontend,
        };
      }
      // Kubernetes has no text to blank, so "clear" means back to the
      // documented worked examples rather than back to zero nodes.
      return {
        ...state,
        aksMode: initialState.aksMode,
        aksNodes: initialState.aksNodes,
        aksMaxPods: initialState.aksMaxPods,
        aksMaxSurge: initialState.aksMaxSurge,
        eksMode: initialState.eksMode,
        eksNodes: initialState.eksNodes,
        eksEnisPerNode: initialState.eksEnisPerNode,
        eksIpsPerEni: initialState.eksIpsPerEni,
        eksPodsPerNode: initialState.eksPodsPerNode,
        eksCustomNetworking: initialState.eksCustomNetworking,
      };
    case "plan":
      return { ...state, planInput: "" };
    case "vendor":
      return { ...state, vendorInput: "" };
  }
}

/**
 * Read a `data-indices="0,3"` attribute into entry indices.
 *
 * One attribute carries both the single-row "x" and the "remove both sides"
 * button so the handler does not have to branch on which one was clicked.
 * Anything unparseable is dropped here; `removeOverlapEntries` treats an
 * empty list as a no-op.
 */
function parseIndexList(raw: string | undefined): number[] {
  if (raw === undefined || raw === "") return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n));
}

async function copyWithFeedback(button: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch {
    // Clipboard unavailable (permissions, file://): fall back silently.
  }
}
