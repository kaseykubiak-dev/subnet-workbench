import { describe, expect, it } from "vitest";

import {
  SERVICES_CSS,
  renderServicesInputs,
  renderServicesOutput,
  servicesCatalogueFor,
  servicesEstimateFor,
} from "./servicesView";
import { renderCapacityInputs, renderCapacityOutput } from "./capacityView";
import { initialState } from "./state";
import type { ShellState } from "./state";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, ...overrides };
}

const base = withState({ mode: "capacity", capacityWorkload: "services" });
const azure = withState({ ...base, platform: "azure" });
const aws = withState({ ...base, platform: "aws" });

/** The worked Azure plan the Variant B mockup illustrates. */
const workedAzure = withState({
  ...azure,
  serviceCounts: {
    "azure-private-endpoint": 12,
    "azure-cosmos-private-endpoint": 3,
    "azure-app-service-integration": 20,
    "azure-sql-mi": 1,
    "azure-container-instances": 4,
  },
  sqlMiGeneralPurpose: 2,
  sqlMiBusinessCritical: 1,
  sqlMiZoneRedundant: 0,
  sqlMiVmGroups: 1,
});

describe("servicesCatalogueFor", () => {
  it("shows only the selected platform's services", () => {
    expect(servicesCatalogueFor(azure).every((c) => c.platform === "azure")).toBe(true);
    expect(servicesCatalogueFor(aws).every((c) => c.platform === "aws")).toBe(true);
  });

  it("offers nothing on-prem, where none of these services exist", () => {
    expect(servicesCatalogueFor(base)).toEqual([]);
  });
});

describe("servicesEstimateFor", () => {
  it("builds the sub-plans the formula services need out of the flat state", () => {
    const plan = servicesEstimateFor(workedAzure);
    const mi = plan.subnets.find((s) => s.id === "azure-sql-mi");
    // 5 + (2 x 4) + (1 x 10) + (1 x 8) = 31, floored to 32, less Azure's 5.
    expect(mi?.addresses).toBe(27);
    expect(plan.warnings).toEqual([]);
  });

  it("reaches the same rollup the model does", () => {
    const plan = servicesEstimateFor(workedAzure);
    expect(plan.consumed).toBe(83);
    expect(plan.committed).toBe(144);
    expect(plan.supernetPrefix).toBe(24);
  });

  it("costs Application Gateway from one instance count applied to every gateway", () => {
    const plan = servicesEstimateFor(
      withState({
        ...azure,
        serviceCounts: { "azure-app-gateway": 2 },
        appGwMaxInstances: 10,
        appGwPrivateFrontend: true,
      })
    );
    const gw = plan.subnets.find((s) => s.id === "azure-app-gateway");
    expect(gw?.addresses).toBe(22); // 10 + 10 instances, plus one frontend each
  });

  it("leaves Application Gateway uncosted at zero gateways rather than inventing one", () => {
    const plan = servicesEstimateFor(
      withState({ ...azure, serviceCounts: { "azure-app-gateway": 0 } })
    );
    expect(plan.subnets.find((s) => s.id === "azure-app-gateway")?.addresses).toBeNull();
    expect(plan.warnings.join(" ")).toMatch(/maximum instance count/i);
  });

  it("keeps counts across a platform switch, since a plan is not abandoned by looking away", () => {
    const switched = withState({ ...workedAzure, platform: "aws" });
    // Nothing Azure is costed under AWS, but the numbers survive the round trip.
    expect(servicesEstimateFor(switched).subnets).toEqual([]);
    expect(servicesEstimateFor(withState({ ...switched, platform: "azure" })).consumed).toBe(83);
  });
});

describe("renderServicesInputs", () => {
  it("nudges toward the platform picker before anything can be costed", () => {
    expect(renderServicesInputs(base)).toContain("Pick Azure or AWS");
  });

  it("gives every catalogue row a tick keyed by its consumer id", () => {
    const html = renderServicesInputs(azure);
    for (const consumer of servicesCatalogueFor(azure)) {
      expect(html).toContain(`data-service="${consumer.id}"`);
    }
  });

  it("shows a count box only for the services actually selected", () => {
    expect(renderServicesInputs(azure)).not.toContain("data-service-count");
    expect(renderServicesInputs(workedAzure)).toContain(
      'data-service-count="azure-private-endpoint"'
    );
  });

  it("labels sharing on the row, because that is what decides subnet count", () => {
    const html = renderServicesInputs(azure);
    expect(html).toContain("Shared");
    expect(html).toContain("Delegated");
    expect(html).toContain("Dedicated");
  });

  it("reveals the SQL MI instance mix only once SQL MI is ticked", () => {
    expect(renderServicesInputs(azure)).not.toContain('data-field="sqlMiGeneralPurpose"');
    expect(renderServicesInputs(workedAzure)).toContain('data-field="sqlMiGeneralPurpose"');
  });

  it("reveals the Application Gateway fields only once it is ticked", () => {
    const on = withState({ ...azure, serviceCounts: { "azure-app-gateway": 1 } });
    expect(renderServicesInputs(azure)).not.toContain('data-field="appGwMaxInstances"');
    expect(renderServicesInputs(on)).toContain('data-field="appGwMaxInstances"');
    expect(renderServicesInputs(on)).toContain('data-field="appGwPrivateFrontend"');
  });
});

describe("renderServicesOutput", () => {
  it("waits for a platform rather than guessing a reserved count", () => {
    expect(renderServicesOutput(base)).toContain("Waiting on a platform");
  });

  it("says nothing is selected instead of rendering an empty plan", () => {
    expect(renderServicesOutput(azure)).toContain("Nothing selected yet");
  });

  it("leads with the supernet and the consumed-versus-committed pair", () => {
    const html = renderServicesOutput(workedAzure);
    expect(html).toContain("/24");
    expect(html).toContain("4 subnets");
    expect(html).toContain("83 consumed");
    expect(html).toContain("144 committed");
  });

  it("draws one card per subnet, not one per service", () => {
    const html = renderServicesOutput(workedAzure);
    // Five services, four subnets: the two shared ones pooled. Counted with
    // the closing quote so the `swb-svc-cards` wrapper is not mistaken for a card.
    expect(html.split('"swb-svc-card"').length - 1).toBe(4);
    expect(html).toContain("Shared service subnet");
  });

  it("names the delegation on the card, since that is what blocks co-tenancy", () => {
    expect(renderServicesOutput(workedAzure)).toContain("Microsoft.Web/serverFarms");
  });

  it("says no published count rather than drawing a zero", () => {
    const html = renderServicesOutput(workedAzure);
    expect(html).toContain("No published address count");
    // A zero here would claim Container Instances is free. Anchored on the tag
    // close so the 40 and the 16 of the other cards are not read as zeroes.
    expect(html).not.toContain(">0 usable addresses");
  });

  it("shows what rounding costs, which is the number nobody budgets for", () => {
    const html = renderServicesOutput(workedAzure);
    expect(html).toContain("Lost to rounding");
    expect(html).toContain("61 (42%)"); // 144 committed less 83 consumed
  });

  it("offers the hand-off into Plan mode", () => {
    expect(renderServicesOutput(workedAzure)).toContain('data-action="handoff-plan"');
    // Nothing to hand off before anything is selected.
    expect(renderServicesOutput(azure)).not.toContain('data-action="handoff-plan"');
  });

  it("escapes what it renders", () => {
    const html = renderServicesOutput(workedAzure);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });

  it("uses no em dashes in prose, matching the rest of the shell", () => {
    expect(renderServicesOutput(workedAzure)).not.toContain("— ");
  });
});

describe("the workload toggle routes Capacity mode", () => {
  it("hands both columns to the services panel when services is selected", () => {
    expect(renderCapacityInputs(workedAzure)).toContain("data-service=");
    expect(renderCapacityOutput(workedAzure)).toContain("Shared service subnet");
  });

  it("leaves the Kubernetes panel alone when it is not", () => {
    const k8s = withState({ ...workedAzure, capacityWorkload: "kubernetes" });
    expect(renderCapacityInputs(k8s)).toContain('data-field="aksNodes"');
    expect(renderCapacityOutput(k8s)).toContain("Same workload, every mode");
  });

  it("renders the switch itself in both workloads, so neither half hides", () => {
    for (const state of [workedAzure, withState({ ...azure, capacityWorkload: "kubernetes" })]) {
      expect(renderCapacityInputs(state)).toContain('data-action="set-workload"');
      expect(renderCapacityInputs(state)).toContain('data-workload="services"');
    }
  });
});

describe("SERVICES_CSS", () => {
  it("uses Light Tennessee variables with fallbacks, never the retired palette", () => {
    expect(SERVICES_CSS).toContain("var(--color-orange-deep, #e07200)");
    expect(SERVICES_CSS).toContain("var(--color-line, #e4e1dc)");
    for (const retired of ["#00ffcc", "#040a14", "#eef6ff", "#ffaa00", "#4da6ff"]) {
      expect(SERVICES_CSS).not.toContain(retired);
    }
  });

  it("styles every sharing tag the renderer can emit", () => {
    for (const cls of ["swb-svc-shared", "swb-svc-dedic", "swb-svc-deleg"]) {
      expect(SERVICES_CSS).toContain(`.${cls}`);
    }
  });
});
