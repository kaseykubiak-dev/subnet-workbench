/**
 * Subnet Workbench: Calculate mode (text output).
 *
 * Single subnet in, full derivation out. This module turns a ParsedSubnet
 * into a display-ready result: an ordered list of labeled fields (strings,
 * ready to render as rows) plus contextual notes for the cases that matter
 * (/31 per RFC 3021, /32 host routes, host bits set in the entered address).
 *
 * The math lives in the engine; this layer only formats.
 */

import { numberToIp, subnetInfo, type SubnetInfo } from "../engine/ipv4";
import type { ParsedSubnet } from "../engine/parse";

export interface CalculateField {
  label: string;
  value: string;
}

export interface CalculateResult {
  subnet: ParsedSubnet;
  info: SubnetInfo;
  fields: CalculateField[];
  notes: string[];
}

/** Deterministic thousands grouping (locale-independent). */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Full derivation, formatted for display. */
export function calculate(subnet: ParsedSubnet): CalculateResult {
  const info = subnetInfo(subnet.address, subnet.prefix);
  const fields: CalculateField[] = [];
  const notes: string[] = [];

  if (subnet.label !== undefined) {
    fields.push({ label: "Label", value: subnet.label });
  }

  fields.push(
    { label: "Network", value: `${numberToIp(info.network)}/${info.prefix}` },
    { label: "Netmask", value: numberToIp(info.mask) },
    { label: "Wildcard", value: numberToIp(info.wildcard) },
    {
      label: "Broadcast",
      value:
        info.broadcast === null
          ? info.prefix === 31
            ? "none (/31, RFC 3021)"
            : "none (host route)"
          : numberToIp(info.broadcast),
    },
    {
      label: "Usable range",
      value:
        info.firstUsable === info.lastUsable
          ? numberToIp(info.firstUsable)
          : `${numberToIp(info.firstUsable)} - ${numberToIp(info.lastUsable)}`,
    },
    { label: "Usable hosts", value: formatCount(info.usableHosts) },
    { label: "Total addresses", value: formatCount(info.totalHosts) },
    { label: "Address type", value: info.isRfc1918 ? "Private (RFC 1918)" : "Public" }
  );

  if (subnet.address !== info.network) {
    notes.push(
      `Entered address ${numberToIp(subnet.address)} has host bits set; ` +
        `the network is ${numberToIp(info.network)}/${info.prefix}.`
    );
  }
  if (info.prefix === 31) {
    notes.push(
      "/31 point-to-point (RFC 3021): no network or broadcast address; both addresses are usable."
    );
  }
  if (info.prefix === 32) {
    notes.push("/32 host route: a single address.");
  }

  return { subnet, info, fields, notes };
}

/** Plain-text rendering: aligned "Label  Value" rows, then notes. */
export function renderCalculateText(result: CalculateResult): string {
  const width = Math.max(...result.fields.map((f) => f.label.length));
  const rows = result.fields.map((f) => `${f.label.padEnd(width)}  ${f.value}`);
  const notes = result.notes.map((n) => `note: ${n}`);
  return [...rows, ...notes].join("\n");
}
