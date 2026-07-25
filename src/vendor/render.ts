/**
 * Subnet Workbench: vendor template renderer.
 *
 * Small and strict: build a context of string values from a subnet, then
 * substitute {placeholders} in template lines. An unknown placeholder is a
 * template bug and throws, so a typo in templates.ts fails tests instead of
 * shipping literal braces to a copy button. <angle-bracket> tokens are left
 * untouched by design: they mark the values only the user can know.
 */

import {
  numberToIp,
  prefixToMask,
  prefixToWildcard,
  usableRange,
  type Subnet,
} from "../engine/ipv4";
import { VENDORS, type Vendor, type VendorTemplate } from "./templates";

export interface VendorContext {
  [key: string]: string;
}

/**
 * A config-safe object name: label when present (non-alphanumerics
 * collapsed to underscores), otherwise derived from the CIDR.
 */
export function sanitizeName(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned === "" ? "net" : cleaned;
}

/**
 * A symbolic name legal as an identifier in Terraform HCL and Bicep.
 *
 * sanitizeName alone is not enough: with no label it derives the name from the
 * CIDR, producing something like "10_0_0_0_24", and neither language accepts an
 * identifier that starts with a digit. Config CLIs do not care, which is why
 * this is a separate key rather than a change to sanitizeName.
 */
export function sanitizeIdentifier(label: string): string {
  const name = sanitizeName(label);
  return /^[A-Za-z_]/.test(name) ? name : `net_${name}`;
}

/** Build the substitution context for a subnet. */
export function templateContext(subnet: Subnet & { label?: string }): VendorContext {
  const range = usableRange(subnet.network, subnet.prefix);
  const cidr = `${numberToIp(subnet.network)}/${subnet.prefix}`;
  return {
    cidr,
    network: numberToIp(subnet.network),
    prefix: String(subnet.prefix),
    mask: numberToIp(prefixToMask(subnet.prefix)),
    wildcard: numberToIp(prefixToWildcard(subnet.prefix)),
    firstUsable: numberToIp(range.first),
    lastUsable: numberToIp(range.last),
    name: sanitizeName(subnet.label ?? cidr),
    identifier: sanitizeIdentifier(subnet.label ?? cidr),
  };
}

/** Substitute {placeholders}; throw on any key the context does not have. */
export function renderTemplate(template: VendorTemplate, ctx: VendorContext): string {
  return template.lines
    .map((line) =>
      line.replace(/\{(\w+)\}/g, (_, key: string) => {
        const value = ctx[key];
        if (value === undefined) {
          throw new Error(`template "${template.title}" uses unknown placeholder {${key}}`);
        }
        return value;
      })
    )
    .join("\n");
}

export interface RenderedTemplate {
  id: VendorTemplate["id"];
  title: string;
  text: string;
  note?: string;
}

/** Render every template of one vendor for one subnet. */
export function renderVendor(
  vendor: Vendor,
  subnet: Subnet & { label?: string }
): RenderedTemplate[] {
  const ctx = templateContext(subnet);
  return vendor.templates.map((t) => {
    const out: RenderedTemplate = { id: t.id, title: t.title, text: renderTemplate(t, ctx) };
    if (t.note !== undefined) out.note = t.note;
    return out;
  });
}

/** Look up a vendor by id. */
export function vendorById(id: Vendor["id"]): Vendor {
  const v = VENDORS.find((x) => x.id === id);
  if (v === undefined) throw new Error(`unknown vendor "${id}"`);
  return v;
}
