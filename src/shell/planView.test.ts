import { describe, expect, it } from "vitest";

import {
  PLAN_CSS,
  planViewModel,
  renderPlanInputs,
  renderPlanOutput,
  renderPlanStats,
  severityByPath,
} from "./planView";
import { initialState } from "./state";
import type { ShellState } from "./state";
import { validatePlan } from "../cloud/hierarchy";
import { parsePlanText } from "../cloud/planText";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, mode: "plan", platform: "azure", ...overrides };
}

/** The worked example from the hierarchy mockup, in the documented format. */
const WORKED = [
  "region eastus 10.20.0.0/14",
  "  vnet hub 10.20.0.0/22",
  "    GatewaySubnet        10.20.0.0/27",
  "    AzureFirewallSubnet  10.20.0.64/26",
  "  vnet prod-aks 10.20.8.0/21",
  "    aks-nodes            10.20.8.0/22",
  "",
  "region westus2 10.24.0.0/14",
  "  vnet dr-hub 10.31.0.0/22",
  "",
  "external on-prem-datacenter 10.20.8.0/22  # ExpressRoute",
].join("\n");

const worked = withState({ planInput: WORKED });

describe("planViewModel", () => {
  it("parses and validates in one pass, so the view never re-runs either", () => {
    const model = planViewModel(worked);
    expect(model.errors).toEqual([]);
    expect(model.plan.regions.map((r) => r.name)).toEqual(["eastus", "westus2"]);
    expect(model.report.status).toBe("problems");
  });

  it("reports a bad line without losing the rest of the plan", () => {
    const model = planViewModel(withState({ planInput: "region r 10.0.0.0/8\n  vnet v 10.0.999.0/16" }));
    expect(model.errors).toHaveLength(1);
    expect(model.plan.regions).toHaveLength(1);
  });

  it("carries the platform through, since reserved overhead depends on it", () => {
    expect(planViewModel(withState({ platform: "aws", planInput: "region r 10.0.0.0/8" })).plan.platform).toBe("aws");
  });
});

describe("severityByPath", () => {
  it("flags both sides of a two-sided finding", () => {
    // An overlap is not the fault of whichever object the sort put first.
    const { plan } = parsePlanText(
      ["region r 10.0.0.0/8", "  vnet v 10.0.0.0/16", "    a 10.0.0.0/24", "    b 10.0.0.128/25"].join("\n"),
      "azure"
    );
    const worst = severityByPath(validatePlan(plan).findings);
    expect(worst.get("r / v / a")).toBe("error");
    expect(worst.get("r / v / b")).toBe("error");
  });

  it("lets an error beat a warning on the same path", () => {
    const worst = severityByPath([
      { kind: "vnet-overlap", severity: "error", message: "", consequence: "", a: { region: "r", vnet: "v" } },
      { kind: "vnet-outside-region", severity: "warning", message: "", consequence: "", a: { region: "r", vnet: "v" } },
    ]);
    expect(worst.get("r / v")).toBe("error");
  });

  it("returns nothing for a clean plan", () => {
    expect(severityByPath([]).size).toBe(0);
  });
});

describe("renderPlanInputs", () => {
  it("wires the textarea to the field app.ts listens for", () => {
    expect(renderPlanInputs(worked)).toContain('data-field="planInput"');
  });

  it("teaches the format in the placeholder rather than seeding the box", () => {
    // Unlike Capacity, an empty plan is a real state: a seeded example would be
    // something to delete before the paste.
    const html = renderPlanInputs(withState({ planInput: "" }));
    expect(html).toContain("region eastus 10.20.0.0/14");
    expect(html).toContain('spellcheck="false"></textarea>');
  });

  it("escapes what the person typed back into the box", () => {
    const html = renderPlanInputs(withState({ planInput: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderPlanOutput", () => {
  it("shows a hint on an empty plan instead of an empty panel", () => {
    const html = renderPlanOutput(withState({ planInput: "" }));
    expect(html).toContain("swb-hint");
    expect(html).toContain("Waiting on a plan.");
    expect(html).not.toContain("swb-plan-tree");
  });

  it("renders a row for every region, VNet and subnet in the tree", () => {
    const html = renderPlanOutput(worked);
    expect(html.match(/class="swb-plan-row swb-plan-region/g)).toHaveLength(3); // 2 regions + External header
    expect(html.match(/swb-plan-row swb-plan-vnet/g)).toHaveLength(3);
    expect(html).toContain("GatewaySubnet");
    expect(html).toContain("AzureFirewallSubnet");
    expect(html).toContain("aks-nodes");
  });

  it("puts the VNet's own CIDR beside its name, which the mockup dropped", () => {
    expect(renderPlanOutput(worked)).toContain(
      `<span class="swb-plan-inline-cidr">10.20.0.0/22</span>`
    );
  });

  it("interleaves free blocks with subnets in address order", () => {
    // hub holds a /27 at .0 and a /26 at .64, so the gap at .32 sorts between
    // them rather than being listed after both.
    const html = renderPlanOutput(withState({
      planInput: ["vnet hub 10.20.0.0/22", "  a 10.20.0.0/27", "  b 10.20.0.64/26"].join("\n"),
    }));
    const gap = html.indexOf("10.20.0.32/27");
    const b = html.indexOf("10.20.0.64/26");
    expect(gap).toBeGreaterThan(-1);
    expect(gap).toBeLessThan(b);
  });

  it("names the largest free block on the row it occupies", () => {
    const html = renderPlanOutput(withState({
      planInput: ["vnet hub 10.0.0.0/22", "  a 10.0.0.0/24"].join("\n"),
    }));
    // 10.0.2.0/23 is the biggest of the two gaps a /24 leaves in a /22.
    expect(html).toContain("<b>10.0.2.0/23</b> &middot; 512 &nbsp;&#8592; largest free block");
    // Exactly one row wears the note; the smaller gap does not.
    expect(html.match(/&#8592; largest free block/g)).toHaveLength(1);
  });

  it("lists an escaped subnet last, flagged, and out of the free-space order", () => {
    const html = renderPlanOutput(withState({
      planInput: ["vnet hub 10.0.0.0/22", "  inside 10.0.0.0/24", "  escaped 10.9.0.0/24"].join("\n"),
    }));
    expect(html).toContain("outside VNet");
    // After the free rows, not sorted into them by address.
    expect(html.indexOf("escaped")).toBeGreaterThan(html.lastIndexOf("swb-plan-free"));
  });

  it("clamps the utilization bar without softening the percentage beside it", () => {
    // Two /23s inside a /23 allocate 200% of the block.
    const html = renderPlanOutput(withState({
      planInput: ["vnet v 10.0.0.0/23", "  a 10.0.0.0/23", "  b 10.0.0.0/23"].join("\n"),
    }));
    expect(html).toContain('style="width:100.0%"');
    expect(html).toContain("200.0%");
  });

  it("keeps declared external ranges visible even when they collide with nothing", () => {
    const html = renderPlanOutput(withState({
      planInput: ["vnet hub 10.0.0.0/22", "external on-prem 192.168.0.0/16  # ExpressRoute"].join("\n"),
    }));
    expect(html).toContain("Declared ranges");
    expect(html).toContain("on-prem");
    expect(html).toContain("192.168.0.0/16");
    expect(html).toContain("ExpressRoute");
  });

  it("writes both findings from the worked example, with their consequences", () => {
    const html = renderPlanOutput(worked);
    expect(html.match(/class="swb-plan-finding /g)).toHaveLength(2);
    expect(html).toContain("swb-plan-f-err");
    expect(html).toContain("swb-plan-f-warn");
    expect(html).toContain("swb-plan-cons");
  });

  it("prints the address range of an overlap rather than only naming the pair", () => {
    const html = renderPlanOutput(worked);
    expect(html).toContain("swb-plan-range");
    expect(html).toContain("10.20.8.0");
    expect(html).toContain("10.20.11.255");
  });

  it("surfaces a parse error above the results instead of dropping it", () => {
    const html = renderPlanOutput(withState({
      planInput: ["region r 10.0.0.0/8", "  vnet broken 10.0.999.0/16", "  vnet good 10.0.0.0/16"].join("\n"),
    }));
    expect(html).toContain("swb-errors");
    expect(html).toContain("line 2");
    expect(html).toContain("good");
  });

  it("ends with the paste-ready text block, like every other list mode", () => {
    expect(renderPlanOutput(worked)).toContain('<pre class="swb-pre">');
  });

  it("escapes names that came out of the textarea", () => {
    // The name reaches three places (tree row, findings, text block) and every
    // one of them has to defuse it, so the assertion is on the raw tag.
    const html = renderPlanOutput(withState({
      planInput: "vnet <img src=x onerror=alert(1)> 10.0.0.0/22",
    }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("renderPlanStats", () => {
  it("renders nothing when there is no VNet to account for", () => {
    // Built by hand rather than parsed: a text plan of bare regions is reread
    // one level down as VNets, so this shape only arrives from a caller.
    const report = validatePlan({
      platform: "azure",
      regions: [{ name: "eastus", network: 0x0a000000, prefix: 8, vnets: [] }],
    });
    expect(renderPlanStats(report)).toBe("");
  });

  it("sums the four numbers across every VNet in the plan", () => {
    const report = validatePlan(parsePlanText(
      ["vnet a 10.0.0.0/24", "  s1 10.0.0.0/25", "vnet b 10.1.0.0/24", "  s2 10.1.0.0/26"].join("\n"),
      "azure"
    ).plan);
    const html = renderPlanStats(report);
    expect(html).toContain("<dd>512</dd>"); // two /24s
    expect(html).toContain("2 VNets");
    expect(html).toContain("<dd>37.5%</dd>"); // 192 of 512
    expect(html).toContain("192 addresses");
  });

  it("reports the reserved overhead nobody budgets for", () => {
    // Azure takes 5 per subnet where RFC takes 2, so two subnets cost 10.
    const report = validatePlan(parsePlanText(
      ["vnet a 10.0.0.0/24", "  s1 10.0.0.0/26", "  s2 10.0.0.64/26"].join("\n"),
      "azure"
    ).plan);
    expect(renderPlanStats(report)).toContain("lost to platform reservations");
    expect(renderPlanStats(report)).toContain("<dd>10</dd>");
  });

  it("says so plainly when every VNet is full", () => {
    const report = validatePlan(parsePlanText(
      ["vnet a 10.0.0.0/24", "  s1 10.0.0.0/24"].join("\n"),
      "azure"
    ).plan);
    const html = renderPlanStats(report);
    expect(html).toContain("<dd>none</dd>");
    expect(html).toContain("every VNet is full");
  });

  it("picks the largest free block across VNets by prefix, not by order", () => {
    const report = validatePlan(parsePlanText(
      ["vnet small 10.0.0.0/28", "vnet big 10.1.0.0/16"].join("\n"),
      "azure"
    ).plan);
    expect(renderPlanStats(report)).toContain("10.1.0.0/16");
  });
});

describe("PLAN_CSS", () => {
  it("uses Light Tennessee variables with fallbacks, never the retired palette", () => {
    expect(PLAN_CSS).toContain("var(--color-orange, #ff8200)");
    expect(PLAN_CSS).toContain("var(--tool-danger, #d64550)");
    for (const retired of ["#00ffcc", "#040a14", "#eef6ff", "#ffaa00", "#4da6ff"]) {
      expect(PLAN_CSS).not.toContain(retired);
    }
  });

  it("styles every row class the renderer can emit", () => {
    for (const cls of [
      "swb-plan-region",
      "swb-plan-vnet",
      "swb-plan-subnet",
      "swb-plan-free",
      "swb-plan-flag",
      "swb-plan-flag-w",
      "swb-plan-ext",
      "swb-plan-f-err",
      "swb-plan-f-warn",
    ]) {
      expect(PLAN_CSS).toContain(`.${cls}`);
    }
  });

  it("narrows the grid on a phone rather than letting the CIDR column win", () => {
    expect(PLAN_CSS).toContain("@media (max-width: 768px)");
    expect(PLAN_CSS).toContain("1fr 90px 76px");
  });
});
