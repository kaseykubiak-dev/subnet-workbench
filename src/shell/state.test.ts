import { describe, expect, it } from "vitest";

import {
  addToOverlap,
  effectiveSplitTarget,
  heldSubnetCount,
  initialState,
  sendToVendor,
  setMode,
  useAsVlsmSupernet,
} from "./state";
import { clearCurrentMode } from "./app";

describe("setMode", () => {
  it("switches mode and keeps every input", () => {
    const s = setMode({ ...initialState, calculateInput: "10.0.0.0/24" }, "vlsm");
    expect(s.mode).toBe("vlsm");
    expect(s.calculateInput).toBe("10.0.0.0/24");
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
});
