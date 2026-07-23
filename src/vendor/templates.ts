/**
 * Subnet Workbench: vendor syntax templates (pure data).
 *
 * A template layer, not a feature: any subnet the tool produces can be
 * rendered as config text through these templates. Adding a vendor is an
 * edit to this file, never a code change.
 *
 * Placeholder conventions:
 *   {curly}   - filled in by the renderer from the subnet (see render.ts
 *               for the full key list: cidr, network, prefix, mask,
 *               wildcard, firstUsable, lastUsable, name)
 *   <angle>   - deliberately left for the user; things the tool cannot
 *               know (interface names, next hops). Never substituted.
 *
 * Platform choices per the plan: FortiOS (daily-work platform), Cisco IOS
 * (carries the wildcard-mask conversion, the most-fumbled thing in this
 * space), pfSense (multi-vendor story, home lab). Meraki is deliberately
 * excluded: no config CLI worth printing.
 */

export interface VendorTemplate {
  id: "interface" | "static-route" | "address-object" | "policy";
  title: string;
  /** Template lines; joined with newlines after substitution. */
  lines: string[];
  /** Honest caveat shown with the output, when one is needed. */
  note?: string;
}

export type VendorId = "fortios" | "cisco-ios" | "pfsense";

export interface Vendor {
  id: VendorId;
  name: string;
  templates: VendorTemplate[];
}

export const VENDORS: Vendor[] = [
  {
    id: "fortios",
    name: "FortiOS",
    templates: [
      {
        id: "interface",
        title: "Interface address",
        lines: [
          "config system interface",
          "    edit <interface>",
          "        set ip {firstUsable} {mask}",
          "    next",
          "end",
        ],
        note: "Uses the first usable address; adjust if the gateway sits elsewhere.",
      },
      {
        id: "static-route",
        title: "Static route",
        lines: [
          "config router static",
          "    edit 0",
          "        set dst {network} {mask}",
          "        set gateway <next-hop>",
          "        set device <interface>",
          "    next",
          "end",
        ],
        note: "edit 0 auto-assigns the next free route index.",
      },
      {
        id: "address-object",
        title: "Firewall address object",
        lines: [
          "config firewall address",
          '    edit "{name}"',
          "        set subnet {network} {mask}",
          "    next",
          "end",
        ],
      },
      {
        id: "policy",
        title: "Firewall policy entry",
        lines: [
          "config firewall policy",
          "    edit 0",
          '        set name "allow-{name}"',
          "        set srcintf <lan-interface>",
          "        set dstintf <wan-interface>",
          '        set srcaddr "{name}"',
          '        set dstaddr "all"',
          '        set service "ALL"',
          '        set schedule "always"',
          "        set action accept",
          "    next",
          "end",
        ],
        note: "Assumes the address object above exists; tighten service before production.",
      },
    ],
  },
  {
    id: "cisco-ios",
    name: "Cisco IOS",
    templates: [
      {
        id: "interface",
        title: "Interface address",
        lines: [
          "interface <interface>",
          " ip address {firstUsable} {mask}",
          " no shutdown",
        ],
        note: "Uses the first usable address; adjust if the gateway sits elsewhere.",
      },
      {
        id: "static-route",
        title: "Static route",
        lines: ["ip route {network} {mask} <next-hop>"],
      },
      {
        id: "address-object",
        title: "Network object-group",
        lines: ["object-group network {name}", " {network} {mask}"],
      },
      {
        id: "policy",
        title: "Extended ACL entry",
        lines: ["access-list 101 permit ip {network} {wildcard} any"],
        note: "ACLs take the wildcard mask, not the subnet mask; the inversion is done for you.",
      },
    ],
  },
  {
    id: "pfsense",
    name: "pfSense",
    templates: [
      {
        id: "interface",
        title: "Interface address",
        lines: ["ifconfig <interface> inet {firstUsable} netmask {mask}"],
        note: "FreeBSD shell command; persistent assignment lives in Interfaces in the GUI.",
      },
      {
        id: "static-route",
        title: "Static route",
        lines: ["route add -net {cidr} <next-hop>"],
        note: "FreeBSD shell command; persistent routes live under System > Routing.",
      },
      {
        id: "address-object",
        title: "Alias (pf table)",
        lines: ["table <{name}> persist { {cidr} }"],
        note: "Raw pf syntax; in the GUI this is Firewall > Aliases.",
      },
      {
        id: "policy",
        title: "Firewall rule (pf)",
        lines: ["pass in on <interface> from {cidr} to any"],
        note: "Raw pf syntax; in the GUI this is Firewall > Rules.",
      },
    ],
  },
];
