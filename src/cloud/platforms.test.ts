import { describe, expect, it } from "vitest";
import {
  cloudUsableHosts,
  isPrefixAllowed,
  platformById,
  PLATFORMS,
  prefixForHosts,
} from "./platforms";
import { usableHosts } from "../engine/ipv4";

const azure = platformById("azure");
const aws = platformById("aws");
const onprem = platformById("none");

describe("platformById", () => {
  it("returns each defined platform", () => {
    expect(azure.name).toBe("Azure");
    expect(aws.name).toBe("AWS");
    expect(onprem.name).toBe("On-prem / RFC");
  });

  it("throws on an unknown id, since that is a code bug not user input", () => {
    // @ts-expect-error deliberately passing an id outside the union
    expect(() => platformById("gcp")).toThrow(/unknown platform/);
  });

  it("every platform in the table is reachable by its own id", () => {
    for (const platform of PLATFORMS) {
      expect(platformById(platform.id)).toBe(platform);
    }
  });
});

describe("cloudUsableHosts", () => {
  it("both hyperscalers reserve 5, not 2", () => {
    expect(azure.reservedPerSubnet).toBe(5);
    expect(aws.reservedPerSubnet).toBe(5);
  });

  it("the /29 case that motivates cloud mode: 3 usable, not 6", () => {
    expect(cloudUsableHosts(29, azure)).toBe(3);
    expect(cloudUsableHosts(29, aws)).toBe(3);
    expect(usableHosts(29)).toBe(6);
  });

  it("matches the RFC engine when the platform is on-prem", () => {
    for (const prefix of [8, 16, 24, 26, 30]) {
      expect(cloudUsableHosts(prefix, onprem)).toBe(usableHosts(prefix));
    }
  });

  it("diverges from the RFC engine at /31 and /32, where cloud has no special case", () => {
    // RFC 3021 point-to-point and host routes do not exist in cloud, so the
    // plain subtraction is correct here even though it disagrees with ipv4.ts.
    expect(usableHosts(31)).toBe(2);
    expect(usableHosts(32)).toBe(1);
    expect(cloudUsableHosts(31, azure)).toBe(0);
    expect(cloudUsableHosts(32, azure)).toBe(0);
  });

  it("floors at zero rather than returning a negative count", () => {
    expect(cloudUsableHosts(30, azure)).toBe(0);
    expect(cloudUsableHosts(32, aws)).toBe(0);
  });

  it("a /24 leaves 251 usable", () => {
    expect(cloudUsableHosts(24, azure)).toBe(251);
  });

  it("rejects prefixes outside 0-32", () => {
    expect(() => cloudUsableHosts(-1, azure)).toThrow(RangeError);
    expect(() => cloudUsableHosts(33, azure)).toThrow(RangeError);
    expect(() => cloudUsableHosts(24.5, azure)).toThrow(RangeError);
  });
});

describe("prefixForHosts", () => {
  it("returns the tightest fit, accounting for the 5 reserved", () => {
    // 3 usable is exactly a /29; 4 must step up to /28.
    expect(prefixForHosts(3, azure)).toBe(29);
    expect(prefixForHosts(4, azure)).toBe(28);
    expect(prefixForHosts(11, azure)).toBe(28);
    expect(prefixForHosts(12, azure)).toBe(27);
  });

  it("never returns a prefix the platform would reject", () => {
    expect(prefixForHosts(1, azure)).toBe(azure.maxPrefix);
    expect(prefixForHosts(1, aws)).toBe(aws.maxPrefix);
  });

  it("returns null when even the platform's largest subnet cannot cover the ask", () => {
    expect(prefixForHosts(2 ** 31, azure)).toBeNull();
    expect(prefixForHosts(2 ** 20, aws)).toBeNull();
  });

  it("rejects a negative or fractional host count", () => {
    expect(() => prefixForHosts(-1, azure)).toThrow(RangeError);
    expect(() => prefixForHosts(2.5, azure)).toThrow(RangeError);
  });
});

describe("isPrefixAllowed", () => {
  it("Azure permits /2 through /29", () => {
    expect(isPrefixAllowed(2, azure)).toBe(true);
    expect(isPrefixAllowed(29, azure)).toBe(true);
    expect(isPrefixAllowed(1, azure)).toBe(false);
    expect(isPrefixAllowed(30, azure)).toBe(false);
  });

  it("AWS permits /16 through /28, a narrower window than Azure", () => {
    expect(isPrefixAllowed(16, aws)).toBe(true);
    expect(isPrefixAllowed(28, aws)).toBe(true);
    expect(isPrefixAllowed(15, aws)).toBe(false);
    expect(isPrefixAllowed(29, aws)).toBe(false);
  });

  it("a /29 is legal on Azure and illegal on AWS", () => {
    expect(isPrefixAllowed(29, azure)).toBe(true);
    expect(isPrefixAllowed(29, aws)).toBe(false);
  });
});

describe("resize policy", () => {
  it("encodes the behavioral split that changes what headroom means", () => {
    expect(azure.resize.resizable).toBe(true);
    expect(aws.resize.resizable).toBe(false);
  });

  it("every resize policy carries the caveat that makes the yes/no honest", () => {
    for (const platform of PLATFORMS) {
      expect(platform.resize.detail.length).toBeGreaterThan(20);
      expect(platform.reservedDetail.length).toBeGreaterThan(20);
    }
  });
});
