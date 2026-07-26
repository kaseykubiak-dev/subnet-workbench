import { describe, expect, it } from "vitest";

import { decodeShare, encodeShare, shareUrl } from "./share";
import { initialState } from "./state";
import type { ShellState } from "./state";

const populated: ShellState = {
  ...initialState,
  mode: "overlap",
  overlapInput: "Knoxville: 10.10.0.0/16\nNashville: 10.10.32.0/20",
  vlsmHeadroom: 30,
};

describe("encode / decode round trip", () => {
  it("restores the non-default fields", () => {
    const restored = decodeShare(encodeShare(populated));
    expect(restored).not.toBeNull();
    expect(restored?.mode).toBe("overlap");
    expect(restored?.overlapInput).toBe(populated.overlapInput);
    expect(restored?.vlsmHeadroom).toBe(30);
  });

  it("omits default fields from the payload", () => {
    const restored = decodeShare(encodeShare(populated));
    expect(restored).not.toHaveProperty("calculateInput");
    expect(restored).not.toHaveProperty("vendorId");
  });

  it("survives unicode labels", () => {
    const s = { ...initialState, calculateInput: "Zürich: 10.0.0.0/24" };
    expect(decodeShare(encodeShare(s))?.calculateInput).toBe("Zürich: 10.0.0.0/24");
  });

  it("produces URL-safe output", () => {
    const payload = encodeShare(populated);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries the platform, so a shared link validates the same way", () => {
    const s: ShellState = {
      ...initialState,
      platform: "azure",
      calculateInput: "GatewaySubnet: 10.0.0.0/28",
    };
    expect(decodeShare(encodeShare(s))?.platform).toBe("azure");
  });

  it("omits the platform at the on-prem default", () => {
    expect(decodeShare(encodeShare(populated))).not.toHaveProperty("platform");
  });

  it("carries a whole capacity plan", () => {
    const s: ShellState = {
      ...initialState,
      mode: "capacity",
      platform: "azure",
      aksMode: "azure-cni-overlay",
      aksNodes: 120,
      aksMaxPods: 250,
      aksMaxSurge: 10,
    };
    const restored = decodeShare(encodeShare(s));
    expect(restored?.aksMode).toBe("azure-cni-overlay");
    expect(restored?.aksNodes).toBe(120);
    expect(restored?.aksMaxPods).toBe(250);
    expect(restored?.aksMaxSurge).toBe(10);
  });

  it("carries the EKS plan including the custom-networking flag", () => {
    const s: ShellState = {
      ...initialState,
      platform: "aws",
      eksMode: "prefix-delegation",
      eksNodes: 40,
      eksEnisPerNode: 4,
      eksIpsPerEni: 15,
      eksPodsPerNode: 110,
      eksCustomNetworking: true,
    };
    const restored = decodeShare(encodeShare(s));
    expect(restored?.eksMode).toBe("prefix-delegation");
    expect(restored?.eksNodes).toBe(40);
    expect(restored?.eksEnisPerNode).toBe(4);
    expect(restored?.eksIpsPerEni).toBe(15);
    expect(restored?.eksPodsPerNode).toBe(110);
    expect(restored?.eksCustomNetworking).toBe(true);
  });

  it("omits a null max pods, so the mode default survives the round trip", () => {
    // null is skipped by encodeShare exactly like a default, and the decoder
    // never invents a number, so the box comes back empty on the other end.
    const restored = decodeShare(encodeShare({ ...initialState, aksNodes: 9 }));
    expect(restored).not.toHaveProperty("aksMaxPods");
    expect(restored?.aksNodes).toBe(9);
  });
});

describe("shareUrl", () => {
  it("carries the payload in the fragment", () => {
    const url = shareUrl("https://kaseykubiak.com/tools/subnet-workbench", populated);
    expect(url).toMatch(
      /^https:\/\/kaseykubiak\.com\/tools\/subnet-workbench#s=[A-Za-z0-9_-]+$/
    );
  });

  it("round-trips through the full fragment form", () => {
    const url = shareUrl("https://example.com/x", populated);
    const fragment = url.slice(url.indexOf("#"));
    expect(decodeShare(fragment)?.overlapInput).toBe(populated.overlapInput);
  });
});

describe("decodeShare hostile input", () => {
  it("rejects garbage", () => {
    expect(decodeShare("#s=!!!not-base64!!!")).toBeNull();
    expect(decodeShare("#s=aGVsbG8")).toBeNull(); // valid b64, not JSON object
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("#s=")).toBeNull();
  });

  it("rejects unknown versions", () => {
    const evil = btoa(JSON.stringify({ v: 99, mode: "overlap" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeShare(`#s=${evil}`)).toBeNull();
  });

  it("rejects an unknown platform id", () => {
    const evil = btoa(JSON.stringify({ v: 1, platform: "gcp" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeShare(`#s=${evil}`)).not.toHaveProperty("platform");
  });

  it("rejects an unknown AKS or EKS networking mode", () => {
    const evil = btoa(JSON.stringify({ v: 1, aksMode: "calico", eksMode: "ipv6-only" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const restored = decodeShare(`#s=${evil}`);
    expect(restored).not.toHaveProperty("aksMode");
    expect(restored).not.toHaveProperty("eksMode");
  });

  it("drops a non-boolean custom-networking flag", () => {
    const evil = btoa(JSON.stringify({ v: 1, eksCustomNetworking: "yes", eksNodes: 3 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const restored = decodeShare(`#s=${evil}`);
    expect(restored).not.toHaveProperty("eksCustomNetworking");
    expect(restored?.eksNodes).toBe(3);
  });

  it("drops fields with wrong types instead of failing", () => {
    const sneaky = btoa(
      JSON.stringify({ v: 1, mode: "nonsense", overlapInput: "10.0.0.0/24", vlsmHeadroom: "NaN" })
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const restored = decodeShare(`#s=${sneaky}`);
    expect(restored).not.toBeNull();
    expect(restored).not.toHaveProperty("mode");
    expect(restored).not.toHaveProperty("vlsmHeadroom");
    expect(restored?.overlapInput).toBe("10.0.0.0/24");
  });
});
