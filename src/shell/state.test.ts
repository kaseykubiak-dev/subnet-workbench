import { describe, expect, it } from "vitest";

import {
  addToOverlap,
  aksPlanFor,
  beginEditCalculateEntry,
  beginEditOverlapEntry,
  calculateEntries,
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
  eksPlanFor,
  heldSubnetCount,
  initialState,
  isCloudMode,
  overlapEntries,
  overlapSource,
  removeCalculateEntries,
  removeCalculateEntry,
  removeOverlapEntries,
  selectCalculateEntry,
  selectOverlapEntry,
  selectedCalculateSubnet,
  sendToVendor,
  setCalculateChecked,
  setMode,
  setOverlapChecked,
  setPlatform,
  toggleCalculateChecked,
  toggleOverlapChecked,
  toggleOverlapEditText,
  updateCalculateEditDraft,
  updateOverlapEditDraft,
  useAsVlsmSupernet,
} from "./state";
import { clearCurrentMode } from "./app";

describe("commitCalculateDraft", () => {
  it("moves valid lines into the entry list and selects the last one", () => {
    const s = commitCalculateDraft({
      ...initialState,
      calculateDraft: "Mgmt: 10.10.0.0/24\nLab: 192.168.1.0/26",
    });
    expect(calculateEntries(s)).toEqual([
      "Mgmt: 10.10.0.0/24",
      "Lab: 192.168.1.0/26",
    ]);
    expect(s.calculateSelected).toBe(1);
    expect(s.calculateDraft).toBe("");
    expect(s.calculateDraftError).toBe("");
  });

  it("keeps invalid lines in the draft with an error", () => {
    const s = commitCalculateDraft({
      ...initialState,
      calculateDraft: "banana\n10.0.0.0/24",
    });
    expect(calculateEntries(s)).toEqual(["10.0.0.0/24"]);
    expect(s.calculateDraft).toBe("banana");
    expect(s.calculateDraftError).toContain("banana");
  });

  it("dedupes against existing entries and selects the original", () => {
    const s = commitCalculateDraft({
      ...initialState,
      calculateInput: "10.0.0.0/24\n10.1.0.0/24",
      calculateSelected: 1,
      calculateDraft: "10.0.0.0/24",
    });
    expect(calculateEntries(s)).toEqual(["10.0.0.0/24", "10.1.0.0/24"]);
    expect(s.calculateSelected).toBe(0);
  });

  it("is a no-op on an empty draft", () => {
    const s = commitCalculateDraft({ ...initialState, calculateDraft: "  " });
    expect(s).toEqual({ ...initialState, calculateDraft: "  " });
  });
});

describe("selectCalculateEntry / selectedCalculateSubnet", () => {
  const base = {
    ...initialState,
    calculateInput: "A: 10.0.0.0/24\nB: 10.1.0.0/25",
  };

  it("selects within bounds and clamps outside them", () => {
    expect(selectCalculateEntry(base, 1).calculateSelected).toBe(1);
    expect(selectCalculateEntry(base, 99).calculateSelected).toBe(1);
    expect(selectCalculateEntry(base, -3).calculateSelected).toBe(0);
  });

  it("resolves the selected subnet", () => {
    const s = selectCalculateEntry(base, 1);
    expect(selectedCalculateSubnet(s)?.prefix).toBe(25);
    expect(selectedCalculateSubnet(initialState)).toBeUndefined();
  });
});

describe("removeCalculateEntry", () => {
  const base = {
    ...initialState,
    calculateInput: "A: 10.0.0.0/24\nB: 10.1.0.0/24\nC: 10.2.0.0/24",
    calculateSelected: 1,
  };

  it("removes the entry and shifts selection left when needed", () => {
    const s = removeCalculateEntry(base, 0);
    expect(calculateEntries(s)).toEqual(["B: 10.1.0.0/24", "C: 10.2.0.0/24"]);
    expect(s.calculateSelected).toBe(0);
  });

  it("keeps selection stable when removing after it", () => {
    const s = removeCalculateEntry(base, 2);
    expect(s.calculateSelected).toBe(1);
  });

  it("clamps selection when removing the selected last entry", () => {
    const s = removeCalculateEntry({ ...base, calculateSelected: 2 }, 2);
    expect(s.calculateSelected).toBe(1);
  });

  it("ignores out-of-range indexes", () => {
    expect(removeCalculateEntry(base, 9)).toEqual(base);
  });
});

describe("commitOverlapDraft", () => {
  it("moves valid lines into the entry list", () => {
    const s = commitOverlapDraft({
      ...initialState,
      overlapDraft: "Knoxville: 10.10.0.0/16\nNashville: 10.10.32.0/20",
    });
    expect(overlapEntries(s)).toEqual([
      "Knoxville: 10.10.0.0/16",
      "Nashville: 10.10.32.0/20",
    ]);
    expect(s.overlapDraft).toBe("");
    expect(s.overlapDraftError).toBe("");
  });

  it("keeps bad lines in the draft with their reason", () => {
    const s = commitOverlapDraft({
      ...initialState,
      overlapDraft: "10.0.0.0/24\nnot-a-subnet",
    });
    expect(overlapEntries(s)).toEqual(["10.0.0.0/24"]);
    expect(s.overlapDraft).toBe("not-a-subnet");
    expect(s.overlapDraftError).toMatch(/not-a-subnet/);
  });

  it("dedupes against what is already committed", () => {
    const s = commitOverlapDraft({
      ...initialState,
      overlapInput: "10.0.0.0/24",
      overlapDraft: "10.0.0.0/24",
    });
    expect(overlapEntries(s)).toEqual(["10.0.0.0/24"]);
  });

  it("is a no-op on a blank draft", () => {
    const before = { ...initialState, overlapInput: "10.0.0.0/24", overlapSelected: 0 };
    expect(commitOverlapDraft(before)).toBe(before);
  });

  it("clears the focus filter so the new subnet is checked against everything", () => {
    const s = commitOverlapDraft({
      ...initialState,
      overlapInput: "A: 10.0.0.0/24\nB: 10.0.1.0/24",
      overlapSelected: 1,
      overlapDraft: "C: 10.0.2.0/24",
    });
    expect(s.overlapSelected).toBeNull();
  });
});

describe("selectOverlapEntry / clearOverlapFilter", () => {
  const base = { ...initialState, overlapInput: "A: 10.0.0.0/24\nB: 10.0.1.0/24" };

  it("focuses a row", () => {
    expect(selectOverlapEntry(base, 1).overlapSelected).toBe(1);
  });

  it("clicking the focused row again clears the filter", () => {
    const focused = selectOverlapEntry(base, 1);
    expect(selectOverlapEntry(focused, 1).overlapSelected).toBeNull();
  });

  it("ignores an index nobody holds", () => {
    expect(selectOverlapEntry(base, 5)).toBe(base);
    expect(selectOverlapEntry(base, -1)).toBe(base);
  });

  it("clearOverlapFilter drops the filter outright", () => {
    expect(clearOverlapFilter(selectOverlapEntry(base, 0)).overlapSelected).toBeNull();
  });
});

describe("removeOverlapEntries", () => {
  const base = {
    ...initialState,
    overlapInput: ["A: 10.0.0.0/24", "B: 10.0.1.0/24", "C: 10.0.2.0/24", "D: 10.0.3.0/24"].join("\n"),
  };

  it("removes a single entry", () => {
    const s = removeOverlapEntries(base, [1]);
    expect(overlapEntries(s)).toEqual(["A: 10.0.0.0/24", "C: 10.0.2.0/24", "D: 10.0.3.0/24"]);
  });

  it("removes both sides of a conflict against the pre-cut indices", () => {
    const s = removeOverlapEntries(base, [1, 3]);
    expect(overlapEntries(s)).toEqual(["A: 10.0.0.0/24", "C: 10.0.2.0/24"]);
  });

  it("shifts the focus down past what was cut above it", () => {
    const s = removeOverlapEntries({ ...base, overlapSelected: 3 }, [0, 1]);
    expect(s.overlapSelected).toBe(1);
  });

  it("drops the focus when the focused row is one of the ones removed", () => {
    const s = removeOverlapEntries({ ...base, overlapSelected: 2 }, [2, 3]);
    expect(s.overlapSelected).toBeNull();
  });

  it("leaves a focus above the cut alone", () => {
    const s = removeOverlapEntries({ ...base, overlapSelected: 0 }, [2]);
    expect(s.overlapSelected).toBe(0);
  });

  it("ignores out-of-range and duplicate indices", () => {
    expect(removeOverlapEntries(base, [9, -1])).toBe(base);
    expect(overlapEntries(removeOverlapEntries(base, [1, 1]))).toHaveLength(3);
  });
});

describe("toggleOverlapEditText / overlapSource", () => {
  it("roster mode parses the normalized entry join", () => {
    const s = { ...initialState, overlapInput: "  A: 10.0.0.0/24  \n\n B: 10.0.1.0/24 " };
    expect(overlapSource(s)).toBe("A: 10.0.0.0/24\nB: 10.0.1.0/24");
  });

  it("text mode parses the raw field so error line numbers match the textarea", () => {
    const s = { ...initialState, overlapEditText: true, overlapInput: "A: 10.0.0.0/24\n\nbad" };
    expect(overlapSource(s)).toBe("A: 10.0.0.0/24\n\nbad");
  });

  it("entering text mode drops the filter and the draft", () => {
    const s = toggleOverlapEditText({
      ...initialState,
      overlapInput: "A: 10.0.0.0/24",
      overlapSelected: 0,
      overlapDraft: "half-typed",
      overlapDraftError: "half-typed —> nope",
    });
    expect(s.overlapEditText).toBe(true);
    expect(s.overlapSelected).toBeNull();
    expect(s.overlapDraft).toBe("");
    expect(s.overlapDraftError).toBe("");
  });

  it("leaving text mode normalizes the field losslessly", () => {
    const s = toggleOverlapEditText({
      ...initialState,
      overlapEditText: true,
      overlapInput: "\n  A: 10.0.0.0/24\n\n  B: 10.0.1.0/24  \n",
    });
    expect(s.overlapEditText).toBe(false);
    expect(s.overlapInput).toBe("A: 10.0.0.0/24\nB: 10.0.1.0/24");
  });

  it("round-trips the entries either way", () => {
    const before = { ...initialState, overlapInput: "A: 10.0.0.0/24\nB: 10.0.1.0/24" };
    const after = toggleOverlapEditText(toggleOverlapEditText(before));
    expect(after.overlapInput).toBe(before.overlapInput);
    expect(after.overlapEditText).toBe(false);
  });
});

const FOUR = ["A: 10.0.0.0/24", "B: 10.0.1.0/24", "C: 10.0.2.0/24", "D: 10.0.3.0/24"].join("\n");

describe("inline entry editing", () => {
  const calc = { ...initialState, calculateInput: FOUR };
  const over = { ...initialState, overlapInput: FOUR };

  it("opens on the row's current text", () => {
    const s = beginEditCalculateEntry(calc, 2);
    expect(s.calculateEditing).toBe(2);
    expect(s.calculateEditDraft).toBe("C: 10.0.2.0/24");
    expect(s.calculateEditError).toBe("");
  });

  it("refuses to open on a row that is not there", () => {
    expect(beginEditCalculateEntry(calc, 9)).toBe(calc);
    expect(beginEditOverlapEntry(over, -1)).toBe(over);
  });

  it("moves the Calculate selection to the row under edit", () => {
    expect(beginEditCalculateEntry({ ...calc, calculateSelected: 0 }, 3).calculateSelected).toBe(3);
  });

  it("leaves the Overlap filter alone, because it narrows rather than names", () => {
    const s = beginEditOverlapEntry({ ...over, overlapSelected: 1 }, 3);
    expect(s.overlapSelected).toBe(1);
    expect(s.overlapEditing).toBe(3);
  });

  it("writes the edited line back in place and closes", () => {
    let s = beginEditCalculateEntry(calc, 1);
    s = updateCalculateEditDraft(s, "  B2: 10.9.0.0/22  ");
    s = commitCalculateEditEntry(s);
    expect(calculateEntries(s)[1]).toBe("B2: 10.9.0.0/22");
    expect(calculateEntries(s)).toHaveLength(4);
    expect(s.calculateEditing).toBeNull();
    expect(s.calculateEditDraft).toBe("");
  });

  it("holds the row open with the reason when the line no longer parses", () => {
    let s = beginEditOverlapEntry(over, 0);
    s = updateOverlapEditDraft(s, "banana");
    s = commitOverlapEditEntry(s);
    expect(s.overlapEditing).toBe(0);
    expect(s.overlapEditError).toContain("banana");
    expect(overlapEntries(s)[0]).toBe("A: 10.0.0.0/24");
  });

  it("treats an emptied field as an error, never as a deletion", () => {
    let s = beginEditCalculateEntry(calc, 0);
    s = updateCalculateEditDraft(s, "   ");
    s = commitCalculateEditEntry(s);
    expect(calculateEntries(s)).toHaveLength(4);
    expect(s.calculateEditError).toContain("cannot be empty");
  });

  it("refuses a multi-line paste rather than renumbering the list", () => {
    let s = beginEditCalculateEntry(calc, 0);
    s = updateCalculateEditDraft(s, "X: 10.5.0.0/24\nY: 10.6.0.0/24");
    s = commitCalculateEditEntry(s);
    expect(calculateEntries(s)).toHaveLength(4);
    expect(s.calculateEditError).toContain("One subnet per entry");
  });

  it("allows an edit into a duplicate, which is the conflict Overlap reports", () => {
    let s = beginEditOverlapEntry(over, 1);
    s = updateOverlapEditDraft(s, "B: 10.0.0.0/24");
    s = commitOverlapEditEntry(s);
    expect(s.overlapEditing).toBeNull();
    expect(overlapEntries(s)[1]).toBe("B: 10.0.0.0/24");
  });

  it("clears a stale error the moment the user types again", () => {
    let s = beginEditOverlapEntry(over, 0);
    s = commitOverlapEditEntry(updateOverlapEditDraft(s, "nope"));
    expect(s.overlapEditError).not.toBe("");
    expect(updateOverlapEditDraft(s, "n").overlapEditError).toBe("");
  });

  it("backs out unchanged on cancel", () => {
    let s = beginEditCalculateEntry(calc, 2);
    s = cancelCalculateEditEntry(updateCalculateEditDraft(s, "wrecked"));
    expect(s.calculateInput).toBe(FOUR);
    expect(s.calculateEditing).toBeNull();
    expect(s.calculateEditDraft).toBe("");
  });

  it("ignores commit, update and cancel when nothing is being edited", () => {
    expect(commitCalculateEditEntry(calc)).toBe(calc);
    expect(cancelOverlapEditEntry(over)).toBe(over);
    expect(updateOverlapEditDraft(over, "x")).toBe(over);
  });

  it("abandons an in-flight edit when the list is restructured under it", () => {
    const s = removeCalculateEntries(beginEditCalculateEntry(calc, 3), [0]);
    expect(s.calculateEditing).toBeNull();
    expect(s.calculateEditDraft).toBe("");
  });
});

describe("the ticked set", () => {
  const calc = { ...initialState, calculateInput: FOUR };
  const over = { ...initialState, overlapInput: FOUR };

  it("ticks and unticks one row at a time, kept in list order", () => {
    let s = toggleCalculateChecked(calc, 2);
    s = toggleCalculateChecked(s, 0);
    expect(s.calculateChecked).toEqual([0, 2]);
    expect(toggleCalculateChecked(s, 0).calculateChecked).toEqual([2]);
  });

  it("stays independent of which row is selected", () => {
    const s = toggleCalculateChecked({ ...calc, calculateSelected: 3 }, 1);
    expect(s.calculateSelected).toBe(3);
    expect(s.calculateChecked).toEqual([1]);
  });

  it("stays independent of the Overlap focus filter", () => {
    const s = toggleOverlapChecked({ ...over, overlapSelected: 0 }, 2);
    expect(s.overlapSelected).toBe(0);
    expect(s.overlapChecked).toEqual([2]);
  });

  it("ignores rows the list does not hold", () => {
    expect(toggleCalculateChecked(calc, 9).calculateChecked).toEqual([]);
    expect(toggleOverlapChecked(over, -1).overlapChecked).toEqual([]);
  });

  it("sets the whole set at once for All and None", () => {
    expect(setCalculateChecked(calc, [0, 1, 2, 3]).calculateChecked).toEqual([0, 1, 2, 3]);
    expect(setOverlapChecked(over, []).overlapChecked).toEqual([]);
  });

  it("scrubs duplicates and out-of-range indices out of a set", () => {
    expect(setCalculateChecked(calc, [3, 1, 1, 9, -2]).calculateChecked).toEqual([1, 3]);
  });

  it("hands back the ticked lines in list order, not click order", () => {
    const s = setOverlapChecked(over, [3, 0]);
    expect(checkedOverlapEntries(s)).toEqual(["A: 10.0.0.0/24", "D: 10.0.3.0/24"]);
  });

  it("hands back nothing when nothing is ticked", () => {
    expect(checkedCalculateEntries(calc)).toEqual([]);
  });

  it("renumbers the surviving ticks across a removal", () => {
    const s = removeCalculateEntries(setCalculateChecked(calc, [1, 3]), [0]);
    expect(s.calculateChecked).toEqual([0, 2]);
    expect(checkedCalculateEntries(s)).toEqual(["B: 10.0.1.0/24", "D: 10.0.3.0/24"]);
  });

  it("drops ticks whose rows were the ones removed", () => {
    const s = removeOverlapEntries(setOverlapChecked(over, [0, 2]), [0, 2]);
    expect(s.overlapChecked).toEqual([]);
    expect(overlapEntries(s)).toEqual(["B: 10.0.1.0/24", "D: 10.0.3.0/24"]);
  });

  it("is wiped by the edit-as-text toggle, where indices stop meaning anything", () => {
    const s = toggleOverlapEditText(
      beginEditOverlapEntry(setOverlapChecked(over, [0, 1]), 1)
    );
    expect(s.overlapChecked).toEqual([]);
    expect(s.overlapEditing).toBeNull();
    expect(s.overlapEditDraft).toBe("");
  });
});

describe("removeCalculateEntries", () => {
  const base = { ...initialState, calculateInput: FOUR };

  it("removes a ticked set against the pre-cut indices", () => {
    const s = removeCalculateEntries(base, [1, 3]);
    expect(calculateEntries(s)).toEqual(["A: 10.0.0.0/24", "C: 10.0.2.0/24"]);
  });

  it("pulls the selection down past what was cut above it", () => {
    expect(removeCalculateEntries({ ...base, calculateSelected: 3 }, [0, 1]).calculateSelected).toBe(1);
  });

  it("clamps a selection that fell off the end of a shortened list", () => {
    expect(removeCalculateEntries({ ...base, calculateSelected: 3 }, [3]).calculateSelected).toBe(2);
  });

  it("ignores out-of-range and duplicate indices", () => {
    expect(removeCalculateEntries(base, [9, -1])).toBe(base);
    expect(calculateEntries(removeCalculateEntries(base, [2, 2]))).toHaveLength(3);
  });
});

describe("setMode", () => {
  it("switches mode and keeps every input", () => {
    const s = setMode({ ...initialState, calculateInput: "10.0.0.0/24" }, "vlsm");
    expect(s.mode).toBe("vlsm");
    expect(s.calculateInput).toBe("10.0.0.0/24");
  });

  it("carries the platform across a mode switch", () => {
    expect(setMode({ ...initialState, platform: "azure" }, "vlsm").platform).toBe("azure");
  });
});

describe("setPlatform", () => {
  it("defaults to on-prem so nothing changes until you ask", () => {
    expect(initialState.platform).toBe("none");
    expect(isCloudMode(initialState)).toBe(false);
  });

  it("switches platform without disturbing the subnets you are holding", () => {
    const before = {
      ...initialState,
      mode: "overlap" as const,
      calculateInput: "10.0.0.0/24",
      overlapInput: "10.1.0.0/24",
    };
    const s = setPlatform(before, "aws");
    expect(s.platform).toBe("aws");
    expect(isCloudMode(s)).toBe(true);
    expect(s.mode).toBe("overlap");
    expect(s.calculateInput).toBe("10.0.0.0/24");
    expect(s.overlapInput).toBe("10.1.0.0/24");
  });

  it("goes back to on-prem cleanly", () => {
    const s = setPlatform(setPlatform(initialState, "azure"), "none");
    expect(isCloudMode(s)).toBe(false);
  });
});

describe("hand-offs", () => {
  it("addToOverlap appends the line and switches mode", () => {
    const s = addToOverlap(
      { ...initialState, overlapInput: "Site A: 10.0.0.0/24" },
      "Site B: 10.1.0.0/24"
    );
    expect(s.mode).toBe("overlap");
    expect(s.overlapInput).toBe("Site A: 10.0.0.0/24\nSite B: 10.1.0.0/24");
  });

  it("addToOverlap never duplicates a held line", () => {
    const once = addToOverlap(initialState, "10.0.0.0/24");
    const twice = addToOverlap(once, "10.0.0.0/24");
    expect(twice.overlapInput).toBe("10.0.0.0/24");
  });

  it("useAsVlsmSupernet replaces the supernet", () => {
    const s = useAsVlsmSupernet(
      { ...initialState, vlsmSupernetInput: "192.168.0.0/16" },
      "10.0.0.0/24"
    );
    expect(s.mode).toBe("vlsm");
    expect(s.vlsmSupernetInput).toBe("10.0.0.0/24");
  });

  it("sendToVendor appends to the vendor list", () => {
    const s = sendToVendor(initialState, "Site A: 10.0.0.0/26");
    expect(s.mode).toBe("vendor");
    expect(s.vendorInput).toBe("Site A: 10.0.0.0/26");
  });
});

describe("heldSubnetCount", () => {
  it("counts unique parsed subnets across list inputs", () => {
    const s = {
      ...initialState,
      overlapInput: "10.0.0.0/24\n10.1.0.0/24",
      vendorInput: "10.0.0.0/24", // duplicate of an overlap entry
    };
    expect(heldSubnetCount(s)).toBe(2);
  });

  it("ignores unparseable lines", () => {
    expect(heldSubnetCount({ ...initialState, overlapInput: "banana" })).toBe(0);
  });

  it("is zero at the initial state", () => {
    expect(heldSubnetCount(initialState)).toBe(0);
  });
});

describe("effectiveSplitTarget", () => {
  it("defaults to prefix+2", () => {
    expect(effectiveSplitTarget(initialState, 24)).toBe(26);
  });

  it("caps the default at /32", () => {
    expect(effectiveSplitTarget(initialState, 31)).toBe(32);
  });

  it("clamps a stale target below the new prefix", () => {
    expect(effectiveSplitTarget({ ...initialState, splitTarget: 20 }, 24)).toBe(24);
  });

  it("honors an explicit in-range target", () => {
    expect(effectiveSplitTarget({ ...initialState, splitTarget: 28 }, 24)).toBe(28);
  });
});

describe("clearCurrentMode", () => {
  const populated = {
    ...initialState,
    calculateInput: "10.0.0.0/24",
    splitTarget: 28,
    overlapInput: "10.0.0.0/24",
    vlsmSupernetInput: "10.0.0.0/16",
    vlsmRequirementsInput: "A, 100",
    vlsmHeadroom: 30,
    planInput: "vnet hub 10.0.0.0/22",
    vendorInput: "10.0.0.0/24",
  };

  it("clears only the active mode's inputs", () => {
    const s = clearCurrentMode({ ...populated, mode: "overlap" });
    expect(s.overlapInput).toBe("");
    expect(s.calculateInput).toBe("10.0.0.0/24");
    expect(s.vendorInput).toBe("10.0.0.0/24");
  });

  it("resets the slider with calculate", () => {
    const s = clearCurrentMode({ ...populated, mode: "calculate" });
    expect(s.calculateInput).toBe("");
    expect(s.splitTarget).toBeNull();
  });

  it("resets headroom with vlsm", () => {
    const s = clearCurrentMode({ ...populated, mode: "vlsm" });
    expect(s.vlsmSupernetInput).toBe("");
    expect(s.vlsmRequirementsInput).toBe("");
    expect(s.vlsmHeadroom).toBe(0);
  });

  it("returns capacity to the worked examples rather than to zero", () => {
    const s = clearCurrentMode({
      ...populated,
      mode: "capacity",
      aksMode: "kubenet",
      aksNodes: 999,
      aksMaxPods: 7,
      eksNodes: 4,
      eksCustomNetworking: true,
    });
    expect(s.aksMode).toBe(initialState.aksMode);
    expect(s.aksNodes).toBe(initialState.aksNodes);
    expect(s.aksMaxPods).toBeNull();
    expect(s.eksNodes).toBe(initialState.eksNodes);
    expect(s.eksCustomNetworking).toBe(false);
    // Still mode-local: the other modes' text is untouched.
    expect(s.overlapInput).toBe("10.0.0.0/24");
  });

  it("blanks the plan text and nothing else", () => {
    const s = clearCurrentMode({ ...populated, mode: "plan" });
    expect(s.planInput).toBe("");
    expect(s.overlapInput).toBe("10.0.0.0/24");
  });
});

describe("aksPlanFor", () => {
  it("carries the state through when every field is already legal", () => {
    const plan = aksPlanFor({ ...initialState, aksNodes: 50, aksMaxSurge: 1 });
    expect(plan).toEqual({ mode: "azure-cni-node-subnet", nodes: 50, maxSurge: 1 });
  });

  it("omits maxPodsPerNode when null, so the mode's own default applies", () => {
    const plan = aksPlanFor({ ...initialState, aksMaxPods: null });
    expect(plan.maxPodsPerNode).toBeUndefined();
    expect("maxPodsPerNode" in plan).toBe(false);
  });

  it("passes an explicit max pods through", () => {
    expect(aksPlanFor({ ...initialState, aksMaxPods: 110 }).maxPodsPerNode).toBe(110);
  });

  it("floors a half-typed fraction rather than letting the estimator throw", () => {
    const plan = aksPlanFor({ ...initialState, aksNodes: 12.9, aksMaxSurge: 2.5 });
    expect(plan.nodes).toBe(12);
    expect(plan.maxSurge).toBe(2);
  });

  it("clamps a negative or NaN box to the floor", () => {
    // Number("") is 0 and Number("-") is NaN; both reach state unclamped.
    const plan = aksPlanFor({ ...initialState, aksNodes: -5, aksMaxSurge: Number.NaN });
    expect(plan.nodes).toBe(0);
    expect(plan.maxSurge).toBe(0);
  });
});

describe("eksPlanFor", () => {
  it("carries the state through when every field is already legal", () => {
    expect(eksPlanFor(initialState)).toEqual({
      mode: "secondary-ip",
      nodes: 20,
      enisPerNode: 3,
      ipsPerEni: 10,
      podsPerNode: 17,
      customNetworking: false,
    });
  });

  it("holds ENIs at one and IPs per ENI at two, the physical minimums", () => {
    // An instance always has one ENI, and an ENI always has its own primary
    // address plus at least one it could hand out; estimateEks throws below that.
    const plan = eksPlanFor({ ...initialState, eksEnisPerNode: 0, eksIpsPerEni: 1 });
    expect(plan.enisPerNode).toBe(1);
    expect(plan.ipsPerEni).toBe(2);
  });

  it("floors fractions and clamps NaN", () => {
    const plan = eksPlanFor({
      ...initialState,
      eksNodes: 6.7,
      eksPodsPerNode: Number.NaN,
      eksIpsPerEni: 15.2,
    });
    expect(plan.nodes).toBe(6);
    expect(plan.podsPerNode).toBe(0);
    expect(plan.ipsPerEni).toBe(15);
  });
});
