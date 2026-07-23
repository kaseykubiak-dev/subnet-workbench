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
import type { Mode, ShellState } from "./state";
import {
  addToOverlap,
  commitCalculateDraft,
  effectiveSplitTarget,
  initialState,
  removeCalculateEntry,
  selectCalculateEntry,
  selectedCalculateSubnet,
  sendToVendor,
  setMode,
  useAsVlsmSupernet,
} from "./state";
import { decodeShare, shareUrl } from "./share";
import { handoffLine, renderFooter, renderOutput, renderShell } from "./view";
import type { VendorId } from "../vendor/templates";

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

  /** After a full rerender, put focus back in the add-subnet box. */
  const refocusDraft = (): void => {
    const box = root.querySelector<HTMLTextAreaElement>('[data-field="calculateDraft"]');
    if (box !== null) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
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
    if (el instanceof HTMLTextAreaElement && field === "calculateDraft") {
      // Draft typing never re-renders: the output tracks committed entries.
      state = { ...state, calculateDraft: el.value };
      return;
    }
    if (
      el instanceof HTMLTextAreaElement &&
      (field === "overlapInput" ||
        field === "vlsmSupernetInput" ||
        field === "vlsmRequirementsInput" ||
        field === "vendorInput")
    ) {
      state = { ...state, [field]: el.value };
      rerenderResults();
    }
  });

  root.addEventListener("keydown", (event) => {
    const el = event.target;
    if (
      el instanceof HTMLTextAreaElement &&
      el.dataset["field"] === "calculateDraft" &&
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      state = commitCalculateDraft(state);
      rerenderFull();
      refocusDraft();
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
      case "commit-draft":
        state = commitCalculateDraft(state);
        rerenderFull();
        refocusDraft();
        break;
      case "select-entry":
        state = selectCalculateEntry(state, Number(el.dataset["index"]));
        rerenderFull();
        break;
      case "remove-entry":
        state = removeCalculateEntry(state, Number(el.dataset["index"]));
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
      case "overlap-to-vendor": {
        for (const s of parseSubnetList(state.overlapInput).subnets) {
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
        splitTarget: null,
      };
    case "overlap":
      return { ...state, overlapInput: "" };
    case "vlsm":
      return {
        ...state,
        vlsmSupernetInput: "",
        vlsmRequirementsInput: "",
        vlsmHeadroom: 0,
      };
    case "vendor":
      return { ...state, vendorInput: "" };
  }
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
