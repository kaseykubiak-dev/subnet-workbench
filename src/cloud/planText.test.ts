import { describe, expect, it } from "vitest";

import { IMPLICIT_REGION_NAME, parsePlanText } from "./planText";
import { blockCidr, validatePlan } from "./hierarchy";

/** The worked example from the hierarchy mockup, in the documented format. */
const WORKED = `region eastus 10.20.0.0/14
  vnet hub 10.20.0.0/22
    GatewaySubnet        10.20.0.0/27
    AzureFirewallSubnet  10.20.0.64/26
    AzureBastionSubnet   10.20.0.128/26
  vnet prod-aks 10.20.8.0/21
    aks-nodes            10.20.8.0/22
    endpoints            10.20.12.0/24

region westus2 10.24.0.0/14
  vnet dr-hub 10.31.0.0/22

external on-prem-datacenter 10.20.8.0/22  # ExpressRoute`;

describe("parsePlanText", () => {
  it("builds the whole three-level tree from the worked example", () => {
    const { plan, errors } = parsePlanText(WORKED, "azure");
    expect(errors).toEqual([]);
    expect(plan.platform).toBe("azure");
    expect(plan.regions.map((r) => r.name)).toEqual(["eastus", "westus2"]);
    const eastus = plan.regions[0];
    expect(eastus?.vnets.map((v) => v.name)).toEqual(["hub", "prod-aks"]);
    expect(eastus?.vnets[0]?.subnets.map((s) => s.name)).toEqual([
      "GatewaySubnet",
      "AzureFirewallSubnet",
      "AzureBastionSubnet",
    ]);
    expect(blockCidr(eastus?.vnets[1]?.subnets[0] ?? { network: 0, prefix: 0 })).toBe(
      "10.20.8.0/22"
    );
  });

  it("reproduces the mockup's finding count end to end", () => {
    // One external collision on prod-aks, one dr-hub outside its supernet.
    const report = validatePlan(parsePlanText(WORKED, "azure").plan);
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f) => f.kind)).toEqual([
      "external-collision",
      "vnet-outside-region",
    ]);
  });

  it("keeps a trailing comment as the external range's consequence text", () => {
    const { plan } = parsePlanText(WORKED, "azure");
    expect(plan.external?.[0]?.name).toBe("on-prem-datacenter");
    expect(plan.external?.[0]?.detail).toBe("ExpressRoute");
  });

  it("takes structure from indentation when the keywords are missing", () => {
    // What survives a paste out of a spreadsheet.
    const { plan, errors } = parsePlanText(
      ["eastus 10.20.0.0/14", "  hub 10.20.0.0/22", "    GatewaySubnet 10.20.0.0/27"].join("\n"),
      "azure"
    );
    expect(errors).toEqual([]);
    expect(plan.regions[0]?.name).toBe("eastus");
    expect(plan.regions[0]?.vnets[0]?.name).toBe("hub");
    expect(plan.regions[0]?.vnets[0]?.subnets[0]?.name).toBe("GatewaySubnet");
  });

  it("takes structure from keywords when the indentation is missing", () => {
    // What survives a hand-typed list.
    const { plan, errors } = parsePlanText(
      ["region eastus 10.20.0.0/14", "vnet hub 10.20.0.0/22", "subnet gw 10.20.0.0/27"].join("\n"),
      "azure"
    );
    expect(errors).toEqual([]);
    expect(plan.regions[0]?.vnets[0]?.subnets[0]?.name).toBe("gw");
  });

  it("lets a keyword override the indentation it disagrees with", () => {
    const { plan } = parsePlanText(
      ["region eastus 10.20.0.0/14", "        vnet hub 10.20.0.0/22"].join("\n"),
      "azure"
    );
    expect(plan.regions[0]?.vnets).toHaveLength(1);
    expect(plan.regions[0]?.vnets[0]?.subnets).toHaveLength(0);
  });

  it("accepts vpc and supernet as aliases, because the words differ by cloud", () => {
    const { plan } = parsePlanText(
      ["supernet us-east-1 10.0.0.0/12", "vpc prod 10.0.0.0/16"].join("\n"),
      "aws"
    );
    expect(plan.regions[0]?.name).toBe("us-east-1");
    expect(plan.regions[0]?.vnets[0]?.name).toBe("prod");
  });

  it("accepts every address notation the Overlap parser does", () => {
    const { plan, errors } = parsePlanText(
      [
        "region r 10.0.0.0/8",
        "  vnet a 10.0.0.0 255.255.0.0",
        "  vnet b 10.1.0.0/255.255.0.0",
      ].join("\n"),
      "azure"
    );
    expect(errors).toEqual([]);
    expect(plan.regions[0]?.vnets.map((v) => blockCidr(v))).toEqual([
      "10.0.0.0/16",
      "10.1.0.0/16",
    ]);
  });

  it("normalizes host bits, so a typed host address still names its block", () => {
    const { plan } = parsePlanText(
      ["region r 10.0.0.0/8", "  vnet v 10.20.3.77/14"].join("\n"),
      "azure"
    );
    expect(blockCidr(plan.regions[0]?.vnets[0] ?? { network: 0, prefix: 0 })).toBe("10.20.0.0/14");
  });

  it("hangs an orphan VNet off an implicit /0 region rather than warning about it", () => {
    // A /0 contains everything, so no "outside its supernet" finding fires for
    // a planning boundary the person never drew.
    const { plan } = parsePlanText("vnet hub 10.20.0.0/22", "azure");
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]?.name).toBe(IMPLICIT_REGION_NAME);
    expect(validatePlan(plan).findings).toEqual([]);
  });

  it("rereads a completely flat paste one level down", () => {
    // No keywords, no indentation: every line looks like a region, which would
    // leave nothing to check. These are the CIDRs somebody wants compared.
    const { plan } = parsePlanText(
      ["hub 10.20.0.0/16", "spoke 10.20.4.0/22"].join("\n"),
      "azure"
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]?.name).toBe(IMPLICIT_REGION_NAME);
    expect(plan.regions[0]?.vnets.map((v) => v.name)).toEqual(["hub", "spoke"]);
    const report = validatePlan(plan);
    expect(report.findings.map((f) => f.kind)).toEqual(["vnet-overlap"]);
  });

  it("does not reread a paste that already has VNets", () => {
    const { plan } = parsePlanText(
      ["region a 10.0.0.0/8", "  vnet x 10.0.0.0/16", "region b 11.0.0.0/8"].join("\n"),
      "azure"
    );
    expect(plan.regions.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("names an unlabelled block instead of rendering an empty row", () => {
    const { plan } = parsePlanText(
      ["region r 10.0.0.0/8", "  vnet 10.0.0.0/16"].join("\n"),
      "azure"
    );
    expect(plan.regions[0]?.vnets[0]?.name).toBe("block on line 2");
  });

  it("takes a trailing label when the name follows the CIDR", () => {
    const { plan } = parsePlanText("vnet 10.20.0.0/22 hub", "azure");
    expect(plan.regions[0]?.vnets[0]?.name).toBe("hub");
  });

  it("tolerates the trailing colon people write above an indented block", () => {
    const { plan } = parsePlanText(
      ["region eastus: 10.20.0.0/14", "  vnet hub: 10.20.0.0/22"].join("\n"),
      "azure"
    );
    expect(plan.regions[0]?.name).toBe("eastus");
    expect(plan.regions[0]?.vnets[0]?.name).toBe("hub");
  });

  it("counts a tab as two columns so mixed indentation still nests", () => {
    const { plan } = parsePlanText(
      ["region r 10.0.0.0/8", "\tvnet v 10.0.0.0/16", "\t\tsub 10.0.0.0/24"].join("\n"),
      "azure"
    );
    expect(plan.regions[0]?.vnets[0]?.subnets).toHaveLength(1);
  });

  it("reports a bad line and keeps parsing the rest", () => {
    const { plan, errors } = parsePlanText(
      [
        "region eastus 10.20.0.0/14",
        "  vnet broken 10.20.999.0/22",
        "  vnet good 10.20.8.0/21",
      ].join("\n"),
      "azure"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.lineNumber).toBe(2);
    expect(errors[0]?.raw).toBe("vnet broken 10.20.999.0/22");
    expect(plan.regions[0]?.vnets.map((v) => v.name)).toEqual(["good"]);
  });

  it("says so when a line carries no CIDR at all", () => {
    const { errors } = parsePlanText("region eastus", "azure");
    expect(errors[0]?.message).toContain("no CIDR on this line");
  });

  it("refuses to guess a parent for a subnet with no VNet above it", () => {
    const { plan, errors } = parsePlanText(
      ["region eastus 10.20.0.0/14", "subnet orphan 10.20.0.0/27"].join("\n"),
      "azure"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("needs a VNet above it");
    // The orphan is dropped, not silently promoted to a VNet of its own.
    expect(plan.regions[0]?.vnets.map((v) => v.name)).not.toContain("orphan");
  });

  it("skips blank and whole-line comment lines silently", () => {
    const { plan, errors } = parsePlanText(
      ["# the prod estate", "", "region eastus 10.20.0.0/14", "// nothing here yet"].join("\n"),
      "azure"
    );
    expect(errors).toEqual([]);
    expect(plan.regions).toHaveLength(1);
  });

  it("returns an empty plan for empty text rather than throwing", () => {
    const { plan, errors } = parsePlanText("   \n\n", "azure");
    expect(plan.regions).toEqual([]);
    expect(errors).toEqual([]);
    expect(plan.external).toBeUndefined();
    expect(validatePlan(plan).status).toBe("empty");
  });

  it("carries the platform through, since reserved-address math depends on it", () => {
    expect(parsePlanText("region r 10.0.0.0/8", "aws").plan.platform).toBe("aws");
  });
});
