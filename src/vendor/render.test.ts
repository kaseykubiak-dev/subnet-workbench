import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  renderVendor,
  sanitizeName,
  templateContext,
  vendorById,
} from "./render";
import { VENDORS } from "./templates";

const branch = { network: 0x0a000000, prefix: 26, label: "Site A" }; // 10.0.0.0/26

describe("templateContext", () => {
  it("derives every substitution value", () => {
    expect(templateContext(branch)).toEqual({
      cidr: "10.0.0.0/26",
      network: "10.0.0.0",
      prefix: "26",
      mask: "255.255.255.192",
      wildcard: "0.0.0.63",
      firstUsable: "10.0.0.1",
      lastUsable: "10.0.0.62",
      name: "Site_A",
    });
  });

  it("falls back to a CIDR-derived name without a label", () => {
    expect(templateContext({ network: 0x0a000000, prefix: 26 }).name).toBe("10_0_0_0_26");
  });

  it("/31 first usable is the network address itself", () => {
    const ctx = templateContext({ network: 0x0a000004, prefix: 31 });
    expect(ctx.firstUsable).toBe("10.0.0.4");
    expect(ctx.lastUsable).toBe("10.0.0.5");
  });
});

describe("sanitizeName", () => {
  it("collapses non-alphanumerics and trims", () => {
    expect(sanitizeName("Knoxville branch (mgmt)")).toBe("Knoxville_branch_mgmt");
    expect(sanitizeName("10.0.0.0/24")).toBe("10_0_0_0_24");
    expect(sanitizeName("!!!")).toBe("net");
  });
});

describe("vendor templates", () => {
  it("every template of every vendor renders with no leftover {placeholders}", () => {
    for (const vendor of VENDORS) {
      for (const r of renderVendor(vendor, branch)) {
        expect(r.text, `${vendor.id}/${r.id}`).not.toMatch(/\{\w+\}/);
        expect(r.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("all three vendors ship all four output types", () => {
    for (const vendor of VENDORS) {
      expect(vendor.templates.map((t) => t.id).sort()).toEqual([
        "address-object",
        "interface",
        "policy",
        "static-route",
      ]);
    }
  });

  it("Cisco ACL uses the wildcard mask, not the subnet mask", () => {
    const acl = renderVendor(vendorById("cisco-ios"), branch).find((r) => r.id === "policy")!;
    expect(acl.text).toBe("access-list 101 permit ip 10.0.0.0 0.0.0.63 any");
    expect(acl.note).toContain("wildcard");
  });

  it("Cisco static route uses network + mask", () => {
    const route = renderVendor(vendorById("cisco-ios"), branch).find(
      (r) => r.id === "static-route"
    )!;
    expect(route.text).toBe("ip route 10.0.0.0 255.255.255.192 <next-hop>");
  });

  it("FortiOS address object quotes the sanitized name", () => {
    const obj = renderVendor(vendorById("fortios"), branch).find(
      (r) => r.id === "address-object"
    )!;
    expect(obj.text).toContain('edit "Site_A"');
    expect(obj.text).toContain("set subnet 10.0.0.0 255.255.255.192");
  });

  it("pfSense alias keeps literal pf braces around the substituted CIDR", () => {
    const alias = renderVendor(vendorById("pfsense"), branch).find(
      (r) => r.id === "address-object"
    )!;
    expect(alias.text).toBe("table <Site_A> persist { 10.0.0.0/26 }");
  });

  it("user-fill <angle> tokens survive rendering", () => {
    const iface = renderVendor(vendorById("fortios"), branch).find(
      (r) => r.id === "interface"
    )!;
    expect(iface.text).toContain("edit <interface>");
    expect(iface.text).toContain("set ip 10.0.0.1 255.255.255.192");
  });
});

describe("renderTemplate strictness", () => {
  it("throws on an unknown placeholder instead of shipping braces", () => {
    const bad = { id: "policy" as const, title: "bad", lines: ["x {nope} y"] };
    expect(() => renderTemplate(bad, templateContext(branch))).toThrow(/\{nope\}/);
  });
});
