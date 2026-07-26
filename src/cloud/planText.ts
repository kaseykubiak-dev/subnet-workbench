/**
 * Subnet Workbench: the indented plan-text format.
 *
 * Text in, `AddressPlan` out, so Plan mode is a paste rather than a form. The
 * shape mirrors how people already write address plans in a wiki page:
 *
 *   region eastus 10.20.0.0/14
 *     vnet hub 10.20.0.0/22
 *       GatewaySubnet        10.20.0.0/27
 *       AzureFirewallSubnet  10.20.0.64/26
 *     vnet prod-aks 10.20.8.0/21
 *       aks-nodes            10.20.8.0/22
 *
 *   external on-prem-datacenter 10.20.8.0/22  # ExpressRoute
 *
 * TWO WAYS TO SAY THE SAME THING, ON PURPOSE. A leading keyword (`region`,
 * `vnet`, `subnet`, `external`) is authoritative. Without one, indentation
 * decides: deeper than the open VNet is a subnet, deeper than the open region
 * is a VNet, level with or shallower than the region is a new region. Both
 * work, and mixing them works, because the input this competes with is a
 * paste out of a spreadsheet where the indentation survived and the keywords
 * did not, or a hand-typed list where the reverse is true.
 *
 * REGIONS ARE OPTIONAL. Anything that needs a region and has none gets one
 * synthetic region covering 0.0.0.0/0, named "(no region)". A region supernet
 * is a planning construct, not a platform object, so inventing a real-looking
 * one would manufacture "VNet sits outside its supernet" warnings about a
 * boundary the person never drew. A /0 contains everything, so the check
 * simply says nothing, which is the honest answer when no supernet was
 * declared.
 *
 * A COMPLETELY FLAT PASTE still works. With no keywords and no indentation
 * every line reads as a region, which would leave a plan of empty regions and
 * nothing to check. When the parse ends that way, the regions are reread as
 * VNets under the implicit region, so pasting a bare list of VNet CIDRs gets
 * the cross-region overlap check that is the whole point of the mode.
 *
 * Bad lines are reported and skipped, matching src/engine/parse.ts: one typo
 * in a forty-line plan should not blank the whole report.
 */

import { ipToNumber, networkAddress } from "../engine/ipv4";
import { parseSubnetLine, type ParseError } from "../engine/parse";
import type {
  AddressPlan,
  ExternalRange,
  PlanRegion,
  PlanSubnet,
  PlanVnet,
} from "./hierarchy";
import type { PlatformId } from "./platforms";

export interface PlanTextResult {
  plan: AddressPlan;
  errors: ParseError[];
}

/** Name given to the synthetic region when a paste declares none. */
export const IMPLICIT_REGION_NAME = "(no region)";

type Keyword = "region" | "vnet" | "subnet" | "external";

const KEYWORDS: Record<string, Keyword> = {
  region: "region",
  supernet: "region",
  vnet: "vnet",
  vpc: "vnet",
  subnet: "subnet",
  external: "external",
  onprem: "external",
  "on-prem": "external",
};

/** Leading whitespace in columns, a tab counting as two spaces. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  return lead.length + (lead.match(/\t/g)?.length ?? 0);
}

/** Split a trailing `#` or `//` comment off, keeping it as the detail text. */
function splitComment(text: string): { body: string; comment?: string } {
  const at = text.search(/(?:^|\s)(?:#|\/\/)/);
  if (at === -1) return { body: text };
  const comment = text
    .slice(at)
    .replace(/^\s*(?:#|\/\/)\s*/, "")
    .trim();
  const body = text.slice(0, at).trim();
  return comment === "" ? { body } : { body, comment };
}

/** True when the token could start an address ("10.0.0.0" or "10.0.0.0/24"). */
function startsAddress(token: string): boolean {
  const head = token.split("/")[0] ?? "";
  return ipToNumber(head) !== null;
}

interface Entry {
  keyword?: Keyword;
  indent: number;
  name: string;
  network: number;
  prefix: number;
  detail?: string;
  lineNumber: number;
  raw: string;
}

/**
 * One line into an entry, or an error.
 *
 * The name is whatever precedes the first token that looks like an address,
 * so both `aks-nodes 10.20.8.0/22` and `aks-nodes 10.20.8.0 255.255.252.0`
 * land the same way. Address parsing itself is delegated to parseSubnetLine
 * rather than reimplemented, so every notation Overlap mode accepts is
 * accepted here too.
 */
function parseEntry(line: string, lineNumber: number): Entry | ParseError {
  const indent = indentOf(line);
  const { body, comment } = splitComment(line.trim());
  const fail = (message: string): ParseError => ({ lineNumber, raw: line.trim(), message });
  if (body === "") return fail("nothing on this line but a comment");

  const tokens = body.split(/\s+/);
  let keyword: Keyword | undefined;
  const head = tokens[0]?.toLowerCase().replace(/:$/, "") ?? "";
  if (head in KEYWORDS && !startsAddress(tokens[0] ?? "")) {
    keyword = KEYWORDS[head];
    tokens.shift();
  }

  const addressAt = tokens.findIndex(startsAddress);
  if (addressAt === -1) {
    return fail(`no CIDR on this line (expected something like "name 10.0.0.0/24")`);
  }

  // A trailing colon is how people write "hub:" above an indented block.
  const name = tokens.slice(0, addressAt).join(" ").replace(/:$/, "").trim();
  const parsed = parseSubnetLine(tokens.slice(addressAt).join(" "), lineNumber);
  if ("message" in parsed) return { ...parsed, raw: line.trim() };

  const entry: Entry = {
    indent,
    name: name === "" ? `${parsed.prefix === 32 ? "host" : "block"} on line ${lineNumber}` : name,
    network: networkAddress(parsed.address, parsed.prefix),
    prefix: parsed.prefix,
    lineNumber,
    raw: line.trim(),
  };
  if (keyword !== undefined) entry.keyword = keyword;
  if (comment !== undefined) entry.detail = comment;
  // A trailing label on the address half ("10.0.0.0/24 hub") names it too.
  if (name === "" && parsed.label !== undefined) entry.name = parsed.label;
  return entry;
}

function isSkippable(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#") || t.startsWith("//");
}

/** Parse a whole plan paste. */
export function parsePlanText(text: string, platform: PlatformId): PlanTextResult {
  const errors: ParseError[] = [];
  const regions: PlanRegion[] = [];
  const external: ExternalRange[] = [];

  let region: PlanRegion | null = null;
  let regionIndent = 0;
  let vnet: PlanVnet | null = null;
  let vnetIndent = 0;

  /** The region everything hangs off when the paste declared none. */
  const openImplicitRegion = (): PlanRegion => {
    const implicit: PlanRegion = {
      name: IMPLICIT_REGION_NAME,
      network: 0,
      prefix: 0,
      vnets: [],
    };
    regions.push(implicit);
    region = implicit;
    regionIndent = -1;
    return implicit;
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || isSkippable(line)) continue;
    const entry = parseEntry(line, i + 1);
    if ("message" in entry) {
      errors.push(entry);
      continue;
    }

    // Keyword wins; otherwise indentation places the line in the open tree.
    let level: Keyword;
    if (entry.keyword !== undefined) {
      level = entry.keyword;
    } else if (region === null || entry.indent <= regionIndent) {
      level = "region";
    } else if (vnet === null || entry.indent <= vnetIndent) {
      level = "vnet";
    } else {
      level = "subnet";
    }

    if (level === "external") {
      const range: ExternalRange = {
        name: entry.name,
        network: entry.network,
        prefix: entry.prefix,
      };
      if (entry.detail !== undefined) range.detail = entry.detail;
      external.push(range);
      continue;
    }

    if (level === "region") {
      region = { name: entry.name, network: entry.network, prefix: entry.prefix, vnets: [] };
      regions.push(region);
      regionIndent = entry.indent;
      vnet = null;
      continue;
    }

    if (level === "vnet") {
      const parent = region ?? openImplicitRegion();
      vnet = { name: entry.name, network: entry.network, prefix: entry.prefix, subnets: [] };
      parent.vnets.push(vnet);
      vnetIndent = entry.indent;
      continue;
    }

    if (vnet === null) {
      errors.push({
        lineNumber: entry.lineNumber,
        raw: entry.raw,
        message: "a subnet needs a VNet above it; add a vnet line or outdent this one",
      });
      continue;
    }
    const subnet: PlanSubnet = {
      name: entry.name,
      network: entry.network,
      prefix: entry.prefix,
    };
    vnet.subnets.push(subnet);
  }

  // A flat paste reads as all-regions-no-VNets, which has nothing to check.
  // Reread it one level down rather than reporting an empty plan.
  const flat = regions.length > 0 && regions.every((r) => r.vnets.length === 0);
  const finalRegions: PlanRegion[] = flat
    ? [
        {
          name: IMPLICIT_REGION_NAME,
          network: 0,
          prefix: 0,
          vnets: regions.map((r) => ({
            name: r.name,
            network: r.network,
            prefix: r.prefix,
            subnets: [],
          })),
        },
      ]
    : regions;

  const plan: AddressPlan = { platform, regions: finalRegions };
  if (external.length > 0) plan.external = external;
  return { plan, errors };
}
