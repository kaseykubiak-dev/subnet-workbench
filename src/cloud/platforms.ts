/**
 * Subnet Workbench: cloud platform definitions (pure data + small math).
 *
 * The engine in src/engine stays RFC-level and platform-agnostic on purpose;
 * everything that is true only because a hyperscaler says so lives here.
 *
 * The one piece of math that matters: Azure and AWS both reserve 5 addresses
 * in every subnet, so usable = total - 5, not total - 2. A /29 yields 3 usable
 * addresses on both platforms, not 6. This is the single most common cloud
 * subnet planning error and the reason cloud mode exists.
 *
 * All figures verified against current Microsoft Learn and AWS documentation
 * on 2026-07-25. See cloud-mode-verification.md for sources and for the four
 * corrections this file encodes against the original planning doc.
 */

/** Supported cloud platforms. "none" is on-prem / RFC behavior. */
export type PlatformId = "none" | "azure" | "aws";

/** How a platform treats a subnet's address range after creation. */
export interface ResizePolicy {
  /** Can the range be changed at all after creation? */
  resizable: boolean;
  /** The caveat that makes the yes/no honest. */
  detail: string;
}

export interface Platform {
  id: PlatformId;
  name: string;
  /**
   * Addresses the platform takes from every subnet before you get any.
   * Azure: network, .1 gateway, .2 and .3 (Azure DNS), last address.
   * AWS:   network, .1 VPC router, .2 DNS, .3 reserved, last address.
   */
  reservedPerSubnet: number;
  /** Human-readable breakdown of what those reserved addresses are. */
  reservedDetail: string;
  /** Smallest permitted subnet (largest prefix number). */
  maxPrefix: number;
  /** Largest permitted subnet (smallest prefix number). */
  minPrefix: number;
  resize: ResizePolicy;
}

export const PLATFORMS: Platform[] = [
  {
    id: "none",
    name: "On-prem / RFC",
    reservedPerSubnet: 2,
    reservedDetail: "Network address and broadcast address, per standard IPv4.",
    maxPrefix: 32,
    minPrefix: 0,
    resize: {
      resizable: true,
      detail: "Renumbering is a local decision, not a platform constraint.",
    },
  },
  {
    id: "azure",
    name: "Azure",
    reservedPerSubnet: 5,
    reservedDetail:
      "Network address, .1 (default gateway), .2 and .3 (mapped to Azure DNS), and the last address.",
    // Verified: "The smallest supported IPv4 subnet is /29, and the largest is /2."
    maxPrefix: 29,
    minPrefix: 2,
    resize: {
      resizable: true,
      detail:
        "A subnet can be grown or shrunk, but only while no resources are deployed in it. " +
        "With resources present they must be moved or deleted first. The new range must not " +
        "overlap other ranges in the VNet, peered VNets, or on-prem space. The subnet name can " +
        "never change, and GatewaySubnet must be deleted and recreated.",
    },
  },
  {
    id: "aws",
    name: "AWS",
    reservedPerSubnet: 5,
    reservedDetail:
      "Network address, .1 (VPC router), .2 (DNS), .3 (reserved for future use), and the broadcast address.",
    maxPrefix: 28,
    minPrefix: 16,
    resize: {
      resizable: false,
      detail:
        "A subnet's CIDR is immutable once created; the only remedy is delete and recreate. " +
        "Adding a secondary CIDR to the VPC and building new subnets in it is a different " +
        "operation and does not resize anything that already exists.",
    },
  },
];

/** Look up a platform by id. Throws on an unknown id (a code bug, not input). */
export function platformById(id: PlatformId): Platform {
  const found = PLATFORMS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`unknown platform "${id}"`);
  return found;
}

/**
 * Usable addresses for a prefix on a given platform.
 *
 * Deliberately separate from engine/ipv4's usableHosts, which encodes RFC
 * behavior (including the RFC 3021 /31 and /32 special cases). Those special
 * cases do not apply in cloud: neither platform permits a subnet that small,
 * so a /31 under a cloud platform is an invalid input rather than a
 * point-to-point link. Returns 0 rather than a negative count when the prefix
 * is too small to cover the reserved set.
 */
export function cloudUsableHosts(prefix: number, platform: Platform): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`prefix out of range: ${prefix}`);
  }
  const total = 2 ** (32 - prefix);
  return Math.max(0, total - platform.reservedPerSubnet);
}

/**
 * The smallest prefix (largest block) whose usable count covers `hosts` on
 * this platform, or null when even the platform's largest permitted subnet
 * cannot. Counts up from the platform's smallest subnet so the result is the
 * tightest fit.
 */
export function prefixForHosts(hosts: number, platform: Platform): number | null {
  if (!Number.isInteger(hosts) || hosts < 0) {
    throw new RangeError(`host count must be a non-negative integer: ${hosts}`);
  }
  for (let prefix = platform.maxPrefix; prefix >= platform.minPrefix; prefix -= 1) {
    if (cloudUsableHosts(prefix, platform) >= hosts) return prefix;
  }
  return null;
}

/** True when the prefix is a legal subnet size on this platform. */
export function isPrefixAllowed(prefix: number, platform: Platform): boolean {
  return prefix >= platform.minPrefix && prefix <= platform.maxPrefix;
}
