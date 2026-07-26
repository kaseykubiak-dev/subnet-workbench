import { describe, expect, it } from "vitest";

import {
  addToOverlap,
  aksPlanFor,
  calculateEntries,
  commitCalculateDraft,
  effectiveSplitTarget,
  eksPlanFor,
  heldSubnetCount,
  initialState,
  isCloudMode,
  removeCalculateEntry,
  selectCalculateEntry,
  selectedCalculateSubnet,
  sendToVendor,
  setMode,
  setPlatform,
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
