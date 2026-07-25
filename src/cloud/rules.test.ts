import { describe, expect, it } from "vitest";
import {
  AWS_SERVICE_RULES,
  AWS_VPC_LIMITS,
  AZURE_BASTION_NSG_RULES,
  AZURE_SUBNET_RULES,
  AZURE_VNET_LIMITS,
  azureRuleByName,
  azureRuleByNameInsensitive,
  reservedAzureSubnetNames,
} from "./rules";

describe("Azure subnet rule table shape", () => {
  it("names are unique", () => {
    const names = AZURE_SUBNET_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every rule carries a purpose and at least one note", () => {
    for (const rule of AZURE_SUBNET_RULES) {
      expect(rule.purpose.length, rule.name).toBeGreaterThan(0);
      expect(rule.notes.length, rule.name).toBeGreaterThan(0);
    }
  });

  it("prefix fields stay internally consistent", () => {
    for (const rule of AZURE_SUBNET_RULES) {
      expect(rule.maxPrefix, rule.name).toBeGreaterThanOrEqual(0);
      expect(rule.maxPrefix, rule.name).toBeLessThanOrEqual(32);
      if (rule.minPrefix !== undefined) {
        // minPrefix is the smaller number (the larger block).
        expect(rule.minPrefix, rule.name).toBeLessThanOrEqual(rule.maxPrefix);
      }
      if (rule.recommendedMaxPrefix !== undefined) {
        // A recommendation can never be looser than the hard minimum.
        expect(rule.recommendedMaxPrefix, rule.name).toBeLessThanOrEqual(rule.maxPrefix);
      }
      for (const condition of rule.conditions ?? []) {
        // Conditions only ever tighten.
        expect(condition.maxPrefix, `${rule.name}: ${condition.when}`).toBeLessThanOrEqual(
          rule.maxPrefix
        );
        expect(condition.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("every corrected row explains what it corrects", () => {
    const corrected = AZURE_SUBNET_RULES.filter((r) => r.corrects !== undefined);
    expect(corrected.length).toBeGreaterThanOrEqual(4);
    for (const rule of corrected) {
      expect(rule.corrects!.length, rule.name).toBeGreaterThan(20);
    }
  });
});

describe("the four corrections against the planning doc", () => {
  it("GatewaySubnet is /27, not the commonly cited /29", () => {
    const rule = azureRuleByName("GatewaySubnet")!;
    expect(rule.maxPrefix).toBe(27);
    expect(rule.nsg).toBe("unsupported");
    expect(rule.udr).toBe("unsupported");
    expect(rule.corrects).toBeDefined();
  });

  it("AzureFirewallSubnet is /26 with no /24 recommendation", () => {
    const rule = azureRuleByName("AzureFirewallSubnet")!;
    expect(rule.maxPrefix).toBe(26);
    expect(rule.recommendedMaxPrefix).toBeUndefined();
    expect(rule.nsg).toBe("unsupported");
  });

  it("RouteServerSubnet is /26, not /27", () => {
    const rule = azureRuleByName("RouteServerSubnet")!;
    expect(rule.maxPrefix).toBe(26);
    expect(rule.nsg).toBe("unsupported");
    expect(rule.udr).toBe("unsupported");
  });

  it("App Service VNet integration hard minimum is /28, with /26 recommended", () => {
    const rule = azureRuleByName("App Service VNet integration")!;
    expect(rule.maxPrefix).toBe(28);
    expect(rule.recommendedMaxPrefix).toBe(26);
    expect(rule.delegation).toBe("Microsoft.Web/serverFarms");
    expect(rule.conditions?.[0]?.maxPrefix).toBe(26);
  });
});

describe("other verified values", () => {
  it("AzureBastionSubnet is /26 and supports NSGs with required rules", () => {
    const rule = azureRuleByName("AzureBastionSubnet")!;
    expect(rule.maxPrefix).toBe(26);
    expect(rule.nsg).toBe("required-rules");
    expect(rule.udr).toBe("unsupported");
  });

  it("both DNS Private Resolver subnets have a maximum size as well as a minimum", () => {
    for (const name of [
      "DNS Private Resolver inbound endpoint",
      "DNS Private Resolver outbound endpoint",
    ]) {
      const rule = azureRuleByName(name)!;
      expect(rule.minPrefix, name).toBe(24);
      expect(rule.maxPrefix, name).toBe(28);
      expect(rule.delegation, name).toBe("Microsoft.Network/dnsResolvers");
    }
  });

  it("the Virtual WAN hub tightens to /22 when a firewall is deployed", () => {
    const rule = azureRuleByName("Virtual WAN hub")!;
    expect(rule.maxPrefix).toBe(24);
    expect(rule.conditions).toHaveLength(1);
    expect(rule.conditions?.[0]?.maxPrefix).toBe(22);
  });
});

describe("name lookup", () => {
  it("exact lookup is case-sensitive", () => {
    expect(azureRuleByName("GatewaySubnet")).toBeDefined();
    expect(azureRuleByName("Gatewaysubnet")).toBeUndefined();
    expect(azureRuleByName("gatewaysubnet")).toBeUndefined();
  });

  it("insensitive lookup catches near-miss casing and returns the canonical rule", () => {
    expect(azureRuleByNameInsensitive("Gatewaysubnet")?.name).toBe("GatewaySubnet");
    expect(azureRuleByNameInsensitive("AZUREBASTIONSUBNET")?.name).toBe("AzureBastionSubnet");
  });

  it("insensitive lookup still misses a genuinely different name", () => {
    expect(azureRuleByNameInsensitive("AzureFirewall-Subnet")).toBeUndefined();
    expect(azureRuleByNameInsensitive("web-tier")).toBeUndefined();
  });

  it("reserved names are the subset Azure actually mandates", () => {
    const reserved = reservedAzureSubnetNames();
    expect(reserved).toContain("GatewaySubnet");
    expect(reserved).toContain("AzureBastionSubnet");
    expect(reserved).not.toContain("App Service VNet integration");
    expect(reserved.length).toBeLessThan(AZURE_SUBNET_RULES.length);
  });
});

describe("AWS service rules", () => {
  it("names are unique and every rule carries a note", () => {
    const names = AWS_SERVICE_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const rule of AWS_SERVICE_RULES) {
      expect(rule.notes.length, rule.name).toBeGreaterThan(0);
    }
  });

  it("ALB carries both a prefix and a free-address count", () => {
    const alb = AWS_SERVICE_RULES.find((r) => r.name === "Application Load Balancer")!;
    expect(alb.maxPrefix).toBe(27);
    expect(alb.minFreeAddresses).toBe(8);
    expect(alb.minAvailabilityZones).toBe(2);
  });

  it("NLB carries no prefix and no free-address count, since AWS publishes neither", () => {
    const nlb = AWS_SERVICE_RULES.find((r) => r.name === "Network Load Balancer")!;
    expect(nlb.maxPrefix).toBeUndefined();
    // The "NLB needs 8 free addresses" claim is secondary-source only.
    expect(nlb.minFreeAddresses).toBeUndefined();
    expect(nlb.consumesPerSubnet).toBe(1);
    expect(nlb.minAvailabilityZones).toBe(1);
  });

  it("rows with no published size say so rather than inventing one", () => {
    const rds = AWS_SERVICE_RULES.find((r) => r.name === "RDS DB subnet group")!;
    expect(rds.maxPrefix).toBeUndefined();
    expect(rds.minFreeAddresses).toBeUndefined();
    expect(rds.notes.join(" ")).toMatch(/no minimum/i);
  });

  it("every documented prefix is a legal AWS subnet size", () => {
    for (const rule of AWS_SERVICE_RULES) {
      if (rule.maxPrefix === undefined) continue;
      expect(rule.maxPrefix, rule.name).toBeLessThanOrEqual(AWS_VPC_LIMITS.vpcMaxPrefix);
      expect(rule.maxPrefix, rule.name).toBeGreaterThanOrEqual(AWS_VPC_LIMITS.vpcMinPrefix);
    }
  });
});

describe("Azure Bastion NSG rules", () => {
  it("there are exactly eight, and omitting any one breaks Bastion", () => {
    expect(AZURE_BASTION_NSG_RULES).toHaveLength(8);
  });

  it("splits four inbound and four outbound", () => {
    const inbound = AZURE_BASTION_NSG_RULES.filter((r) => r.direction === "inbound");
    const outbound = AZURE_BASTION_NSG_RULES.filter((r) => r.direction === "outbound");
    expect(inbound).toHaveLength(4);
    expect(outbound).toHaveLength(4);
  });

  it("22 and 3389 appear outbound only, never inbound", () => {
    for (const rule of AZURE_BASTION_NSG_RULES) {
      if (/\b(22|3389)\b/.test(rule.ports)) {
        expect(rule.direction, rule.name).toBe("outbound");
      }
    }
  });

  it("includes the outbound port 80 rule that is most often forgotten", () => {
    const http = AZURE_BASTION_NSG_RULES.find((r) => r.name === "AllowHttpOutbound")!;
    expect(http.direction).toBe("outbound");
    expect(http.ports).toBe("80");
    expect(http.destination).toBe("Internet");
  });

  it("rule names are unique and each carries a reason", () => {
    const names = AZURE_BASTION_NSG_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const rule of AZURE_BASTION_NSG_RULES) {
      expect(rule.reason.length, rule.name).toBeGreaterThan(0);
    }
  });
});

describe("structural limits", () => {
  it("an Azure VNet caps at 65,536 private addresses regardless of prefix", () => {
    expect(AZURE_VNET_LIMITS.privateAddressesPerVnet).toBe(65536);
    expect(AZURE_VNET_LIMITS.subnetsPerVnet).toBe(3000);
    expect(AZURE_VNET_LIMITS.ipv6SubnetPrefix).toBe(64);
  });

  it("AWS VPC CIDR bounds are /16 to /28", () => {
    expect(AWS_VPC_LIMITS.vpcMinPrefix).toBe(16);
    expect(AWS_VPC_LIMITS.vpcMaxPrefix).toBe(28);
    expect(AWS_VPC_LIMITS.suggestedSecondaryRange).toBe("100.64.0.0/10");
  });
});
