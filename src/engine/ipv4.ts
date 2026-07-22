/**
 * Subnet Workbench: IPv4 math engine.
 *
 * Pure logic module. Addresses are represented internally as unsigned 32-bit
 * integers (plain JS numbers, always normalized with `>>> 0`). Parsing and
 * formatting live strictly at the edges of this module; nothing in here does
 * repeated string manipulation on dotted quads.
 *
 * RFC 3021 (/31) and host routes (/32) are handled explicitly:
 * a /31 has no network/broadcast distinction and 2 usable addresses;
 * a /32 is a single host route with 1 usable address.
 */

/** A subnet: network address (unsigned 32-bit) plus prefix length 0-32. */
export interface Subnet {
  network: number;
  prefix: number;
}

/** Full derivation for a single subnet (Calculate mode's result object). */
export interface SubnetInfo {
  network: number;
  prefix: number;
  mask: number;
  wildcard: number;
  /** Broadcast address, or null for /31 and /32 (none exists per RFC 3021). */
  broadcast: number | null;
  firstUsable: number;
  lastUsable: number;
  /** Total addresses in the block (2^(32-prefix)). */
  totalHosts: number;
  /** Usable host addresses: total-2 normally, 2 for /31, 1 for /32. */
  usableHosts: number;
  isRfc1918: boolean;
}

/**
 * Relationship between two subnets.
 *
 * Note: "partial-overlap" is unreachable for valid CIDR blocks. Two aligned
 * power-of-two blocks either nest or are disjoint; partial overlap requires
 * arbitrary start-end ranges, which are not v1 input. The variant is kept so
 * Overlap mode's UI contract (three conflict classes, per the plan) is stable
 * if ranges ever become an input type.
 */
export type SubnetRelationship =
  | "identical"
  | "a-contains-b"
  | "b-contains-a"
  | "partial-overlap"
  | "disjoint";

// ---------------------------------------------------------------------------
// Address <-> number conversion (the edges)
// ---------------------------------------------------------------------------

/** Strict dotted-quad to unsigned 32-bit number. Returns null when invalid. */
export function ipToNumber(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

/** Unsigned 32-bit number to dotted quad. */
export function numberToIp(value: number): string {
  const v = value >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

// ---------------------------------------------------------------------------
// Mask / prefix / wildcard conversion
// ---------------------------------------------------------------------------

/** Prefix length (0-32) to subnet mask as unsigned 32-bit number. */
export function prefixToMask(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`prefix out of range: ${prefix}`);
  }
  // JS shifts are mod 32, so << 32 would be a no-op; handle /0 explicitly.
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/**
 * Subnet mask (as number) to prefix length. Returns null when the mask is
 * non-contiguous (e.g. 255.0.255.0), which is invalid as a subnet mask.
 */
export function maskToPrefix(mask: number): number | null {
  const m = mask >>> 0;
  if (m === 0) return 0;
  // Count leading ones, then confirm the remainder is all zeros.
  const prefix = 32 - Math.log2((~m >>> 0) + 1);
  if (!Number.isInteger(prefix)) return null;
  return prefixToMask(prefix) === m ? prefix : null;
}

/** Wildcard (inverse) mask for a prefix, as unsigned 32-bit number. */
export function prefixToWildcard(prefix: number): number {
  return ~prefixToMask(prefix) >>> 0;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Network address of the block containing `address` at `prefix`. */
export function networkAddress(address: number, prefix: number): number {
  return (address & prefixToMask(prefix)) >>> 0;
}

/** Broadcast address, or null for /31 and /32 (no broadcast exists). */
export function broadcastAddress(address: number, prefix: number): number | null {
  if (prefix >= 31) return null;
  return (networkAddress(address, prefix) | prefixToWildcard(prefix)) >>> 0;
}

/** Last address in the block (broadcast where one exists). */
export function lastAddress(address: number, prefix: number): number {
  return (networkAddress(address, prefix) | prefixToWildcard(prefix)) >>> 0;
}

/** Total addresses in a block. Uses 2**n, exact up to 2^32. */
export function totalHosts(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`prefix out of range: ${prefix}`);
  }
  return 2 ** (32 - prefix);
}

/** Usable host count: RFC 3021 for /31 (2), host route for /32 (1). */
export function usableHosts(prefix: number): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return totalHosts(prefix) - 2;
}

/** First and last usable addresses for the block containing `address`. */
export function usableRange(
  address: number,
  prefix: number
): { first: number; last: number } {
  const net = networkAddress(address, prefix);
  if (prefix >= 31) {
    // /31: both addresses usable; /32: the single address is the host.
    return { first: net, last: lastAddress(address, prefix) };
  }
  return { first: (net + 1) >>> 0, last: (lastAddress(address, prefix) - 1) >>> 0 };
}

/** RFC 1918 private ranges: 10/8, 172.16/12, 192.168/16. */
const RFC1918: Subnet[] = [
  { network: 0x0a000000, prefix: 8 },
  { network: 0xac100000, prefix: 12 },
  { network: 0xc0a80000, prefix: 16 },
];

/** True when the entire block sits inside an RFC 1918 private range. */
export function isRfc1918(subnet: Subnet): boolean {
  return RFC1918.some((r) => contains(r, subnet));
}

/** Full derivation for one subnet: the Calculate mode result object. */
export function subnetInfo(address: number, prefix: number): SubnetInfo {
  const network = networkAddress(address, prefix);
  const range = usableRange(address, prefix);
  return {
    network,
    prefix,
    mask: prefixToMask(prefix),
    wildcard: prefixToWildcard(prefix),
    broadcast: broadcastAddress(address, prefix),
    firstUsable: range.first,
    lastUsable: range.last,
    totalHosts: totalHosts(prefix),
    usableHosts: usableHosts(prefix),
    isRfc1918: isRfc1918({ network, prefix }),
  };
}

// ---------------------------------------------------------------------------
// Containment / intersection / relationship
// ---------------------------------------------------------------------------

/** True when subnet `outer` fully contains subnet `inner` (or is identical). */
export function contains(outer: Subnet, inner: Subnet): boolean {
  if (outer.prefix > inner.prefix) return false;
  return networkAddress(inner.network, outer.prefix) === (outer.network >>> 0);
}

/** True when the two blocks share at least one address. */
export function intersects(a: Subnet, b: Subnet): boolean {
  // For CIDR-aligned blocks, overlap implies one contains the other.
  return contains(a, b) || contains(b, a);
}

/**
 * The overlapping range shared by two subnets, or null when disjoint.
 * For aligned CIDR blocks this is always the smaller block's range.
 */
export function intersection(
  a: Subnet,
  b: Subnet
): { first: number; last: number } | null {
  if (!intersects(a, b)) return null;
  const inner = a.prefix >= b.prefix ? a : b;
  return {
    first: networkAddress(inner.network, inner.prefix),
    last: lastAddress(inner.network, inner.prefix),
  };
}

/** Classify how two subnets relate (Overlap mode's core primitive). */
export function classify(a: Subnet, b: Subnet): SubnetRelationship {
  const aNet = networkAddress(a.network, a.prefix);
  const bNet = networkAddress(b.network, b.prefix);
  if (a.prefix === b.prefix && aNet === bNet) return "identical";
  if (contains(a, b)) return "a-contains-b";
  if (contains(b, a)) return "b-contains-a";
  return "disjoint";
}
