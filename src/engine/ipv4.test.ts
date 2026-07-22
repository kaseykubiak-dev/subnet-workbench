import { describe, expect, it } from "vitest";
import {
  broadcastAddress,
  classify,
  contains,
  intersection,
  intersects,
  ipToNumber,
  isRfc1918,
  lastAddress,
  maskToPrefix,
  networkAddress,
  numberToIp,
  prefixToMask,
  prefixToWildcard,
  subnetInfo,
  totalHosts,
  usableHosts,
  usableRange,
} from "./ipv4";

const ip = (s: string): number => {
  const n = ipToNumber(s);
  if (n === null) throw new Error(`bad test ip: ${s}`);
  return n;
};

const subnet = (s: string) => {
  const [addr, prefix] = s.split("/");
  return { network: ip(addr as string), prefix: Number(prefix) };
};

describe("ipToNumber / numberToIp", () => {
  it("round-trips ordinary addresses", () => {
    for (const s of ["0.0.0.0", "10.0.0.1", "172.16.254.3", "192.168.1.255", "255.255.255.255"]) {
      expect(numberToIp(ip(s))).toBe(s);
    }
  });

  it("converts known values", () => {
    expect(ip("10.0.0.0")).toBe(0x0a000000);
    expect(ip("255.255.255.255")).toBe(0xffffffff);
    expect(ip("0.0.0.1")).toBe(1);
  });

  it("rejects malformed input", () => {
    for (const s of ["", "10.0.0", "10.0.0.0.0", "10.0.0.256", "a.b.c.d", "10.0.0.-1", "10..0.0", "10.0.0.1/24"]) {
      expect(ipToNumber(s)).toBeNull();
    }
  });

  it("accepts surrounding whitespace only", () => {
    expect(ipToNumber(" 10.0.0.1 ")).toBe(ip("10.0.0.1"));
  });
});

describe("prefix / mask / wildcard", () => {
  it("converts prefix to mask across the full range", () => {
    expect(numberToIp(prefixToMask(0))).toBe("0.0.0.0");
    expect(numberToIp(prefixToMask(8))).toBe("255.0.0.0");
    expect(numberToIp(prefixToMask(12))).toBe("255.240.0.0");
    expect(numberToIp(prefixToMask(24))).toBe("255.255.255.0");
    expect(numberToIp(prefixToMask(25))).toBe("255.255.255.128");
    expect(numberToIp(prefixToMask(31))).toBe("255.255.255.254");
    expect(numberToIp(prefixToMask(32))).toBe("255.255.255.255");
  });

  it("round-trips mask to prefix for every prefix 0-32", () => {
    for (let p = 0; p <= 32; p++) {
      expect(maskToPrefix(prefixToMask(p))).toBe(p);
    }
  });

  it("rejects non-contiguous masks", () => {
    for (const s of ["255.0.255.0", "0.255.255.255", "255.255.255.253", "128.255.0.0"]) {
      expect(maskToPrefix(ip(s))).toBeNull();
    }
  });

  it("produces wildcard masks (the Cisco IOS conversion)", () => {
    expect(numberToIp(prefixToWildcard(24))).toBe("0.0.0.255");
    expect(numberToIp(prefixToWildcard(30))).toBe("0.0.0.3");
    expect(numberToIp(prefixToWildcard(0))).toBe("255.255.255.255");
    expect(numberToIp(prefixToWildcard(32))).toBe("0.0.0.0");
  });

  it("throws on out-of-range prefixes", () => {
    expect(() => prefixToMask(-1)).toThrow(RangeError);
    expect(() => prefixToMask(33)).toThrow(RangeError);
    expect(() => prefixToMask(1.5)).toThrow(RangeError);
  });
});

describe("network / broadcast / usable range", () => {
  it("derives a standard /24", () => {
    const info = subnetInfo(ip("192.168.1.57"), 24);
    expect(numberToIp(info.network)).toBe("192.168.1.0");
    expect(numberToIp(info.broadcast as number)).toBe("192.168.1.255");
    expect(numberToIp(info.firstUsable)).toBe("192.168.1.1");
    expect(numberToIp(info.lastUsable)).toBe("192.168.1.254");
    expect(info.totalHosts).toBe(256);
    expect(info.usableHosts).toBe(254);
    expect(numberToIp(info.mask)).toBe("255.255.255.0");
    expect(numberToIp(info.wildcard)).toBe("0.0.0.255");
  });

  it("derives a /26 mid-block", () => {
    const info = subnetInfo(ip("10.10.10.130"), 26);
    expect(numberToIp(info.network)).toBe("10.10.10.128");
    expect(numberToIp(info.broadcast as number)).toBe("10.10.10.191");
    expect(numberToIp(info.firstUsable)).toBe("10.10.10.129");
    expect(numberToIp(info.lastUsable)).toBe("10.10.10.190");
    expect(info.usableHosts).toBe(62);
  });

  it("handles /31 per RFC 3021: no broadcast, 2 usable", () => {
    const info = subnetInfo(ip("10.0.0.4"), 31);
    expect(numberToIp(info.network)).toBe("10.0.0.4");
    expect(info.broadcast).toBeNull();
    expect(numberToIp(info.firstUsable)).toBe("10.0.0.4");
    expect(numberToIp(info.lastUsable)).toBe("10.0.0.5");
    expect(info.totalHosts).toBe(2);
    expect(info.usableHosts).toBe(2);
  });

  it("handles /32 as a host route: no broadcast, 1 usable", () => {
    const info = subnetInfo(ip("10.255.255.255"), 32);
    expect(numberToIp(info.network)).toBe("10.255.255.255");
    expect(info.broadcast).toBeNull();
    expect(numberToIp(info.firstUsable)).toBe("10.255.255.255");
    expect(numberToIp(info.lastUsable)).toBe("10.255.255.255");
    expect(info.totalHosts).toBe(1);
    expect(info.usableHosts).toBe(1);
  });

  it("handles /0 (the whole space)", () => {
    const info = subnetInfo(ip("8.8.8.8"), 0);
    expect(numberToIp(info.network)).toBe("0.0.0.0");
    expect(numberToIp(info.broadcast as number)).toBe("255.255.255.255");
    expect(info.totalHosts).toBe(2 ** 32);
    expect(info.usableHosts).toBe(2 ** 32 - 2);
  });

  it("stays unsigned at the top of the space", () => {
    const info = subnetInfo(ip("255.255.255.250"), 30);
    expect(numberToIp(info.network)).toBe("255.255.255.248");
    expect(numberToIp(info.broadcast as number)).toBe("255.255.255.251");
    expect(info.network).toBeGreaterThan(0);
  });

  it("lastAddress equals broadcast where broadcast exists", () => {
    expect(lastAddress(ip("192.168.1.10"), 24)).toBe(broadcastAddress(ip("192.168.1.10"), 24));
    expect(numberToIp(lastAddress(ip("10.0.0.4"), 31))).toBe("10.0.0.5");
    expect(numberToIp(lastAddress(ip("10.0.0.4"), 32))).toBe("10.0.0.4");
  });

  it("usableRange matches subnetInfo", () => {
    const r = usableRange(ip("172.16.5.77"), 20);
    expect(numberToIp(r.first)).toBe("172.16.0.1");
    expect(numberToIp(r.last)).toBe("172.16.15.254");
  });

  it("usableHosts and totalHosts across sizes", () => {
    expect(totalHosts(30)).toBe(4);
    expect(usableHosts(30)).toBe(2);
    expect(usableHosts(8)).toBe(2 ** 24 - 2);
    expect(networkAddress(ip("10.1.2.3"), 8)).toBe(ip("10.0.0.0"));
  });
});

describe("RFC 1918", () => {
  it("flags private blocks", () => {
    expect(isRfc1918(subnet("10.0.0.0/8"))).toBe(true);
    expect(isRfc1918(subnet("10.20.30.0/24"))).toBe(true);
    expect(isRfc1918(subnet("172.16.0.0/12"))).toBe(true);
    expect(isRfc1918(subnet("172.31.255.0/24"))).toBe(true);
    expect(isRfc1918(subnet("192.168.0.0/16"))).toBe(true);
    expect(isRfc1918(subnet("192.168.44.0/30"))).toBe(true);
  });

  it("does not flag public or straddling blocks", () => {
    expect(isRfc1918(subnet("8.8.8.0/24"))).toBe(false);
    expect(isRfc1918(subnet("172.32.0.0/16"))).toBe(false);
    expect(isRfc1918(subnet("172.15.0.0/16"))).toBe(false);
    expect(isRfc1918(subnet("192.169.0.0/16"))).toBe(false);
    // A /7 straddles 10/8 and public space: not fully private.
    expect(isRfc1918(subnet("10.0.0.0/7"))).toBe(false);
    expect(isRfc1918(subnet("0.0.0.0/0"))).toBe(false);
  });
});

describe("containment / intersection / classify", () => {
  it("contains: nesting, identity, and non-containment", () => {
    expect(contains(subnet("10.0.0.0/8"), subnet("10.5.0.0/16"))).toBe(true);
    expect(contains(subnet("10.5.0.0/16"), subnet("10.0.0.0/8"))).toBe(false);
    expect(contains(subnet("10.0.0.0/24"), subnet("10.0.0.0/24"))).toBe(true);
    expect(contains(subnet("10.0.0.0/24"), subnet("10.0.1.0/24"))).toBe(false);
    expect(contains(subnet("0.0.0.0/0"), subnet("203.0.113.0/24"))).toBe(true);
  });

  it("intersects: nested yes, adjacent no", () => {
    expect(intersects(subnet("10.0.0.0/8"), subnet("10.255.255.254/31"))).toBe(true);
    expect(intersects(subnet("10.0.0.0/24"), subnet("10.0.1.0/24"))).toBe(false);
    expect(intersects(subnet("192.168.0.0/24"), subnet("192.168.0.128/25"))).toBe(true);
  });

  it("intersection returns the smaller block's range", () => {
    const r = intersection(subnet("10.0.0.0/8"), subnet("10.5.5.0/24"));
    expect(r).not.toBeNull();
    expect(numberToIp((r as { first: number; last: number }).first)).toBe("10.5.5.0");
    expect(numberToIp((r as { first: number; last: number }).last)).toBe("10.5.5.255");
    expect(intersection(subnet("10.0.0.0/24"), subnet("10.0.1.0/24"))).toBeNull();
  });

  it("classify covers identical / containment / disjoint", () => {
    expect(classify(subnet("10.0.0.0/24"), subnet("10.0.0.0/24"))).toBe("identical");
    expect(classify(subnet("10.0.0.0/8"), subnet("10.9.0.0/16"))).toBe("a-contains-b");
    expect(classify(subnet("10.9.0.0/16"), subnet("10.0.0.0/8"))).toBe("b-contains-a");
    expect(classify(subnet("10.0.0.0/24"), subnet("10.0.1.0/24"))).toBe("disjoint");
  });

  it("classify normalizes un-aligned host bits first", () => {
    // 10.0.0.99/24 is the same block as 10.0.0.0/24.
    expect(classify({ network: ip("10.0.0.99"), prefix: 24 }, subnet("10.0.0.0/24"))).toBe("identical");
  });
});
