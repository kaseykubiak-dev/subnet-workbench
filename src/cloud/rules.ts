/**
 * Subnet Workbench: platform subnet rules (pure data).
 *
 * Azure reserves a handful of subnet names for platform services and enforces
 * a minimum size for each. Getting one wrong is a deployment failure, so these
 * figures were verified against current Microsoft Learn documentation on
 * 2026-07-25 rather than carried over from memory. Four of them differ from
 * what is commonly repeated in blog posts and in this project's own planning
 * doc; those rows carry a `corrects` note saying what the wrong value was.
 *
 * Prefix fields use raw prefix numbers, matching platforms.ts:
 *   maxPrefix           largest prefix number permitted = the MINIMUM SIZE
 *   minPrefix           smallest prefix number permitted = the MAXIMUM SIZE
 *   recommendedMaxPrefix  warn between this and maxPrefix, do not fail
 *
 * So GatewaySubnet's maxPrefix of 27 means "/27 or larger"; a /28 is a hard
 * failure and a /24 is fine.
 */

/** Whether a platform service permits NSGs or UDRs on its dedicated subnet. */
export type SupportLevel =
  | "supported"
  | "required-rules"
  | "unsupported"
  | "unverified";

/** A sizing requirement that only applies in a particular configuration. */
export interface RuleCondition {
  /** The situation that triggers this requirement. */
  when: string;
  /** Largest prefix number permitted while the condition holds. */
  maxPrefix: number;
  reason: string;
}

export interface CloudSubnetRule {
  /** Exact name the platform requires, or a descriptive name when user-named. */
  name: string;
  /** True when the platform mandates this exact name. */
  nameIsReserved: boolean;
  purpose: string;
  maxPrefix: number;
  minPrefix?: number;
  recommendedMaxPrefix?: number;
  conditions?: RuleCondition[];
  nsg: SupportLevel;
  udr: SupportLevel;
  /** Required subnet delegation, when the service needs one. */
  delegation?: string;
  notes: string[];
  /** What this row corrects, when it contradicts commonly repeated guidance. */
  corrects?: string;
}

/**
 * Azure dedicated subnets.
 *
 * Ordered roughly by how often they show up in a hub VNet, since this list
 * doubles as the picker order in the UI.
 */
export const AZURE_SUBNET_RULES: CloudSubnetRule[] = [
  {
    name: "GatewaySubnet",
    nameIsReserved: true,
    purpose: "VPN Gateway and ExpressRoute Gateway",
    maxPrefix: 27,
    nsg: "unsupported",
    udr: "unsupported",
    notes: [
      "/29 is accepted only by the Basic SKU, which Microsoft positions as dev/test. Every other SKU requires /27 or larger.",
      "Must be deleted and recreated to resize; it cannot be resized in place like an ordinary subnet.",
    ],
    corrects:
      "Commonly cited as a /29 minimum with /27 merely recommended. /27 is the actual minimum for any production SKU.",
  },
  {
    name: "AzureFirewallSubnet",
    nameIsReserved: true,
    purpose: "Azure Firewall data plane",
    maxPrefix: 26,
    nsg: "unsupported",
    udr: "supported",
    notes: [
      "Microsoft's FAQ states a /26 is sufficient for all scaling scenarios; the subnet does not need to grow as the firewall scales.",
      "Subnet-level NSGs are disabled here to prevent service interruptions. The firewall uses platform NIC-level NSGs you cannot see.",
    ],
    corrects:
      "Often paired with a /24 recommendation for scale headroom. Microsoft explicitly says /26 covers all scaling, so /24 wastes 192 addresses per firewall.",
  },
  {
    name: "AzureFirewallManagementSubnet",
    nameIsReserved: true,
    purpose: "Azure Firewall management plane",
    maxPrefix: 26,
    nsg: "unsupported",
    udr: "supported",
    notes: [
      "Required whenever the Management NIC is enabled. Forced tunneling requires the Management NIC, but the NIC can also be enabled on its own to avoid a data-plane public IP.",
      "Enabling the Management NIC is also the only way to keep DNAT, which is unsupported with forced tunneling.",
    ],
    corrects:
      "Usually described as forced-tunneling-only. Forced tunneling is one trigger, not the only one.",
  },
  {
    name: "AzureBastionSubnet",
    nameIsReserved: true,
    purpose: "Azure Bastion host",
    maxPrefix: 26,
    nsg: "required-rules",
    udr: "unsupported",
    notes: [
      "The /26 minimum applies to Bastion deployed on or after 2 November 2021. Pre-existing /27 subnets continue to function.",
      "The Developer SKU needs no subnet at all.",
      "NSGs are supported here, but attaching one means creating all eight required rules or Bastion breaks. See AZURE_BASTION_NSG_RULES.",
    ],
  },
  {
    name: "RouteServerSubnet",
    nameIsReserved: true,
    purpose: "Azure Route Server",
    maxPrefix: 26,
    nsg: "unsupported",
    udr: "unsupported",
    notes: ["Neither NSGs nor user-defined routes are supported on this subnet."],
    corrects:
      "Commonly cited as /27. Current documentation states /26 in two separate places.",
  },
  {
    name: "Application Gateway v2 subnet",
    nameIsReserved: false,
    purpose: "Application Gateway v2 (Standard_v2 / WAF_v2)",
    maxPrefix: 24,
    recommendedMaxPrefix: 24,
    nsg: "required-rules",
    udr: "supported",
    notes: [
      "A /24 is highly recommended rather than required. Capacity is subnet size minus 5 reserved, minus the maximum instance count for the gateway (up to 125), minus 1 for each gateway with a private frontend IP.",
      "v1 / Standard is a /26 recommendation with a 32-instance ceiling.",
      "Dedicated to Application Gateway; do not mix other resources into it.",
    ],
  },
  {
    name: "Virtual WAN hub",
    nameIsReserved: false,
    purpose: "Virtual WAN hub address space",
    maxPrefix: 24,
    recommendedMaxPrefix: 23,
    conditions: [
      {
        when: "Azure Firewall is deployed in the hub",
        maxPrefix: 22,
        reason: "Secured virtual hub requires additional address space for the firewall.",
      },
    ],
    nsg: "unsupported",
    udr: "unsupported",
    notes: [
      "Hub address space is immutable after creation, so undersizing here is not recoverable without rebuilding the hub.",
    ],
  },
  {
    name: "App Service VNet integration",
    nameIsReserved: false,
    purpose: "Regional VNet integration for App Service plans",
    maxPrefix: 28,
    recommendedMaxPrefix: 26,
    delegation: "Microsoft.Web/serverFarms",
    conditions: [
      {
        when: "multi-plan subnet join (MPSJ)",
        maxPrefix: 26,
        reason: "Joining multiple App Service plans to one subnet requires a /26 or larger.",
      },
    ],
    nsg: "supported",
    udr: "supported",
    notes: [
      "The hard minimum is /28. Creating the subnet through the portal during integration produces a /27; an existing /28 is accepted.",
      "/26 is a recommendation for scale, and a hard requirement only for multi-plan subnet join.",
      "The subnet is consumed entirely by the integration and cannot host other resources.",
    ],
    corrects:
      "Frequently cited as a /26 minimum, which would reject legal /28 and /27 designs.",
  },
  {
    name: "DNS Private Resolver inbound endpoint",
    nameIsReserved: false,
    purpose: "Azure DNS Private Resolver inbound endpoint",
    maxPrefix: 28,
    minPrefix: 24,
    delegation: "Microsoft.Network/dnsResolvers",
    nsg: "supported",
    udr: "supported",
    notes: [
      "Inbound and outbound endpoints each need their own dedicated subnet; they cannot share one.",
      "Unusually, this subnet has a maximum size as well as a minimum: between /28 and /24.",
    ],
  },
  {
    name: "DNS Private Resolver outbound endpoint",
    nameIsReserved: false,
    purpose: "Azure DNS Private Resolver outbound endpoint",
    maxPrefix: 28,
    minPrefix: 24,
    delegation: "Microsoft.Network/dnsResolvers",
    nsg: "supported",
    udr: "supported",
    notes: [
      "Separate from the inbound endpoint subnet; the two cannot be combined.",
      "Between /28 and /24, same as the inbound endpoint.",
    ],
  },
];

/**
 * AWS service subnet requirements.
 *
 * AWS documents most of these as a free-address count rather than a prefix
 * length, which is a meaningfully different contract. Where AWS gives a count,
 * `minFreeAddresses` carries it and `maxPrefix` is only set when AWS actually
 * publishes a prefix. Rows where no size is documented say so rather than
 * inventing one.
 */
export interface AwsServiceRule {
  name: string;
  purpose: string;
  /** Largest prefix number AWS documents, when it documents one at all. */
  maxPrefix?: number;
  /** Free addresses AWS requires in each subnet, when documented as a count. */
  minFreeAddresses?: number;
  /** Minimum distinct Availability Zones. */
  minAvailabilityZones?: number;
  /** Addresses the service itself consumes per subnet. */
  consumesPerSubnet?: number;
  notes: string[];
}

export const AWS_SERVICE_RULES: AwsServiceRule[] = [
  {
    name: "Application Load Balancer",
    purpose: "ALB subnets",
    maxPrefix: 27,
    minFreeAddresses: 8,
    minAvailabilityZones: 2,
    notes: [
      "Both constraints apply: a /27 or larger bitmask AND at least 8 free addresses in each subnet.",
      "One subnet per Availability Zone, across at least two zones.",
    ],
  },
  {
    name: "Network Load Balancer",
    purpose: "NLB subnets",
    consumesPerSubnet: 1,
    minAvailabilityZones: 1,
    notes: [
      "AWS publishes the /27-and-8-free-addresses scaling requirement for ALB only. The widely repeated claim that it applies to NLB could not be traced to AWS documentation, so it is not encoded here.",
      "What AWS does document: one address per enabled Availability Zone, one subnet per zone.",
      "Unlike ALB, a single Availability Zone is permitted.",
    ],
  },
  {
    name: "Transit Gateway attachment",
    purpose: "VPC attachment subnets",
    maxPrefix: 28,
    consumesPerSubnet: 1,
    minAvailabilityZones: 1,
    notes: [
      "The attachment places one ENI consuming one address per subnet, one subnet per Availability Zone.",
      "AWS recommends a dedicated /28 per attachment subnet, ideally carved from a secondary non-routable CIDR to preserve routable space.",
    ],
  },
  {
    name: "NAT Gateway",
    purpose: "NAT Gateway subnet",
    consumesPerSubnet: 1,
    notes: [
      "A public NAT Gateway must sit in a public subnet and requires an Elastic IP at creation; a private NAT Gateway cannot have one.",
      "Supports up to 8 associated addresses (1 primary plus 7 secondary), so consumption rises if secondaries are assigned.",
      "AWS publishes no minimum subnet size for NAT Gateway.",
    ],
  },
  {
    name: "EKS cluster subnet",
    purpose: "Amazon EKS control plane and node subnets",
    maxPrefix: 28,
    minFreeAddresses: 6,
    minAvailabilityZones: 2,
    notes: [
      "At least 6 free addresses per subnet, 16 recommended, across at least two Availability Zones.",
      "The best-practices guide recommends /28 as a floor because EKS creates up to 4 cross-account ENIs and adds more during upgrades.",
      "The default VPC CNI gives every pod a routable VPC address, the direct parallel to Azure CNI. Prefix delegation, custom networking on a secondary CIDR, IPv6, or a third-party overlay CNI each change the math substantially.",
    ],
  },
  {
    name: "PrivateLink interface endpoint",
    purpose: "Interface VPC endpoints",
    consumesPerSubnet: 1,
    notes: [
      "One ENI and one private address per subnet per Availability Zone, one subnet per zone.",
      "VPC Lattice service-network endpoints are the exception: they consume a full /28 per Availability Zone.",
    ],
  },
  {
    name: "RDS DB subnet group",
    purpose: "Amazon RDS instances",
    minAvailabilityZones: 2,
    notes: [
      "At least two subnets in two different Availability Zones in the same region.",
      "AWS publishes no minimum subnet prefix or address count for RDS.",
    ],
  },
];

/**
 * The eight NSG rules Azure Bastion requires when an NSG is attached to
 * AzureBastionSubnet. Omitting any one of them breaks Bastion, which is why
 * this is worth encoding rather than linking out to.
 *
 * Note that 22 and 3389 are NOT needed inbound; they are outbound only.
 */
export interface NsgRule {
  direction: "inbound" | "outbound";
  name: string;
  source: string;
  destination: string;
  ports: string;
  reason: string;
}

export const AZURE_BASTION_NSG_RULES: NsgRule[] = [
  {
    direction: "inbound",
    name: "AllowHttpsInbound",
    source: "Internet",
    destination: "AzureBastionSubnet",
    ports: "443",
    reason: "Client connections reach Bastion over the public IP.",
  },
  {
    direction: "inbound",
    name: "AllowGatewayManagerInbound",
    source: "GatewayManager",
    destination: "AzureBastionSubnet",
    ports: "443",
    reason: "Control plane access for the Bastion service.",
  },
  {
    direction: "inbound",
    name: "AllowAzureLoadBalancerInbound",
    source: "AzureLoadBalancer",
    destination: "AzureBastionSubnet",
    ports: "443",
    reason: "Health probes.",
  },
  {
    direction: "inbound",
    name: "AllowBastionHostCommunication",
    source: "VirtualNetwork",
    destination: "VirtualNetwork",
    ports: "8080, 5701",
    reason: "Data plane communication between the Bastion instances themselves.",
  },
  {
    direction: "outbound",
    name: "AllowSshRdpOutbound",
    source: "AzureBastionSubnet",
    destination: "VirtualNetwork",
    ports: "22, 3389",
    reason: "Bastion reaching the target VMs. These ports are outbound only, never inbound.",
  },
  {
    direction: "outbound",
    name: "AllowAzureCloudOutbound",
    source: "AzureBastionSubnet",
    destination: "AzureCloud",
    ports: "443",
    reason: "Dependencies on Azure platform services.",
  },
  {
    direction: "outbound",
    name: "AllowBastionCommunication",
    source: "VirtualNetwork",
    destination: "VirtualNetwork",
    ports: "8080, 5701",
    reason: "The outbound half of instance-to-instance communication.",
  },
  {
    direction: "outbound",
    name: "AllowHttpOutbound",
    source: "AzureBastionSubnet",
    destination: "Internet",
    ports: "80",
    reason: "Session and certificate validation. The rule most often forgotten.",
  },
];

/**
 * Azure VNet structural limits.
 *
 * The address count is the real ceiling: a VNet caps out at 65,536 private
 * addresses, which is why a VNet is effectively a /16 of usable space even
 * though a larger prefix parses.
 */
export const AZURE_VNET_LIMITS = {
  subnetsPerVnet: 3000,
  privateAddressesPerVnet: 65536,
  /** IPv6 subnets in Azure must be exactly /64; no other length is accepted. */
  ipv6SubnetPrefix: 64,
} as const;

/** AWS VPC structural limits. */
export const AWS_VPC_LIMITS = {
  /** VPC CIDR bounds (prefix numbers). */
  vpcMinPrefix: 16,
  vpcMaxPrefix: 28,
  /** Default quota; adjustable via support request. */
  ipv4CidrBlocksPerVpc: 5,
  ipv6CidrBlocksPerVpc: 5,
  /**
   * RFC 6598 shared address space. AWS suggests it as a secondary VPC range
   * because it rarely collides with corporate RFC 1918 addressing.
   */
  suggestedSecondaryRange: "100.64.0.0/10",
} as const;

/** Find an Azure rule by its exact name. Case-sensitive by design. */
export function azureRuleByName(name: string): CloudSubnetRule | undefined {
  return AZURE_SUBNET_RULES.find((r) => r.name === name);
}

/**
 * Find an Azure rule ignoring case, used to detect near-miss casing like
 * "Gatewaysubnet". Returns the canonical rule so the caller can report the
 * correct spelling.
 */
export function azureRuleByNameInsensitive(
  name: string
): CloudSubnetRule | undefined {
  const lowered = name.toLowerCase();
  return AZURE_SUBNET_RULES.find((r) => r.name.toLowerCase() === lowered);
}

/** The Azure subnets whose names the platform actually reserves. */
export function reservedAzureSubnetNames(): string[] {
  return AZURE_SUBNET_RULES.filter((r) => r.nameIsReserved).map((r) => r.name);
}
