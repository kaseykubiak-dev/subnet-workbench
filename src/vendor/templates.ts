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
 *               wildcard, firstUsable, lastUsable, name, identifier)
 *   <angle>   - deliberately left for the user; things the tool cannot
 *               know (interface names, next hops). Never substituted.
 *
 * Platform choices per the plan: FortiOS (daily-work platform), Cisco IOS
 * (carries the wildcard-mask conversion, the most-fumbled thing in this
 * space), pfSense (multi-vendor story, home lab). Meraki is deliberately
 * excluded: no config CLI worth printing.
 *
 * Terraform and Bicep are the cloud-mode additions. They stretch the four
 * output types rather than fitting them cleanly, and the mapping is stated
 * here rather than left implicit:
 *
 *   interface       the subnet resource itself, since that is where the
 *                   address range is actually declared
 *   static-route    a route in a route table
 *   address-object  the named CIDR as a reusable value (a local / variable),
 *                   which is how the CIDR gets referenced in practice; Azure
 *                   has no first-class address-object resource
 *   policy          an NSG rule scoped to the prefix
 *
 * These are snippets, not modules. They assume the VNet, route table, and NSG
 * already exist and are referenced by name, because the tool knows about one
 * subnet and inventing surrounding resources would be guessing.
 */

export interface VendorTemplate {
  id: "interface" | "static-route" | "address-object" | "policy";
  title: string;
  /** Template lines; joined with newlines after substitution. */
  lines: string[];
  /** Honest caveat shown with the output, when one is needed. */
  note?: string;
}

export type VendorId = "fortios" | "cisco-ios" | "pfsense" | "terraform" | "bicep";

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
  {
    id: "terraform",
    name: "Terraform (azurerm)",
    templates: [
      {
        id: "interface",
        title: "Subnet resource",
        lines: [
          'resource "azurerm_subnet" "{identifier}" {',
          '  name                 = "{name}"',
          "  resource_group_name  = <resource-group>",
          "  virtual_network_name = <vnet-name>",
          '  address_prefixes     = ["{cidr}"]',
          "}",
        ],
        note: "Azure reserves 5 addresses in this subnet, not 2. Sized for the range only; add delegation or service endpoints as the service requires.",
      },
      {
        id: "static-route",
        title: "Route table entry",
        lines: [
          'resource "azurerm_route" "{identifier}" {',
          '  name                = "{name}"',
          "  resource_group_name = <resource-group>",
          "  route_table_name    = <route-table-name>",
          '  address_prefix      = "{cidr}"',
          '  next_hop_type       = "VirtualAppliance"',
          '  next_hop_in_ip_address = "<next-hop>"',
          "}",
        ],
        note: "next_hop_in_ip_address is only valid with next_hop_type VirtualAppliance; drop it for Internet, VnetLocal, VirtualNetworkGateway or None.",
      },
      {
        id: "address-object",
        title: "Named CIDR local",
        lines: ["locals {", '  {identifier}_cidr = "{cidr}"', "}"],
        note: "Azure has no address-object resource. A local keeps the prefix in one place so rules and routes reference it rather than repeating the literal.",
      },
      {
        id: "policy",
        title: "Network security rule",
        lines: [
          'resource "azurerm_network_security_rule" "allow_{identifier}" {',
          '  name                        = "allow-{name}"',
          "  resource_group_name         = <resource-group>",
          "  network_security_group_name = <nsg-name>",
          "  priority                    = <100-4096>",
          '  direction                   = "Inbound"',
          '  access                      = "Allow"',
          '  protocol                    = "*"',
          '  source_address_prefix       = "{cidr}"',
          '  source_port_range           = "*"',
          '  destination_address_prefix  = "*"',
          '  destination_port_range      = "*"',
          "}",
        ],
        note: "Priority must be unique within the NSG. Tighten protocol and ports before production; this opens everything from the prefix.",
      },
    ],
  },
  {
    id: "bicep",
    name: "Bicep",
    templates: [
      {
        id: "interface",
        title: "Subnet resource",
        lines: [
          "resource {identifier} 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {",
          "  name: '<vnet-name>/{name}'",
          "  properties: {",
          "    addressPrefix: '{cidr}'",
          "  }",
          "}",
        ],
        note: "Azure reserves 5 addresses in this subnet, not 2. Declaring subnets as child resources rather than inline in the VNet avoids the loop where redeploying the VNet drops subnets it does not list.",
      },
      {
        id: "static-route",
        title: "Route table entry",
        lines: [
          "resource {identifier}Route 'Microsoft.Network/routeTables/routes@2024-05-01' = {",
          "  name: '<route-table-name>/{name}'",
          "  properties: {",
          "    addressPrefix: '{cidr}'",
          "    nextHopType: 'VirtualAppliance'",
          "    nextHopIpAddress: '<next-hop>'",
          "  }",
          "}",
        ],
        note: "nextHopIpAddress is only valid with nextHopType VirtualAppliance; omit it for Internet, VnetLocal, VirtualNetworkGateway or None.",
      },
      {
        id: "address-object",
        title: "Named CIDR parameter",
        lines: ["param {identifier}Cidr string = '{cidr}'"],
        note: "Azure has no address-object resource. A parameter with a default keeps the prefix in one place and still allows an override per environment.",
      },
      {
        id: "policy",
        title: "Network security rule",
        lines: [
          "resource allow{identifier} 'Microsoft.Network/networkSecurityGroups/securityRules@2024-05-01' = {",
          "  name: '<nsg-name>/allow-{name}'",
          "  properties: {",
          "    priority: <100-4096>",
          "    direction: 'Inbound'",
          "    access: 'Allow'",
          "    protocol: '*'",
          "    sourceAddressPrefix: '{cidr}'",
          "    sourcePortRange: '*'",
          "    destinationAddressPrefix: '*'",
          "    destinationPortRange: '*'",
          "  }",
          "}",
        ],
        note: "Priority must be unique within the NSG. Tighten protocol and ports before production; this opens everything from the prefix.",
      },
    ],
  },
];
