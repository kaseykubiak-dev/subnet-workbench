import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  renderVendor,
  sanitizeIdentifier,
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
      identifier: "Site_A",
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

  it("every vendor ships all four output types", () => {
    expect(VENDORS.length).toBeGreaterThanOrEqual(5);
    for (const vendor of VENDORS) {
      expect(vendor.templates.map((t) => t.id).sort(), vendor.id).toEqual([
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

describe("sanitizeIdentifier", () => {
  it("leaves a label-derived name alone", () => {
    expect(sanitizeIdentifier("Site A")).toBe("Site_A");
    expect(sanitizeIdentifier("_hub")).toBe("hub");
  });

  it("prefixes a CIDR-derived name, which would otherwise start with a digit", () => {
    // Illegal as a Terraform or Bicep identifier without the prefix.
    expect(sanitizeName("10.0.0.0/24")).toBe("10_0_0_0_24");
    expect(sanitizeIdentifier("10.0.0.0/24")).toBe("net_10_0_0_0_24");
  });

  it("every identifier it produces is a legal HCL and Bicep identifier", () => {
    for (const label of ["Site A", "10.0.0.0/24", "!!!", "2nd floor", "192.168.1.0/26"]) {
      expect(sanitizeIdentifier(label), label).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });
});

describe("IaC targets", () => {
  const unlabeled = { network: 0x0a000000, prefix: 26 };

  it("Terraform subnet carries the CIDR as a list and quotes the name", () => {
    const subnet = renderVendor(vendorById("terraform"), branch).find(
      (r) => r.id === "interface"
    )!;
    expect(subnet.text).toContain('resource "azurerm_subnet" "Site_A" {');
    expect(subnet.text).toContain('address_prefixes     = ["10.0.0.0/26"]');
    expect(subnet.note).toContain("reserves 5 addresses");
  });

  it("Bicep subnet is a child resource, not inline in the VNet", () => {
    const subnet = renderVendor(vendorById("bicep"), branch).find((r) => r.id === "interface")!;
    expect(subnet.text).toContain(
      "resource Site_A 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {"
    );
    expect(subnet.text).toContain("addressPrefix: '10.0.0.0/26'");
  });

  it("both IaC targets use the safe identifier, not the raw name", () => {
    for (const id of ["terraform", "bicep"] as const) {
      for (const r of renderVendor(vendorById(id), unlabeled)) {
        // A bare 10_0_0_0_26 as a symbolic name would not parse.
        expect(r.text, `${id}/${r.id}`).not.toMatch(/(resource|param|locals)[^\n]*\s10_0_0_0_26/);
      }
    }
  });

  it("Terraform address-object is a local, since Azure has no such resource", () => {
    const obj = renderVendor(vendorById("terraform"), branch).find(
      (r) => r.id === "address-object"
    )!;
    expect(obj.text).toBe('locals {\n  Site_A_cidr = "10.0.0.0/26"\n}');
    expect(obj.note).toContain("no address-object resource");
  });

  it("Bicep address-object is a parameter with a default", () => {
    const obj = renderVendor(vendorById("bicep"), branch).find(
      (r) => r.id === "address-object"
    )!;
    expect(obj.text).toBe("param Site_ACidr string = '10.0.0.0/26'");
  });

  it("NSG rules leave priority for the user, since it must be unique in the NSG", () => {
    for (const id of ["terraform", "bicep"] as const) {
      const policy = renderVendor(vendorById(id), branch).find((r) => r.id === "policy")!;
      expect(policy.text, id).toContain("<100-4096>");
      expect(policy.note, id).toContain("unique");
    }
  });

  it("route templates flag that next hop IP only applies to VirtualAppliance", () => {
    for (const id of ["terraform", "bicep"] as const) {
      const route = renderVendor(vendorById(id), branch).find((r) => r.id === "static-route")!;
      expect(route.text, id).toContain("VirtualAppliance");
      expect(route.text, id).toContain("<next-hop>");
      expect(route.note, id).toContain("VirtualAppliance");
    }
  });

  it("Bicep's structural braces survive rendering", () => {
    const subnet = renderVendor(vendorById("bicep"), branch).find((r) => r.id === "interface")!;
    expect(subnet.text).toContain("properties: {");
    expect(subnet.text.trimEnd().endsWith("}")).toBe(true);
  });
});

describe("renderTemplate strictness", () => {
  it("throws on an unknown placeholder instead of shipping braces", () => {
    const bad = { id: "policy" as const, title: "bad", lines: ["x {nope} y"] };
    expect(() => renderTemplate(bad, templateContext(branch))).toThrow(/\{nope\}/);
  });
});
