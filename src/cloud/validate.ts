/**
 * Subnet Workbench: cloud subnet validation.
 *
 * One subnet plus a platform in, an ordered list of findings out. Pure; no
 * formatting decisions and no DOM.
 *
 * Severity is deliberate. An "error" means the platform will reject the
 * deployment, so it is safe to block on. A "warning" means it will deploy but
 * you will regret it, which covers both sizing below the recommendation and
 * the cases where documentation is thinner than the folklore around it. The
 * name-casing check is the clearest example: reserved subnet names must be
 * spelled exactly, but no Microsoft page states the comparison is
 * case-sensitive, and ARM's general guidance says resource names compare
 * case-insensitively. So a near-miss like "Gatewaysubnet" warns rather than
 * failing, until someone confirms it against a live subscription.
 *
 * The same reasoning governs NSG and UDR support. "AzureFirewallSubnet does
 * not support NSGs" is a constraint on what you may attach later, not a defect
 * in the subnet being sized, so it warns by default and only becomes an error
 * when the caller sets `attachesNsg`. Without that split every correctly sized
 * GatewaySubnet would report as undeployable, which would make isDeployable
 * useless for exactly the subnets it matters most on.
 */

import {
  cloudUsableHosts,
  isPrefixAllowed,
  platformById,
  type Platform,
  type PlatformId,
} from "./platforms";
import {
  AZURE_SUBNET_RULES,
  azureRuleByName,
  azureRuleByNameInsensitive,
  type CloudSubnetRule,
} from "./rules";

export type Severity = "error" | "warning" | "info";

export interface CloudFinding {
  severity: Severity;
  message: string;
  /** What produced this finding: a platform id, a subnet rule name, or "size". */
  source: string;
}

export interface CloudSubnetInput {
  platform: PlatformId;
  /** The subnet's name. Matched against the platform's reserved names. */
  name?: string;
  prefix: number;
  /**
   * Condition keys that are active for this subnet, matched against a rule's
   * `conditions[].when` strings. Lets the caller say "Azure Firewall is
   * deployed in the hub" and get the stricter requirement.
   */
  activeConditions?: string[];
  /**
   * Whether the plan actually attaches an NSG or a UDR to this subnet.
   *
   * These change severity rather than adding findings. A subnet that does not
   * support NSGs is a constraint worth knowing about, but it is not a defect
   * in the subnet itself, so it stays a warning until the caller says an NSG
   * is being attached. Leaving these undefined means "not stated", which is
   * the common case when someone is only sizing address space.
   */
  attachesNsg?: boolean;
  attachesUdr?: boolean;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Format a prefix number as a CIDR suffix for messages. */
function slash(prefix: number): string {
  return `/${prefix}`;
}

/**
 * Check a prefix against a rule's hard minimum size, recommended size, maximum
 * size, and any active conditions.
 */
function checkRuleSize(
  rule: CloudSubnetRule,
  prefix: number,
  activeConditions: string[]
): CloudFinding[] {
  const findings: CloudFinding[] = [];

  // Conditions can only tighten the requirement, so take the strictest.
  let effectiveMax = rule.maxPrefix;
  let conditionReason: string | undefined;
  for (const condition of rule.conditions ?? []) {
    if (!activeConditions.includes(condition.when)) continue;
    if (condition.maxPrefix < effectiveMax) {
      effectiveMax = condition.maxPrefix;
      conditionReason = condition.reason;
    }
  }

  if (prefix > effectiveMax) {
    const because =
      conditionReason === undefined
        ? ""
        : ` (${conditionReason})`;
    findings.push({
      severity: "error",
      message:
        `${rule.name} requires ${slash(effectiveMax)} or larger; ` +
        `${slash(prefix)} is too small${because}.`,
      source: rule.name,
    });
  } else if (
    rule.recommendedMaxPrefix !== undefined &&
    prefix > rule.recommendedMaxPrefix
  ) {
    findings.push({
      severity: "warning",
      message:
        `${slash(prefix)} meets the ${rule.name} minimum but is below the ` +
        `recommended ${slash(rule.recommendedMaxPrefix)}.`,
      source: rule.name,
    });
  }

  if (rule.minPrefix !== undefined && prefix < rule.minPrefix) {
    findings.push({
      severity: "error",
      message:
        `${rule.name} has a maximum size of ${slash(rule.minPrefix)}; ` +
        `${slash(prefix)} is too large.`,
      source: rule.name,
    });
  }

  return findings;
}

/** Informational findings carried by a rule: NSG/UDR support, delegation, notes. */
function ruleContext(
  rule: CloudSubnetRule,
  attachesNsg: boolean,
  attachesUdr: boolean
): CloudFinding[] {
  const findings: CloudFinding[] = [];

  if (rule.nsg === "unsupported") {
    findings.push({
      severity: attachesNsg ? "error" : "warning",
      message: attachesNsg
        ? `${rule.name} does not support NSGs, and this plan attaches one. The deployment will be rejected or the service will break.`
        : `${rule.name} does not support NSGs. Attaching one will break the service or be rejected.`,
      source: rule.name,
    });
  } else if (rule.nsg === "required-rules") {
    findings.push({
      severity: "warning",
      message: `${rule.name} supports NSGs, but an attached NSG must carry every required rule or the service breaks.`,
      source: rule.name,
    });
  }

  if (rule.udr === "unsupported") {
    findings.push({
      severity: attachesUdr ? "error" : "warning",
      message: attachesUdr
        ? `${rule.name} does not support user-defined routes, and this plan attaches one.`
        : `${rule.name} does not support user-defined routes.`,
      source: rule.name,
    });
  }

  if (rule.delegation !== undefined) {
    findings.push({
      severity: "info",
      message: `${rule.name} must be delegated to ${rule.delegation}.`,
      source: rule.name,
    });
  }

  for (const note of rule.notes) {
    findings.push({ severity: "info", message: note, source: rule.name });
  }

  return findings;
}

/** Platform-level bounds and the reserved-address consequence of the size. */
function platformContext(platform: Platform, prefix: number): CloudFinding[] {
  const findings: CloudFinding[] = [];

  if (!isPrefixAllowed(prefix, platform)) {
    findings.push({
      severity: "error",
      message:
        `${platform.name} permits subnets from ${slash(platform.minPrefix)} to ` +
        `${slash(platform.maxPrefix)}; ${slash(prefix)} is outside that range.`,
      source: platform.id,
    });
    return findings;
  }

  const usable = cloudUsableHosts(prefix, platform);
  const total = 2 ** (32 - prefix);
  findings.push({
    severity: "info",
    message:
      `${slash(prefix)} on ${platform.name}: ${usable} usable of ${total} total. ` +
      `${platform.name} reserves ${platform.reservedPerSubnet} per subnet (${platform.reservedDetail})`,
    source: platform.id,
  });

  if (usable === 0) {
    findings.push({
      severity: "error",
      message: `${slash(prefix)} leaves no usable addresses after ${platform.name}'s reservations.`,
      source: platform.id,
    });
  }

  return findings;
}

/**
 * Validate one subnet against a platform.
 *
 * Findings come back sorted error first, then warning, then info, with the
 * original order preserved inside each severity so the most specific message
 * for a given rule stays on top.
 */
export function validateCloudSubnet(input: CloudSubnetInput): CloudFinding[] {
  const platform = platformById(input.platform);
  const findings: CloudFinding[] = [];

  if (platform.id === "none") return findings;

  findings.push(...platformContext(platform, input.prefix));

  const name = input.name?.trim();
  const conditions = input.activeConditions ?? [];
  const attachesNsg = input.attachesNsg ?? false;
  const attachesUdr = input.attachesUdr ?? false;

  if (platform.id === "azure" && name !== undefined && name !== "") {
    const exact = azureRuleByName(name);
    if (exact !== undefined) {
      findings.push(
        ...checkRuleSize(exact, input.prefix, conditions),
        ...ruleContext(exact, attachesNsg, attachesUdr)
      );
    } else {
      const nearMiss = azureRuleByNameInsensitive(name);
      if (nearMiss !== undefined) {
        findings.push({
          severity: "warning",
          message:
            `"${name}" differs only by capitalization from the reserved name ` +
            `"${nearMiss.name}". Reserved names must be spelled exactly; use "${nearMiss.name}".`,
          source: nearMiss.name,
        });
        findings.push(
          ...checkRuleSize(nearMiss, input.prefix, conditions),
          ...ruleContext(nearMiss, attachesNsg, attachesUdr)
        );
      }
    }
  }

  return stableSortBySeverity(findings);
}

/** Sort by severity while preserving insertion order within each severity. */
export function stableSortBySeverity(findings: CloudFinding[]): CloudFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
        a.index - b.index
    )
    .map((entry) => entry.finding);
}

/** True when nothing in the list would block a deployment. */
export function isDeployable(findings: CloudFinding[]): boolean {
  return !findings.some((f) => f.severity === "error");
}

/**
 * Every Azure rule whose minimum the given prefix satisfies. Answers the
 * question "what could this block actually be used for", which is the useful
 * direction when you are carving a hub VNet rather than checking one subnet.
 */
export function azureRulesFittingPrefix(prefix: number): CloudSubnetRule[] {
  return AZURE_SUBNET_RULES.filter(
    (rule) =>
      prefix <= rule.maxPrefix &&
      (rule.minPrefix === undefined || prefix >= rule.minPrefix)
  );
}
