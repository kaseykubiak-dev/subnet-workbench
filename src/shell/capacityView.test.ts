import { describe, expect, it } from "vitest";

import {
  CAPACITY_CSS,
  capacityEstimateFor,
  capacitySegments,
  renderCapacityInputs,
  renderCapacityOutput,
} from "./capacityView";
import { initialState } from "./state";
import type { ShellState } from "./state";
import { estimateAks, estimateEks } from "../cloud/capacity";
import { platformById } from "../cloud/platforms";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, ...overrides };
}

const azure = withState({ mode: "capacity", platform: "azure" });
const aws = withState({ mode: "capacity", platform: "aws" });

describe("capacityEstimateFor", () => {
  it("returns nothing on-prem, because there is no reserved set to size against", () => {
    expect(capacityEstimateFor(withState({ mode: "capacity" }))).toBeNull();
  });

  it("runs AKS on Azure and reaches Microsoft's own worked answer", () => {
    // 50 nodes, node subnet, surge 1, default 30 pods: 51 + 1,530 = 1,581 -> /21.
    const estimate = capacityEstimateFor(azure);
    expect(estimate?.addresses).toBe(1581);
    expect(estimate?.prefix).toBe(21);
  });

  it("runs EKS on AWS, which is a different estimator entirely", () => {
    // 20 nodes each holding 3 ENIs x 10 addresses = 600 -> /22.
    const estimate = capacityEstimateFor(aws);
    expect(estimate?.addresses).toBe(600);
    expect(estimate?.prefix).toBe(22);
  });

  it("still answers on an input the estimator would reject outright", () => {
    // estimateEks throws below 2 IPs per ENI rather than guess. The clamp in
    // eksPlanFor is what keeps a half-typed box, or a hostile shared link,
    // from blanking the panel; the try/catch behind it is belt and braces.
    const estimate = capacityEstimateFor(withState({ platform: "aws", eksIpsPerEni: 1 }));
    expect(estimate).not.toBeNull();
    expect(estimate?.prefix).not.toBeNull();
  });
});

describe("capacitySegments", () => {
  it("stacks the AKS breakdown, because its lines really do sum to the total", () => {
    const estimate = estimateAks({ mode: "azure-cni-node-subnet", nodes: 50, maxSurge: 1 });
    const segments = capacitySegments(estimate, platformById("azure"));
    expect(segments.map((s) => s.label)).toEqual([
      "Azure reserved",
      "Node addresses",
      "Pod addresses",
      "Free",
    ]);
    expect(segments.map((s) => s.addresses)).toEqual([5, 51, 1530, 462]);
    // 2,043 usable in a /21, all of it accounted for.
    expect(segments.reduce((t, s) => t + s.addresses, 0)).toBe(2048);
  });

  it("collapses the EKS breakdown, whose lines would double-count if stacked", () => {
    // "Addresses held per node" is 30 and "Cluster total" is 600; stacking both
    // would claim 630 of a 600-address requirement.
    const estimate = estimateEks({
      mode: "secondary-ip",
      nodes: 20,
      enisPerNode: 3,
      ipsPerEni: 10,
      podsPerNode: 17,
    });
    expect(estimate.breakdown).toHaveLength(2);
    const segments = capacitySegments(estimate, platformById("aws"));
    expect(segments.map((s) => s.label)).toEqual([
      "AWS reserved",
      "Addresses required",
      "Free",
    ]);
    expect(segments.map((s) => s.addresses)).toEqual([5, 600, 419]);
  });

  it("keeps a zero Free segment, because no headroom is the useful reading", () => {
    // 2,043 usable in a /21 is exactly what 681 nodes at 3 pods each demands.
    const estimate = estimateAks({
      mode: "azure-cni-node-subnet",
      nodes: 510,
      maxPodsPerNode: 10,
      maxSurge: 0,
    });
    const segments = capacitySegments(estimate, platformById("azure"));
    const free = segments[segments.length - 1];
    expect(free?.kind).toBe("free");
    expect(estimate.addresses).toBe(5610);
    expect(free?.addresses).toBe(8192 - 5 - 5610);
  });

  it("draws nothing when nothing fits", () => {
    // Azure's largest legal subnet is a /2, so overflowing it takes more than
    // a billion addresses. 10M nodes at 250 pods each clears that comfortably.
    const estimate = estimateAks({
      mode: "azure-cni-node-subnet",
      nodes: 10_000_000,
      maxPodsPerNode: 250,
    });
    expect(estimate.prefix).toBeNull();
    expect(capacitySegments(estimate, platformById("azure"))).toEqual([]);
  });
});

describe("renderCapacityInputs", () => {
  it("nudges toward the platform picker rather than guessing a cloud", () => {
    const html = renderCapacityInputs(withState({ mode: "capacity" }));
    expect(html).toContain("swb-cap-nudge");
    expect(html).toContain("Pick Azure or AWS");
    expect(html).not.toContain('data-field="aksNodes"');
    expect(html).not.toContain('data-field="eksNodes"');
  });

  it("shows the AKS fields on Azure and none of the EKS ones", () => {
    const html = renderCapacityInputs(azure);
    expect(html).toContain('data-field="aksMode"');
    expect(html).toContain('data-field="aksNodes"');
    expect(html).toContain('data-field="aksMaxSurge"');
    expect(html).not.toContain('data-field="eksMode"');
  });

  it("shows the EKS fields on AWS and none of the AKS ones", () => {
    const html = renderCapacityInputs(aws);
    expect(html).toContain('data-field="eksMode"');
    expect(html).toContain('data-field="eksEnisPerNode"');
    expect(html).toContain('data-field="eksCustomNetworking"');
    expect(html).not.toContain('data-field="aksMode"');
  });

  it("puts the mode's own default in the max-pods placeholder", () => {
    // Empty means "whatever this mode assumes", and that assumption swings
    // 30 -> 250 across modes, so the box has to say which one is in play.
    expect(renderCapacityInputs(azure)).toContain('placeholder="30"');
    expect(renderCapacityInputs(withState({ platform: "azure", aksMode: "azure-cni-overlay" })))
      .toContain('placeholder="250"');
  });

  it("leaves the max-pods box empty when the state holds null", () => {
    expect(renderCapacityInputs(azure)).toContain('data-field="aksMaxPods" type="number" min="0" placeholder="30" value=""');
  });

  it("checks the custom-networking box only when the flag is set", () => {
    expect(renderCapacityInputs(aws)).not.toContain("checkbox\" data-field=\"eksCustomNetworking\" checked");
    expect(renderCapacityInputs(withState({ platform: "aws", eksCustomNetworking: true })))
      .toContain('data-field="eksCustomNetworking" checked');
  });
});

describe("renderCapacityOutput", () => {
  it("shows a hint on-prem instead of an empty panel", () => {
    const html = renderCapacityOutput(withState({ mode: "capacity" }));
    expect(html).toContain("swb-hint");
    expect(html).toContain("Waiting on a platform.");
    expect(html).not.toContain("swb-cap-bar");
  });

  it("leads with the prefix and the arithmetic behind it", () => {
    const html = renderCapacityOutput(azure);
    expect(html).toContain("/21");
    expect(html).toContain("1,581 addresses needed");
    expect(html).toContain("2,043 usable in a /21");
    expect(html).toContain("462 free");
  });

  it("draws one bar segment per capacity segment", () => {
    const html = renderCapacityOutput(azure);
    expect(html.match(/class="swb-cap-seg /g)).toHaveLength(4);
    expect(html).toContain("swb-cap-res");
    expect(html).toContain("swb-cap-free");
    // Used segments alternate so two adjacent ones stay distinguishable.
    expect(html).toContain("swb-cap-u0");
    expect(html).toContain("swb-cap-u1");
  });

  it("keeps the breakdown table honest about what the total excludes", () => {
    const html = renderCapacityOutput(azure);
    expect(html).toContain("Node addresses");
    expect(html).toContain("Pod addresses");
    expect(html).toContain("swb-cap-total");
    expect(html).toContain("reserved set is added when the prefix is chosen");
  });

  it("surfaces the EKS warm-address warning rather than burying it", () => {
    const html = renderCapacityOutput(aws);
    expect(html).toContain("swb-cap-warn");
    expect(html).toContain("swb-sev-warning");
    expect(html).toContain("Warm addresses are consumed from the subnet even while unused.");
  });

  it("flags an overlay pod CIDR as living outside the VNet", () => {
    const html = renderCapacityOutput(withState({ platform: "azure", aksMode: "azure-cni-overlay" }));
    expect(html).toContain("swb-cap-companion");
    expect(html).toContain("Overlay pod CIDR");
    expect(html).toContain("Outside the VNet");
  });

  it("marks an EKS secondary CIDR as an additional subnet, not an outside one", () => {
    const html = renderCapacityOutput(withState({ platform: "aws", eksCustomNetworking: true }));
    expect(html).toContain("Pod subnet (secondary VPC CIDR)");
    expect(html).toContain("Additional subnet");
    expect(html).not.toContain("Outside the VNet");
  });

  it("costs the same workload under every mode, with the live one marked", () => {
    const html = renderCapacityOutput(azure);
    expect(html).toContain("Same workload, every mode");
    // One prefix readout per card, which is the thing being compared.
    expect(html.match(/class="swb-cap-card-p"/g)).toHaveLength(4);
    expect(html.match(/swb-cap-card-on/g)).toHaveLength(1);
    // Overlay moves the same 50 nodes from a /21 to a much smaller block.
    expect(html).toContain("/26");
  });

  it("compares the two EKS modes on AWS", () => {
    const html = renderCapacityOutput(aws);
    expect(html.match(/class="swb-cap-card-p"/g)).toHaveLength(2);
    expect(html).toContain("Prefix delegation");
  });

  it("says so plainly when nothing fits, and still shows the alternatives", () => {
    const html = renderCapacityOutput(
      withState({ platform: "azure", aksNodes: 10_000_000, aksMaxPods: 250 })
    );
    expect(html).toContain("more than one Azure subnet can hold");
    expect(html).not.toContain("swb-cap-bar");
    expect(html).toContain("Same workload, every mode");
  });

  it("separates thousands so large clusters stay readable", () => {
    expect(renderCapacityOutput(azure)).toContain("1,530");
  });

  it("escapes every string it did not author", () => {
    // Nothing user-typed reaches this panel today, but the labels, details and
    // warnings all flow through esc so a future data source cannot inject.
    const html = renderCapacityOutput(aws);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });
});

describe("CAPACITY_CSS", () => {
  it("uses Light Tennessee variables with fallbacks, never the retired palette", () => {
    expect(CAPACITY_CSS).toContain("var(--color-orange-deep, #e07200)");
    expect(CAPACITY_CSS).toContain("var(--color-line, #e4e1dc)");
    for (const retired of ["#00ffcc", "#040a14", "#eef6ff", "#ffaa00", "#4da6ff"]) {
      expect(CAPACITY_CSS).not.toContain(retired);
    }
  });

  it("styles every segment class the renderer can emit", () => {
    for (const cls of ["swb-cap-res", "swb-cap-u0", "swb-cap-u1", "swb-cap-free"]) {
      expect(CAPACITY_CSS).toContain(`.${cls}`);
    }
  });
});
