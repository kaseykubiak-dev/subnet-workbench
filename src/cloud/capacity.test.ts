import { describe, expect, it } from "vitest";
import {
  AKS_DEFAULT_MAX_PODS,
  AKS_MAX_PODS_CEILING,
  APP_GATEWAY_V2_MAX_INSTANCES,
  SERVICE_CONSUMERS,
  SQL_MI_MINIMUM_ADDRESSES,
  appGatewayAddresses,
  eksMaxPods,
  estimateAks,
  estimateEks,
  remainingCapacity,
  serviceConsumerById,
  sqlManagedInstanceAddresses,
  type CapacityEstimate,
} from "./capacity";

function warningText(estimate: CapacityEstimate): string {
  return estimate.warnings.join(" ");
}

function companion(estimate: CapacityEstimate, name: string) {
  const found = estimate.companions.find((c) => c.name === name);
  expect(found, `no companion named ${name}`).toBeDefined();
  return found!;
}

describe("AKS mode defaults", () => {
  it("overlay defaults to 250 pods, not the 30 that only applies to node-subnet mode", () => {
    // A single blanket default of 30 would understate overlay by more than 8x.
    expect(AKS_DEFAULT_MAX_PODS["azure-cni-node-subnet"]).toBe(30);
    expect(AKS_DEFAULT_MAX_PODS["azure-cni-overlay"]).toBe(250);
    expect(AKS_DEFAULT_MAX_PODS["azure-cni-pod-subnet"]).toBe(110);
    expect(AKS_DEFAULT_MAX_PODS.kubenet).toBe(110);
  });
});

describe("estimateAks: traditional Azure CNI (node subnet)", () => {
  it("reproduces Microsoft's worked example verbatim", () => {
    // 50 nodes + 1 surge = 51; (51) + (51 * 30) = 1,581 addresses, a /21.
    const e = estimateAks({ mode: "azure-cni-node-subnet", nodes: 50 });
    expect(e.addresses).toBe(1581);
    expect(e.prefix).toBe(21);
  });

  it("counts nodes and pods as separate breakdown lines", () => {
    const e = estimateAks({ mode: "azure-cni-node-subnet", nodes: 50 });
    expect(e.breakdown.map((b) => b.addresses)).toEqual([51, 1530]);
  });

  it("returns usable addresses, so the reserved 5 is added exactly once", () => {
    // 1 node, no surge, 10 pods = 11 usable, which is exactly a /28 on Azure
    // (16 - 5). If the estimator added its own 5 this would land on a /27.
    const e = estimateAks({
      mode: "azure-cni-node-subnet",
      nodes: 1,
      maxPodsPerNode: 10,
      maxSurge: 0,
    });
    expect(e.addresses).toBe(11);
    expect(e.prefix).toBe(28);
  });

  it("surge nodes draw a full pod allotment, and the estimate says so", () => {
    const one = estimateAks({ mode: "azure-cni-node-subnet", nodes: 10, maxSurge: 1 });
    const two = estimateAks({ mode: "azure-cni-node-subnet", nodes: 10, maxSurge: 2 });
    // One extra surge node costs 31 addresses, not 1.
    expect(two.addresses - one.addresses).toBe(31);
    expect(warningText(one)).toMatch(/surge/i);
  });

  it("has no companion range, since pods come from the node subnet itself", () => {
    expect(estimateAks({ mode: "azure-cni-node-subnet", nodes: 50 }).companions).toEqual([]);
  });
});

describe("estimateAks: modes that do NOT multiply the node subnet by pods", () => {
  it("overlay charges the node subnet for nodes only", () => {
    const e = estimateAks({ mode: "azure-cni-overlay", nodes: 50 });
    expect(e.addresses).toBe(51);
    expect(e.prefix).toBe(26);
  });

  it("overlay moves pod space to a separate CIDR at a fixed /24 per node", () => {
    const e = estimateAks({ mode: "azure-cni-overlay", nodes: 50 });
    const pods = companion(e, "Overlay pod CIDR");
    expect(pods.addresses).toBe(51 * 256);
    expect(pods.separateFromVnet).toBe(true);
  });

  it("the overlay block is fixed, so changing maxPods does not change it", () => {
    const low = estimateAks({ mode: "azure-cni-overlay", nodes: 50, maxPodsPerNode: 30 });
    const high = estimateAks({ mode: "azure-cni-overlay", nodes: 50, maxPodsPerNode: 250 });
    expect(low.addresses).toBe(high.addresses);
    expect(companion(low, "Overlay pod CIDR").addresses).toBe(
      companion(high, "Overlay pod CIDR").addresses
    );
  });

  it("kubenet charges the node subnet for nodes and NATs pods elsewhere", () => {
    const e = estimateAks({ mode: "kubenet", nodes: 50 });
    expect(e.addresses).toBe(51);
    const pods = companion(e, "Pod CIDR");
    expect(pods.addresses).toBe(51 * 110);
    expect(pods.separateFromVnet).toBe(true);
  });

  it("pod-subnet mode keeps pod space inside the VNet", () => {
    const e = estimateAks({ mode: "azure-cni-pod-subnet", nodes: 50 });
    expect(e.addresses).toBe(51);
    expect(companion(e, "Pod subnet").separateFromVnet).toBe(false);
  });
});

describe("estimateAks: pod-subnet batching", () => {
  it("rounds pod addresses up to a multiple of 16 per node", () => {
    // 110 pods + the node's own address = 111, which needs 7 batches = 112.
    const e = estimateAks({ mode: "azure-cni-pod-subnet", nodes: 50, maxPodsPerNode: 110 });
    expect(companion(e, "Pod subnet").addresses).toBe(51 * 112);
  });

  it("warns about the waste and names the free upgrade", () => {
    const e = estimateAks({ mode: "azure-cni-pod-subnet", nodes: 50, maxPodsPerNode: 110 });
    expect(warningText(e)).toMatch(/wastes 1 address per node/);
    expect(warningText(e)).toMatch(/111 pods per node costs the same/);
  });

  it("does not warn when maxPods lands exactly on a batch boundary", () => {
    // (16 x 7) - 1 = 111 pods plus the node address fills 7 batches exactly.
    const e = estimateAks({ mode: "azure-cni-pod-subnet", nodes: 50, maxPodsPerNode: 111 });
    expect(warningText(e)).not.toMatch(/wastes/);
    expect(companion(e, "Pod subnet").addresses).toBe(51 * 112);
  });
});

describe("estimateAks: bounds and input validation", () => {
  it("warns above the pod ceiling and below the floor", () => {
    const over = estimateAks({ mode: "azure-cni-overlay", nodes: 5, maxPodsPerNode: 300 });
    expect(warningText(over)).toMatch(new RegExp(`ceiling of ${AKS_MAX_PODS_CEILING}`));
    const under = estimateAks({ mode: "azure-cni-overlay", nodes: 5, maxPodsPerNode: 5 });
    expect(warningText(under)).toMatch(/floor of 10/);
  });

  it("reports null and warns when no single Azure subnet is big enough", () => {
    const e = estimateAks({ mode: "azure-cni-node-subnet", nodes: 40_000_000 });
    expect(e.prefix).toBeNull();
    expect(warningText(e)).toMatch(/exceeds what a single Azure subnet can hold/);
  });

  it("rejects negative and fractional inputs rather than producing a number", () => {
    expect(() => estimateAks({ mode: "kubenet", nodes: -1 })).toThrow(RangeError);
    expect(() => estimateAks({ mode: "kubenet", nodes: 1.5 })).toThrow(RangeError);
    expect(() => estimateAks({ mode: "kubenet", nodes: 5, maxSurge: -1 })).toThrow(RangeError);
    expect(() => estimateAks({ mode: "kubenet", nodes: 5, maxPodsPerNode: -1 })).toThrow(
      RangeError
    );
  });
});

describe("eksMaxPods", () => {
  const m5Large = { enisPerNode: 3, ipsPerEni: 10 };

  it("matches AWS's published max pods for m5.large", () => {
    // (3 ENIs x (10 - 1)) + 2 host-networked = 29.
    expect(eksMaxPods({ mode: "secondary-ip", ...m5Large })).toBe(29);
  });

  it("custom networking costs a whole ENI", () => {
    // AWS publishes 20 for m5.large with custom networking.
    expect(eksMaxPods({ mode: "secondary-ip", ...m5Large, customNetworking: true })).toBe(20);
  });

  it("prefix delegation multiplies each address slot by 16", () => {
    expect(eksMaxPods({ mode: "prefix-delegation", ...m5Large })).toBe(3 * 9 * 16 + 2);
    expect(
      eksMaxPods({ mode: "prefix-delegation", ...m5Large, customNetworking: true })
    ).toBe(2 * 9 * 16 + 2);
  });

  it("never goes negative when custom networking consumes the only ENI", () => {
    expect(
      eksMaxPods({
        mode: "secondary-ip",
        enisPerNode: 1,
        ipsPerEni: 10,
        customNetworking: true,
      })
    ).toBe(2);
  });
});

describe("estimateEks: addresses held, not addresses bound", () => {
  const c5Large = { enisPerNode: 3, ipsPerEni: 10 };

  it("counts the warm ENI the CNI keeps attached but unused", () => {
    // 2 pods fit on one ENI, but WARM_ENI_TARGET keeps a second attached, so
    // each node holds 20 addresses to run 2 pods.
    const e = estimateEks({ mode: "secondary-ip", nodes: 3, podsPerNode: 2, ...c5Large });
    expect(e.addresses).toBe(60);
    expect(e.breakdown[0]?.addresses).toBe(20);
  });

  it("warns that held exceeds bound, which is how a healthy subnet runs out", () => {
    const e = estimateEks({ mode: "secondary-ip", nodes: 3, podsPerNode: 2, ...c5Large });
    expect(warningText(e)).toMatch(/holds 60 addresses to run 6 pods/);
  });

  it("sizes the subnet off held addresses", () => {
    // 60 held does not fit a /26 (59 usable) even though 6 pods obviously would.
    const e = estimateEks({ mode: "secondary-ip", nodes: 3, podsPerNode: 2, ...c5Large });
    expect(e.prefix).toBe(25);
  });

  it("stops adding warm ENIs once the instance type is saturated", () => {
    // 27 pods need all 3 ENIs; there is no fourth to keep warm.
    const e = estimateEks({ mode: "secondary-ip", nodes: 10, podsPerNode: 27, ...c5Large });
    expect(e.breakdown[0]?.addresses).toBe(30);
    expect(e.addresses).toBe(300);
  });

  it("warns when pods per node exceeds what the instance type supports", () => {
    const e = estimateEks({ mode: "secondary-ip", nodes: 2, podsPerNode: 40, ...c5Large });
    expect(warningText(e)).toMatch(/exceeds the 29 this instance type supports/);
  });
});

describe("estimateEks: custom networking and prefix delegation", () => {
  const c5Large = { enisPerNode: 3, ipsPerEni: 10 };

  it("custom networking leaves only node primary addresses in the node subnet", () => {
    const e = estimateEks({
      mode: "secondary-ip",
      nodes: 10,
      podsPerNode: 2,
      customNetworking: true,
      ...c5Large,
    });
    expect(e.addresses).toBe(10);
    expect(e.prefix).toBe(28);
  });

  it("custom networking moves the held addresses to a companion subnet", () => {
    const e = estimateEks({
      mode: "secondary-ip",
      nodes: 10,
      podsPerNode: 2,
      customNetworking: true,
      ...c5Large,
    });
    // Only 2 pod-capable ENIs remain, both attached because of the warm pool.
    const pods = companion(e, "Pod subnet (secondary VPC CIDR)");
    expect(pods.addresses).toBe(200);
    expect(pods.separateFromVnet).toBe(false);
    expect(pods.detail).toMatch(/100\.64\.0\.0\/10/);
  });

  it("flags the contiguous-/28 requirement that makes prefix delegation fail", () => {
    const e = estimateEks({ mode: "prefix-delegation", nodes: 3, podsPerNode: 30, ...c5Large });
    expect(warningText(e)).toMatch(/InsufficientCidrBlocks/);
  });

  it("rejects instance shapes that cannot exist", () => {
    expect(() =>
      estimateEks({ mode: "secondary-ip", nodes: 1, podsPerNode: 1, enisPerNode: 0, ipsPerEni: 10 })
    ).toThrow(RangeError);
    expect(() =>
      estimateEks({ mode: "secondary-ip", nodes: 1, podsPerNode: 1, enisPerNode: 3, ipsPerEni: 1 })
    ).toThrow(RangeError);
  });
});

describe("SQL Managed Instance", () => {
  it("applies Microsoft's published formula", () => {
    // 5 + (10 x 4) + (2 x 10) + (2 x 2) + (1 x 8) = 77.
    expect(
      sqlManagedInstanceAddresses({
        generalPurpose: 10,
        businessCritical: 2,
        zoneRedundant: 2,
        vmGroups: 1,
      })
    ).toBe(77);
  });

  it("floors at 32 addresses no matter how small the deployment is", () => {
    const empty = { generalPurpose: 0, businessCritical: 0, zoneRedundant: 0, vmGroups: 0 };
    expect(sqlManagedInstanceAddresses(empty)).toBe(SQL_MI_MINIMUM_ADDRESSES);
    expect(
      sqlManagedInstanceAddresses({ ...empty, generalPurpose: 1, vmGroups: 1 })
    ).toBe(32); // computed 17, floored
  });

  it("stops flooring once the formula clears the minimum", () => {
    expect(
      sqlManagedInstanceAddresses({
        generalPurpose: 0,
        businessCritical: 0,
        zoneRedundant: 0,
        vmGroups: 4,
      })
    ).toBe(37);
  });

  it("rejects negative counts", () => {
    expect(() =>
      sqlManagedInstanceAddresses({
        generalPurpose: -1,
        businessCritical: 0,
        zoneRedundant: 0,
        vmGroups: 0,
      })
    ).toThrow(RangeError);
  });
});

describe("Application Gateway", () => {
  it("charges the configured maximum instance count, not the v2 ceiling", () => {
    // The reason "just use a /24" is usually wrong: a gateway capped at 10
    // needs 11 addresses, not 125.
    expect(
      appGatewayAddresses({ maxInstancesPerGateway: [10], gatewaysWithPrivateFrontend: 1 })
    ).toBe(11);
  });

  it("sums across gateways sharing the subnet", () => {
    expect(
      appGatewayAddresses({ maxInstancesPerGateway: [10, 20], gatewaysWithPrivateFrontend: 2 })
    ).toBe(32);
  });

  it("charges nothing for a gateway with no private frontend", () => {
    expect(
      appGatewayAddresses({ maxInstancesPerGateway: [10], gatewaysWithPrivateFrontend: 0 })
    ).toBe(10);
  });

  it("accepts the ceiling and rejects anything past it", () => {
    expect(
      appGatewayAddresses({
        maxInstancesPerGateway: [APP_GATEWAY_V2_MAX_INSTANCES],
        gatewaysWithPrivateFrontend: 0,
      })
    ).toBe(APP_GATEWAY_V2_MAX_INSTANCES);
    expect(() =>
      appGatewayAddresses({
        maxInstancesPerGateway: [APP_GATEWAY_V2_MAX_INSTANCES + 1],
        gatewaysWithPrivateFrontend: 0,
      })
    ).toThrow(RangeError);
  });

  it("rejects more private frontends than there are gateways", () => {
    expect(() =>
      appGatewayAddresses({ maxInstancesPerGateway: [10], gatewaysWithPrivateFrontend: 2 })
    ).toThrow(RangeError);
  });
});

describe("service consumer table", () => {
  it("ids are unique and every row carries at least one note", () => {
    const ids = SERVICE_CONSUMERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SERVICE_CONSUMERS) {
      expect(c.notes.length, c.id).toBeGreaterThan(0);
      expect(c.unit.length, c.id).toBeGreaterThan(0);
    }
  });

  it("leaves perUnit undefined wherever the vendor publishes no number", () => {
    // Undefined is the point: a caller cannot multiply by a fiction.
    for (const id of [
      "azure-cosmos-private-endpoint",
      "azure-sql-mi",
      "azure-container-instances",
      "aws-rds",
      "aws-lambda",
    ]) {
      expect(serviceConsumerById(id).perUnit, id).toBeUndefined();
    }
  });

  it("private endpoints are one address each, with Cosmos DB as the stated exception", () => {
    expect(serviceConsumerById("azure-private-endpoint").perUnit).toBe(1);
    expect(serviceConsumerById("azure-cosmos-private-endpoint").notes.join(" ")).toMatch(
      /regions \+ 1/
    );
  });

  it("NLB carries the per-zone count and disowns the ALB-only requirement", () => {
    const nlb = serviceConsumerById("aws-nlb");
    expect(nlb.perUnit).toBe(1);
    expect(nlb.notes.join(" ")).toMatch(/Application Load Balancer/);
  });

  it("SQL MI points at the formula rather than pretending to be a flat count", () => {
    expect(serviceConsumerById("azure-sql-mi").notes.join(" ")).toMatch(
      /sqlManagedInstanceAddresses/
    );
  });

  it("throws on an unknown id, since that is a code bug not user input", () => {
    expect(() => serviceConsumerById("azure-nonexistent")).toThrow(/unknown service consumer/);
  });
});

describe("remainingCapacity", () => {
  it("subtracts from the platform's usable count, not the raw subnet size", () => {
    expect(remainingCapacity(24, 191, "azure")).toBe(60); // 256 - 5 - 191
    expect(remainingCapacity(24, 191, "aws")).toBe(60);
    expect(remainingCapacity(24, 191, "none")).toBe(63); // 256 - 2 - 191
  });

  it("goes negative when the subnet is already short", () => {
    expect(remainingCapacity(28, 20, "azure")).toBe(-9);
  });

  it("closes the loop with the estimators", () => {
    const e = estimateAks({ mode: "azure-cni-node-subnet", nodes: 50 });
    expect(e.prefix).not.toBeNull();
    expect(remainingCapacity(e.prefix!, e.addresses, "azure")).toBeGreaterThanOrEqual(0);
  });
});
