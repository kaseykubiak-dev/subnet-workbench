/**
 * Subnet Workbench: service capacity modeling.
 *
 * The other cloud modules answer "is this subnet legal". This one answers the
 * question that actually causes outages: "how many addresses will this
 * workload eat". Undersized AKS and EKS node subnets are the common failure,
 * and they fail late, at scale, when renumbering is expensive.
 *
 * Two design decisions run through the whole file.
 *
 * First, every estimator returns USABLE addresses required, never a raw subnet
 * size. Converting to a prefix goes through prefixForHosts, so the
 * five-reserved-addresses rule lives in platforms.ts and nowhere else. An
 * estimator that quietly added 5 of its own would double-count.
 *
 * Second, every estimate carries its arithmetic in `breakdown`. A number with
 * no derivation is not actionable: the point is to show someone that 51 nodes
 * at 30 pods each is 1,581 addresses, not to hand them a prefix and ask for
 * trust.
 *
 * Figures verified against Microsoft and AWS documentation on 2026-07-25. The
 * places where the vendors' own docs are wrong or silent are marked inline,
 * because those are exactly the spots where a future edit would "fix" the code
 * back to being wrong.
 */

import {
  cloudUsableHosts,
  platformById,
  prefixForHosts,
  type Platform,
  type PlatformId,
} from "./platforms";

/** One line of arithmetic, so the estimate can show its work. */
export interface CapacityLine {
  label: string;
  addresses: number;
  detail?: string;
}

/**
 * A subnet this workload needs IN ADDITION to the one being estimated.
 *
 * Overlay and pod-subnet networking modes move pod addresses somewhere else
 * rather than removing them. Reporting only the node subnet would make those
 * modes look free, which is the opposite of the truth: the addresses still
 * exist and still have to not overlap anything.
 */
export interface CompanionRequirement {
  name: string;
  addresses: number;
  /** True when the range lives outside the VNet/VPC and cannot overlap it. */
  separateFromVnet: boolean;
  detail: string;
}

export interface CapacityEstimate {
  /** Usable addresses required, excluding the platform's reserved set. */
  addresses: number;
  /** Smallest prefix on this platform that fits, or null when nothing does. */
  prefix: number | null;
  breakdown: CapacityLine[];
  warnings: string[];
  companions: CompanionRequirement[];
}

/* -------------------------------------------------------------------------- */
/* AKS                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * AKS networking modes, which differ by orders of magnitude in what they take
 * from the node subnet. This is the single most consequential input in the
 * whole tool.
 */
export type AksNetworkMode =
  | "azure-cni-node-subnet"
  | "azure-cni-overlay"
  | "azure-cni-pod-subnet"
  | "kubenet";

/**
 * Default max pods per node, per mode.
 *
 * Note that "Azure CNI defaults to 30" is true only of the legacy node-subnet
 * mode. Overlay defaults to 250 and pod-subnet to 110, so a single blanket
 * default would understate overlay by more than 8x.
 */
export const AKS_DEFAULT_MAX_PODS: Record<AksNetworkMode, number> = {
  "azure-cni-node-subnet": 30,
  "azure-cni-overlay": 250,
  "azure-cni-pod-subnet": 110,
  kubenet: 110,
};

/** Configurable bounds on max pods per node, identical across modes. */
export const AKS_MAX_PODS_CEILING = 250;
export const AKS_MAX_PODS_FLOOR = 10;

/** AKS surges one extra node during upgrades unless told otherwise. */
export const AKS_DEFAULT_MAX_SURGE = 1;

/** Addresses in the fixed per-node block Azure CNI Overlay allocates. */
const OVERLAY_BLOCK_PER_NODE = 256;

/** Pod-subnet mode hands nodes addresses in batches of this size. */
const POD_SUBNET_BATCH = 16;

export interface AksPlan {
  mode: AksNetworkMode;
  nodes: number;
  /** Defaults to the mode's own default rather than a single global value. */
  maxPodsPerNode?: number;
  /** Extra nodes stood up during an upgrade. Defaults to 1. */
  maxSurge?: number;
}

function requirePositiveInt(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer: ${value}`);
  }
}

/**
 * Node subnet addresses for an AKS cluster.
 *
 * Only the flat modes multiply by pods. Microsoft's published formula is
 * `(nodes + surge) + ((nodes + surge) * maxPods)`, and it applies to
 * traditional Azure CNI. Applying it to overlay or kubenet would overstate the
 * node subnet by two orders of magnitude, which is the mistake that makes
 * people abandon a correct design.
 */
export function estimateAks(plan: AksPlan, platformId: PlatformId = "azure"): CapacityEstimate {
  requirePositiveInt(plan.nodes, "node count");
  const surge = plan.maxSurge ?? AKS_DEFAULT_MAX_SURGE;
  requirePositiveInt(surge, "max surge");

  const maxPods = plan.maxPodsPerNode ?? AKS_DEFAULT_MAX_PODS[plan.mode];
  requirePositiveInt(maxPods, "max pods per node");

  const platform = platformById(platformId);
  const warnings: string[] = [];
  const breakdown: CapacityLine[] = [];
  const companions: CompanionRequirement[] = [];

  if (maxPods > AKS_MAX_PODS_CEILING) {
    warnings.push(
      `${maxPods} pods per node exceeds the AKS ceiling of ${AKS_MAX_PODS_CEILING}.`
    );
  }
  if (maxPods < AKS_MAX_PODS_FLOOR) {
    warnings.push(
      `${maxPods} pods per node is below the AKS floor of ${AKS_MAX_PODS_FLOOR}.`
    );
  }

  const planningNodes = plan.nodes + surge;
  breakdown.push({
    label: "Node addresses",
    addresses: planningNodes,
    detail: `${plan.nodes} nodes plus ${surge} surge node${surge === 1 ? "" : "s"} during upgrade.`,
  });

  let addresses = planningNodes;

  switch (plan.mode) {
    case "azure-cni-node-subnet": {
      const podAddresses = planningNodes * maxPods;
      breakdown.push({
        label: "Pod addresses",
        addresses: podAddresses,
        detail: `Every pod takes a routable VNet address: ${planningNodes} x ${maxPods}.`,
      });
      addresses += podAddresses;
      warnings.push(
        "Surge nodes draw a full pod allotment each, so upgrade headroom costs maxPods addresses per surge node, not one."
      );
      break;
    }

    case "azure-cni-overlay": {
      companions.push({
        name: "Overlay pod CIDR",
        addresses: planningNodes * OVERLAY_BLOCK_PER_NODE,
        separateFromVnet: true,
        detail:
          `Each node receives a fixed /24 regardless of maxPods, so the pod CIDR is ` +
          `${planningNodes} x ${OVERLAY_BLOCK_PER_NODE}. It sits outside the VNet and must not ` +
          `overlap the VNet, peered VNets, or on-prem space.`,
      });
      break;
    }

    case "azure-cni-pod-subnet": {
      // Nodes draw pod addresses in batches of 16 and hold a batch until it is
      // nearly empty, so round up. The +1 is the node's own primary address.
      const batches = Math.ceil((maxPods + 1) / POD_SUBNET_BATCH);
      companions.push({
        name: "Pod subnet",
        addresses: planningNodes * batches * POD_SUBNET_BATCH,
        separateFromVnet: false,
        detail:
          `Addresses are handed out in batches of ${POD_SUBNET_BATCH}, so ${maxPods} pods per node ` +
          `reserves ${batches * POD_SUBNET_BATCH} addresses per node whether or not they are used. ` +
          `Sizing maxPods as (16 x N) - 1 wastes nothing.`,
      });
      if ((maxPods + 1) % POD_SUBNET_BATCH !== 0) {
        const wasted = batches * POD_SUBNET_BATCH - (maxPods + 1);
        warnings.push(
          `Pod subnet batching wastes ${wasted} address${wasted === 1 ? "" : "es"} per node at ` +
            `${maxPods} pods. ${batches * POD_SUBNET_BATCH - 1} pods per node costs the same.`
        );
      }
      break;
    }

    case "kubenet": {
      companions.push({
        name: "Pod CIDR",
        addresses: planningNodes * maxPods,
        separateFromVnet: true,
        detail:
          "Pods are NATed behind the node, so pod addresses come from a CIDR outside the VNet.",
      });
      break;
    }
  }

  const prefix = prefixForHosts(addresses, platform);
  if (prefix === null) {
    warnings.push(
      `${addresses} addresses exceeds what a single ${platform.name} subnet can hold. Split across node pools and subnets.`
    );
  }

  return { addresses, prefix, breakdown, warnings, companions };
}

/* -------------------------------------------------------------------------- */
/* EKS                                                                        */
/* -------------------------------------------------------------------------- */

/** How the AWS VPC CNI hands addresses to pods. */
export type EksIpMode = "secondary-ip" | "prefix-delegation";

/** A /28 per prefix, which is what prefix delegation assigns per IP slot. */
const PREFIX_DELEGATION_BLOCK = 16;

/** kube-proxy and aws-node run host-networked and cost no pod address. */
const HOST_NETWORKED_PODS = 2;

export interface EksPlan {
  mode: EksIpMode;
  nodes: number;
  /** Maximum ENIs the instance type supports. */
  enisPerNode: number;
  /** IPv4 addresses per ENI for the instance type. */
  ipsPerEni: number;
  /** Pods actually scheduled per node. Drives how many ENIs get attached. */
  podsPerNode: number;
  /** Pods on a secondary CIDR; the primary ENI stops serving pods. */
  customNetworking?: boolean;
}

/**
 * Maximum pods the VPC CNI will schedule on one node.
 *
 * AWS's formula is `(ENIs x (IPsPerENI - 1)) + 2`. Custom networking costs a
 * whole ENI, and prefix delegation multiplies each usable slot by 16.
 */
export function eksMaxPods(plan: Pick<EksPlan,
  "mode" | "enisPerNode" | "ipsPerEni" | "customNetworking">): number {
  const enis = plan.customNetworking === true ? plan.enisPerNode - 1 : plan.enisPerNode;
  const slotsPerEni = plan.ipsPerEni - 1;
  const perSlot = plan.mode === "prefix-delegation" ? PREFIX_DELEGATION_BLOCK : 1;
  return Math.max(0, enis * slotsPerEni * perSlot) + HOST_NETWORKED_PODS;
}

/**
 * Addresses an EKS cluster HOLDS, which is the number that matters.
 *
 * The VPC CNI keeps a warm pool: with the default WARM_ENI_TARGET of 1 a node
 * keeps one entirely free ENI attached, and every address on it is drawn from
 * the subnet whether or not a pod is using it. AWS's own worked example has
 * three idle c5.large nodes holding 50 addresses to run two CoreDNS pods.
 * Estimating bound addresses instead of held addresses is precisely how a
 * subnet that looks fine runs out.
 */
export function estimateEks(plan: EksPlan, platformId: PlatformId = "aws"): CapacityEstimate {
  requirePositiveInt(plan.nodes, "node count");
  requirePositiveInt(plan.podsPerNode, "pods per node");
  if (!Number.isInteger(plan.enisPerNode) || plan.enisPerNode < 1) {
    throw new RangeError(`ENIs per node must be a positive integer: ${plan.enisPerNode}`);
  }
  if (!Number.isInteger(plan.ipsPerEni) || plan.ipsPerEni < 2) {
    throw new RangeError(`IPs per ENI must be at least 2: ${plan.ipsPerEni}`);
  }

  const platform = platformById(platformId);
  const custom = plan.customNetworking === true;
  const warnings: string[] = [];
  const breakdown: CapacityLine[] = [];
  const companions: CompanionRequirement[] = [];

  const ceiling = eksMaxPods(plan);
  if (plan.podsPerNode > ceiling) {
    warnings.push(
      `${plan.podsPerNode} pods per node exceeds the ${ceiling} this instance type supports ` +
        `in ${plan.mode} mode${custom ? " with custom networking" : ""}.`
    );
  }

  // Slots per ENI available to pods; the ENI's own primary address is not one.
  const slotsPerEni =
    (plan.ipsPerEni - 1) * (plan.mode === "prefix-delegation" ? PREFIX_DELEGATION_BLOCK : 1);
  const podEniLimit = custom ? plan.enisPerNode - 1 : plan.enisPerNode;

  // One ENI beyond what the pods need, because of the warm pool.
  const enisNeeded = Math.ceil(plan.podsPerNode / slotsPerEni);
  const enisAttached = Math.min(podEniLimit, enisNeeded + 1);
  const heldPerNode = enisAttached * plan.ipsPerEni;

  let addresses: number;

  if (custom) {
    // Pods live on the secondary CIDR; the node subnet keeps only primary IPs.
    addresses = plan.nodes;
    breakdown.push({
      label: "Node primary addresses",
      addresses: plan.nodes,
      detail:
        "With custom networking the primary ENI serves no pods, so the node subnet holds one address per node.",
    });
    companions.push({
      name: "Pod subnet (secondary VPC CIDR)",
      addresses: plan.nodes * heldPerNode,
      separateFromVnet: false,
      detail:
        `${enisAttached} secondary ENI${enisAttached === 1 ? "" : "s"} per node at ${plan.ipsPerEni} ` +
        `addresses each. Commonly carved from 100.64.0.0/10, which rarely collides with RFC 1918 space.`,
    });
  } else {
    addresses = plan.nodes * heldPerNode;
    breakdown.push({
      label: "Addresses held per node",
      addresses: heldPerNode,
      detail:
        `${enisAttached} ENI${enisAttached === 1 ? "" : "s"} attached at ${plan.ipsPerEni} addresses each. ` +
        `${enisNeeded} would cover ${plan.podsPerNode} pods; the warm pool keeps one more.`,
    });
    breakdown.push({
      label: "Cluster total",
      addresses,
      detail: `${plan.nodes} nodes x ${heldPerNode}.`,
    });

    const bound = plan.nodes * plan.podsPerNode;
    if (addresses > bound) {
      warnings.push(
        `The cluster holds ${addresses} addresses to run ${bound} pods. Warm addresses are ` +
          `consumed from the subnet even while unused.`
      );
    }
  }

  if (plan.mode === "prefix-delegation") {
    warnings.push(
      "Prefix delegation needs a contiguous /28 per prefix. On a fragmented subnet the attach fails " +
        "with InsufficientCidrBlocks. Use a dedicated subnet or a CIDR reservation."
    );
  }

  const prefix = prefixForHosts(addresses, platform);
  if (prefix === null) {
    warnings.push(
      `${addresses} addresses exceeds what a single ${platform.name} subnet can hold.`
    );
  }

  return { addresses, prefix, breakdown, warnings, companions };
}

/* -------------------------------------------------------------------------- */
/* Simple per-service consumers                                               */
/* -------------------------------------------------------------------------- */

/**
 * Services whose consumption is a count rather than a formula.
 *
 * `perUnit` is addresses per instance of the thing. Where a vendor publishes
 * no number, the entry says so instead of guessing, and `perUnit` is
 * undefined so a caller cannot accidentally multiply by a fiction.
 */
export interface ServiceConsumer {
  id: string;
  name: string;
  platform: Exclude<PlatformId, "none">;
  /** Addresses consumed per unit, when the vendor documents one. */
  perUnit?: number;
  /** What one unit is: an endpoint, an instance, an Availability Zone. */
  unit: string;
  notes: string[];
}

export const SERVICE_CONSUMERS: ServiceConsumer[] = [
  {
    id: "azure-private-endpoint",
    name: "Private endpoint",
    platform: "azure",
    perUnit: 1,
    unit: "endpoint",
    notes: [
      "One address per endpoint NIC. Sub-resources need separate endpoints, so a storage account using both blob and file is two endpoints and two addresses.",
    ],
  },
  {
    id: "azure-cosmos-private-endpoint",
    name: "Cosmos DB private endpoint",
    platform: "azure",
    unit: "account",
    notes: [
      "The exception to the one-address rule: a Cosmos endpoint reserves one address per account region plus one for the region-agnostic endpoint, so the count is regions + 1.",
      "Adding a region to the account grows the reservation after the subnet is already deployed.",
    ],
  },
  {
    id: "azure-app-service-integration",
    name: "App Service regional VNet integration",
    platform: "azure",
    perUnit: 1,
    unit: "plan instance",
    notes: [
      "The subnet gives up 5 addresses at the start, then one per App Service plan instance.",
      "Scaling temporarily doubles consumption and addresses can take up to 12 hours to be released, so Microsoft recommends allocating double the planned maximum scale.",
      "Windows Containers add one address per app per instance on top.",
    ],
  },
  {
    id: "azure-sql-mi",
    name: "SQL Managed Instance",
    platform: "azure",
    unit: "instance",
    notes: [
      "Not a flat per-instance count. See sqlManagedInstanceAddresses for the published formula.",
      "Hard minimum 32 addresses and a /27 mask regardless of how small the deployment is.",
    ],
  },
  {
    id: "azure-container-instances",
    name: "Azure Container Instances",
    platform: "azure",
    unit: "container group",
    notes: [
      "Microsoft publishes no per-container-group address count. The documentation only advises sizing a /28 rather than a /29 so there is buffer, which implies roughly one address per group.",
      "The subnet is delegated and can hold nothing but container groups. Ceiling is 3000 groups per subnet.",
    ],
  },
  {
    id: "aws-nat-gateway",
    name: "NAT Gateway",
    platform: "aws",
    perUnit: 1,
    unit: "gateway",
    notes: [
      "One primary private address, which cannot be changed after creation.",
      "Up to 8 total addresses if secondary addresses are assigned for port-allocation headroom.",
    ],
  },
  {
    id: "aws-interface-endpoint",
    name: "PrivateLink interface endpoint",
    platform: "aws",
    perUnit: 1,
    unit: "subnet",
    notes: [
      "One ENI per selected subnet, at most one subnet per Availability Zone.",
      "Gateway endpoints for S3 and DynamoDB are route table entries and consume nothing.",
    ],
  },
  {
    id: "aws-nlb",
    name: "Network Load Balancer",
    platform: "aws",
    perUnit: 1,
    unit: "Availability Zone",
    notes: [
      "One address per enabled Availability Zone.",
      "The 8-free-address and /27 requirements AWS publishes are for Application Load Balancer. No AWS source states they apply to NLB.",
    ],
  },
  {
    id: "aws-tgw-attachment",
    name: "Transit Gateway attachment",
    platform: "aws",
    perUnit: 1,
    unit: "Availability Zone",
    notes: [
      "One ENI and one address per zone, per attachment.",
      "AWS recommends a dedicated /28 per attachment subnet, ideally on a secondary non-routable CIDR to preserve routable space.",
    ],
  },
  {
    id: "aws-rds",
    name: "RDS instance",
    platform: "aws",
    unit: "instance",
    notes: [
      "One address per instance plus unpublished headroom: AWS says only that the subnet must be large enough for spare addresses used during failover and compute scaling, and offers a /24 as a rough hint.",
      "Because the headroom is undocumented, this cannot be modeled precisely. Size generously.",
    ],
  },
  {
    id: "aws-lambda",
    name: "Lambda VPC attachment",
    platform: "aws",
    unit: "subnet and security group pair",
    notes: [
      "One Hyperplane ENI per unique subnet and security group combination, shared across every function and version using that pair.",
      "The count scales with concurrency and AWS publishes no formula. ENIs are reclaimed after roughly 14 idle days.",
    ],
  },
];

/** Look up a consumer by id. Throws on an unknown id, which is a code bug. */
export function serviceConsumerById(id: string): ServiceConsumer {
  const found = SERVICE_CONSUMERS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`unknown service consumer "${id}"`);
  return found;
}

export interface SqlManagedInstancePlan {
  generalPurpose: number;
  businessCritical: number;
  /** Business Critical instances that are also zone redundant. */
  zoneRedundant: number;
  /** Virtual cluster groups; at least one exists per subnet in use. */
  vmGroups: number;
}

/** Minimum addresses and prefix a SQL MI subnet requires regardless of size. */
export const SQL_MI_MINIMUM_ADDRESSES = 32;
export const SQL_MI_MINIMUM_PREFIX = 27;

/**
 * Addresses for a SQL Managed Instance subnet.
 *
 * Microsoft's published formula is `5 + (gp * 4) + (bc * 10) + (bc_zr * 2) +
 * (vmg * 8)`. The 4 and the 10 are already double the steady-state figures,
 * because SQL MI scales by standing up replacement nodes alongside the
 * existing ones. Halving them to "what it uses today" is a trap.
 */
export function sqlManagedInstanceAddresses(plan: SqlManagedInstancePlan): number {
  requirePositiveInt(plan.generalPurpose, "General Purpose instance count");
  requirePositiveInt(plan.businessCritical, "Business Critical instance count");
  requirePositiveInt(plan.zoneRedundant, "zone redundant instance count");
  requirePositiveInt(plan.vmGroups, "virtual cluster group count");

  const computed =
    5 +
    plan.generalPurpose * 4 +
    plan.businessCritical * 10 +
    plan.zoneRedundant * 2 +
    plan.vmGroups * 8;

  return Math.max(SQL_MI_MINIMUM_ADDRESSES, computed);
}

export interface AppGatewayPlan {
  /** Maximum instance count configured on each gateway in the subnet. */
  maxInstancesPerGateway: number[];
  /** How many of those gateways have a private frontend IP configuration. */
  gatewaysWithPrivateFrontend: number;
}

/** Ceiling on the maximum instance count for Application Gateway v2. */
export const APP_GATEWAY_V2_MAX_INSTANCES = 125;

/**
 * Addresses an Application Gateway v2 subnet needs.
 *
 * Azure subtracts each gateway's CONFIGURED maximum instance count, not the
 * 125 ceiling. Sizing against 125 when the gateway is capped at 10 wastes most
 * of a /24, which is how the "always use a /24" advice took hold.
 */
export function appGatewayAddresses(plan: AppGatewayPlan): number {
  for (const max of plan.maxInstancesPerGateway) {
    requirePositiveInt(max, "maximum instance count");
    if (max > APP_GATEWAY_V2_MAX_INSTANCES) {
      throw new RangeError(
        `maximum instance count cannot exceed ${APP_GATEWAY_V2_MAX_INSTANCES}: ${max}`
      );
    }
  }
  requirePositiveInt(plan.gatewaysWithPrivateFrontend, "private frontend count");
  if (plan.gatewaysWithPrivateFrontend > plan.maxInstancesPerGateway.length) {
    throw new RangeError(
      "more gateways with a private frontend than gateways in the subnet"
    );
  }

  const instances = plan.maxInstancesPerGateway.reduce((sum, n) => sum + n, 0);
  return instances + plan.gatewaysWithPrivateFrontend;
}

/**
 * Headroom left in a subnet of the given prefix after a workload.
 *
 * Negative means the subnet is already short. Kept separate from the
 * estimators so the UI can show "this /24 has 60 addresses left" without
 * re-deriving anything.
 */
export function remainingCapacity(
  prefix: number,
  consumed: number,
  platformId: PlatformId
): number {
  const platform: Platform = platformById(platformId);
  return cloudUsableHosts(prefix, platform) - consumed;
}
