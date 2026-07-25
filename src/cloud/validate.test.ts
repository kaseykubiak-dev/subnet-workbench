import { describe, expect, it } from "vitest";
import {
  azureRulesFittingPrefix,
  isDeployable,
  stableSortBySeverity,
  validateCloudSubnet,
  type CloudFinding,
} from "./validate";

/** Collapse findings to a single searchable string. */
function text(findings: CloudFinding[]): string {
  return findings.map((f) => f.message).join("\n");
}

function errors(findings: CloudFinding[]): CloudFinding[] {
  return findings.filter((f) => f.severity === "error");
}

function warnings(findings: CloudFinding[]): CloudFinding[] {
  return findings.filter((f) => f.severity === "warning");
}

/** Sizing errors only, ignoring the NSG/UDR constraint findings. */
function sizeErrors(findings: CloudFinding[], source: string): CloudFinding[] {
  return errors(findings).filter(
    (f) => f.source === source && /too small|too large/.test(f.message)
  );
}

describe("platform gating", () => {
  it("on-prem produces nothing, since cloud rules do not apply", () => {
    expect(validateCloudSubnet({ platform: "none", prefix: 29, name: "GatewaySubnet" })).toEqual(
      []
    );
  });

  it("reports usable count and what the platform reserves", () => {
    const findings = validateCloudSubnet({ platform: "azure", prefix: 29 });
    expect(text(findings)).toContain("3 usable of 8 total");
    expect(text(findings)).toContain("reserves 5 per subnet");
  });

  it("flags a prefix outside the platform's range and stops there", () => {
    const findings = validateCloudSubnet({ platform: "azure", prefix: 30 });
    expect(errors(findings)).toHaveLength(1);
    expect(text(findings)).toContain("Azure permits subnets from /2 to /29");
    // No usable-count line, because the size is not a legal subnet at all.
    expect(text(findings)).not.toContain("usable of");
  });

  it("a /29 is legal on Azure and rejected on AWS", () => {
    expect(isDeployable(validateCloudSubnet({ platform: "azure", prefix: 29 }))).toBe(true);
    expect(isDeployable(validateCloudSubnet({ platform: "aws", prefix: 29 }))).toBe(false);
  });
});

describe("rule size checking", () => {
  it("hard-fails below the minimum", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "GatewaySubnet",
      prefix: 29,
    });
    const failure = errors(findings).find((f) => f.source === "GatewaySubnet")!;
    expect(failure.message).toContain("requires /27 or larger");
    expect(failure.message).toContain("/29 is too small");
    expect(isDeployable(findings)).toBe(false);
  });

  it("accepts the exact minimum", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "GatewaySubnet",
      prefix: 27,
    });
    expect(errors(findings).some((f) => f.message.includes("too small"))).toBe(false);
  });

  it("warns, not fails, between the recommendation and the minimum", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "App Service VNet integration",
      prefix: 28,
    });
    expect(errors(findings).some((f) => f.source === "App Service VNet integration")).toBe(false);
    const warning = warnings(findings).find((f) => f.message.includes("recommended"))!;
    expect(warning.message).toContain("below the recommended /26");
  });

  it("flags a subnet larger than the rule's maximum size", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "DNS Private Resolver inbound endpoint",
      prefix: 22,
    });
    const failure = errors(findings).find((f) => f.message.includes("maximum size"))!;
    expect(failure.message).toContain("maximum size of /24");
    expect(failure.message).toContain("/22 is too large");
  });

  it("accepts a prefix inside both bounds", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "DNS Private Resolver inbound endpoint",
      prefix: 26,
    });
    expect(isDeployable(findings)).toBe(true);
  });
});

describe("conditions", () => {
  const hubFirewall = "Azure Firewall is deployed in the hub";

  it("are inert when not active", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "Virtual WAN hub",
      prefix: 23,
    });
    expect(sizeErrors(findings, "Virtual WAN hub")).toHaveLength(0);
  });

  it("tighten the requirement when active", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "Virtual WAN hub",
      prefix: 23,
      activeConditions: [hubFirewall],
    });
    const failure = errors(findings).find((f) => f.source === "Virtual WAN hub")!;
    expect(failure.message).toContain("requires /22 or larger");
    expect(failure.message).toContain("Secured virtual hub");
  });

  it("carry the reason only when a condition actually did the tightening", () => {
    const plain = validateCloudSubnet({
      platform: "azure",
      name: "Virtual WAN hub",
      prefix: 26,
    });
    const failure = errors(plain).find((f) => f.source === "Virtual WAN hub")!;
    expect(failure.message).toContain("requires /24 or larger");
    expect(failure.message).not.toContain("(");
  });

  it("an unrecognized condition string changes nothing", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "Virtual WAN hub",
      prefix: 23,
      activeConditions: ["some condition nobody encoded"],
    });
    expect(sizeErrors(findings, "Virtual WAN hub")).toHaveLength(0);
  });

  it("multi-plan subnet join raises App Service from /28 to /26", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "App Service VNet integration",
      prefix: 28,
      activeConditions: ["multi-plan subnet join (MPSJ)"],
    });
    const failure = errors(findings).find((f) => f.source === "App Service VNet integration")!;
    expect(failure.message).toContain("requires /26 or larger");
  });
});

describe("rule context", () => {
  it("NSG unsupported warns by default, since nothing is being attached yet", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "AzureFirewallSubnet",
      prefix: 26,
    });
    expect(warnings(findings).some((f) => f.message.includes("does not support NSGs"))).toBe(true);
    // A correctly sized AzureFirewallSubnet must not read as undeployable.
    expect(isDeployable(findings)).toBe(true);
  });

  it("NSG unsupported becomes an error once the plan says it attaches one", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "AzureFirewallSubnet",
      prefix: 26,
      attachesNsg: true,
    });
    const failure = errors(findings).find((f) => f.message.includes("does not support NSGs"))!;
    expect(failure.message).toContain("this plan attaches one");
    expect(isDeployable(findings)).toBe(false);
  });

  it("attaching a UDR to a subnet that forbids one is an error", () => {
    const clean = validateCloudSubnet({
      platform: "azure",
      name: "RouteServerSubnet",
      prefix: 26,
    });
    const attached = validateCloudSubnet({
      platform: "azure",
      name: "RouteServerSubnet",
      prefix: 26,
      attachesUdr: true,
    });
    expect(isDeployable(clean)).toBe(true);
    expect(
      errors(attached).some((f) => f.message.includes("does not support user-defined routes"))
    ).toBe(true);
  });

  it("the attach flags do not upgrade a subnet that permits NSGs or UDRs", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "App Service VNet integration",
      prefix: 26,
      attachesNsg: true,
      attachesUdr: true,
    });
    expect(isDeployable(findings)).toBe(true);
  });

  it("NSG required-rules is a warning, since an NSG is legal but load-bearing", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "AzureBastionSubnet",
      prefix: 26,
    });
    expect(errors(findings)).toHaveLength(0);
    expect(warnings(findings).some((f) => f.message.includes("every required rule"))).toBe(true);
  });

  it("UDR unsupported is a warning", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "RouteServerSubnet",
      prefix: 26,
    });
    expect(
      warnings(findings).some((f) => f.message.includes("does not support user-defined routes"))
    ).toBe(true);
  });

  it("surfaces the required delegation as info", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "App Service VNet integration",
      prefix: 26,
    });
    expect(text(findings)).toContain("delegated to Microsoft.Web/serverFarms");
  });

  it("carries every note from the matched rule", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "AzureBastionSubnet",
      prefix: 26,
    });
    expect(text(findings)).toContain("2 November 2021");
    expect(text(findings)).toContain("Developer SKU");
  });
});

describe("name matching", () => {
  it("an unknown name produces platform findings only", () => {
    const findings = validateCloudSubnet({ platform: "azure", name: "web-tier", prefix: 24 });
    expect(findings.every((f) => f.source === "azure")).toBe(true);
  });

  it("an empty or whitespace name is treated as no name", () => {
    const blank = validateCloudSubnet({ platform: "azure", name: "   ", prefix: 24 });
    const none = validateCloudSubnet({ platform: "azure", prefix: 24 });
    expect(blank).toEqual(none);
  });

  it("trims surrounding whitespace before matching", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "  GatewaySubnet  ",
      prefix: 29,
    });
    expect(errors(findings).some((f) => f.source === "GatewaySubnet")).toBe(true);
  });

  it("a casing near-miss warns rather than fails, since case sensitivity is unverified", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "Gatewaysubnet",
      prefix: 27,
    });
    const warning = warnings(findings).find((f) => f.message.includes("capitalization"))!;
    expect(warning.message).toContain('use "GatewaySubnet"');
    expect(isDeployable(findings)).toBe(true);
    expect(errors(findings)).toHaveLength(0);
  });

  it("a near-miss still gets the canonical rule's own sizing check", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "Gatewaysubnet",
      prefix: 29,
    });
    expect(errors(findings).some((f) => f.message.includes("requires /27 or larger"))).toBe(true);
  });

  it("name rules are Azure-only; AWS subnets are user-named", () => {
    const findings = validateCloudSubnet({
      platform: "aws",
      name: "GatewaySubnet",
      prefix: 28,
    });
    expect(findings.every((f) => f.source === "aws")).toBe(true);
  });
});

describe("ordering and deployability", () => {
  it("errors come first, then warnings, then info", () => {
    const findings = validateCloudSubnet({
      platform: "azure",
      name: "GatewaySubnet",
      prefix: 29,
    });
    const rank = { error: 0, warning: 1, info: 2 } as const;
    const ranks = findings.map((f) => rank[f.severity]);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("insertion order is preserved inside each severity band", () => {
    const input: CloudFinding[] = [
      { severity: "info", message: "i1", source: "s" },
      { severity: "error", message: "e1", source: "s" },
      { severity: "info", message: "i2", source: "s" },
      { severity: "warning", message: "w1", source: "s" },
      { severity: "error", message: "e2", source: "s" },
    ];
    expect(stableSortBySeverity(input).map((f) => f.message)).toEqual([
      "e1",
      "e2",
      "w1",
      "i1",
      "i2",
    ]);
  });

  it("isDeployable ignores warnings and info", () => {
    expect(
      isDeployable([
        { severity: "warning", message: "w", source: "s" },
        { severity: "info", message: "i", source: "s" },
      ])
    ).toBe(true);
    expect(isDeployable([{ severity: "error", message: "e", source: "s" }])).toBe(false);
    expect(isDeployable([])).toBe(true);
  });
});

describe("azureRulesFittingPrefix", () => {
  it("answers what a block could be used for", () => {
    const names = azureRulesFittingPrefix(26).map((r) => r.name);
    expect(names).toContain("AzureFirewallSubnet");
    expect(names).toContain("AzureBastionSubnet");
    expect(names).toContain("RouteServerSubnet");
    expect(names).toContain("DNS Private Resolver inbound endpoint");
    // /26 is too small for a Virtual WAN hub or an App Gateway v2 subnet.
    expect(names).not.toContain("Virtual WAN hub");
    expect(names).not.toContain("Application Gateway v2 subnet");
  });

  it("respects the rules that also have a maximum size", () => {
    const names = azureRulesFittingPrefix(23).map((r) => r.name);
    expect(names).toContain("Virtual WAN hub");
    expect(names).not.toContain("DNS Private Resolver inbound endpoint");
  });

  it("a /28 fits only the smallest dedicated subnets", () => {
    const names = azureRulesFittingPrefix(28).map((r) => r.name);
    expect(names).toEqual([
      "App Service VNet integration",
      "DNS Private Resolver inbound endpoint",
      "DNS Private Resolver outbound endpoint",
    ]);
  });

  it("returns nothing for a subnet too small for any dedicated service", () => {
    expect(azureRulesFittingPrefix(29)).toEqual([]);
  });
});
