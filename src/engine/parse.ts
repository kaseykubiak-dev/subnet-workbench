/**
 * Subnet Workbench: forgiving input parser.
 *
 * Line-based, one subnet per line. Accepted forms, interchangeably:
 *
 *   10.0.0.0/24                    CIDR
 *   10.0.0.0 255.255.255.0         mask notation (FortiGate style)
 *   10.0.0.0/255.255.255.0         slash-mask hybrid seen in configs
 *   Site A: 10.0.0.0/24            leading label (colon required)
 *   10.0.0.0/24 Site A             trailing label
 *
 * Bad lines are flagged with a per-line error and the run proceeds; one typo
 * in a fifty-line paste never wipes out the whole result. Blank lines and
 * comment lines (# or //) are skipped silently.
 */

import { ipToNumber, maskToPrefix, networkAddress, numberToIp } from "./ipv4";

/** One successfully parsed line. */
export interface ParsedSubnet {
  /** The address exactly as entered (host bits preserved), as a number. */
  address: number;
  /** Normalized network address (host bits cleared). */
  network: number;
  prefix: number;
  label?: string;
  /** 1-based line number in the pasted text. */
  lineNumber: number;
  /** The raw line as pasted (trimmed). */
  raw: string;
}

/** One failed line. */
export interface ParseError {
  lineNumber: number;
  raw: string;
  message: string;
}

export interface ParseResult {
  subnets: ParsedSubnet[];
  errors: ParseError[];
}

const PREFIX_RE = /^\d{1,2}$/;

/** Interpret a token as a prefix length or a dotted mask. Null when neither. */
function tokenToPrefix(token: string): number | { error: string } | null {
  if (PREFIX_RE.test(token)) {
    const prefix = Number(token);
    if (prefix > 32) return { error: `prefix /${token} is out of range (0-32)` };
    return prefix;
  }
  const maskNum = ipToNumber(token);
  if (maskNum === null) return null;
  const prefix = maskToPrefix(maskNum);
  if (prefix === null) {
    return { error: `mask ${numberToIp(maskNum)} is not a valid subnet mask (non-contiguous)` };
  }
  return prefix;
}

/**
 * Parse one line into a subnet. `lineNumber` is carried into the result for
 * inline error reporting. Returns either a ParsedSubnet or a ParseError.
 */
export function parseSubnetLine(
  line: string,
  lineNumber = 1
): ParsedSubnet | ParseError {
  const raw = line.trim();
  const fail = (message: string): ParseError => ({ lineNumber, raw, message });

  // Leading label: everything before the first colon.
  let rest = raw;
  let label: string | undefined;
  const colonIdx = raw.indexOf(":");
  if (colonIdx !== -1) {
    label = raw.slice(0, colonIdx).trim();
    rest = raw.slice(colonIdx + 1).trim();
    if (label === "") return fail("empty label before the colon");
    if (rest === "") return fail("nothing after the label");
  }

  const tokens = rest.split(/\s+/);
  const first = tokens[0];
  if (first === undefined || first === "") return fail("empty line");

  let address: number | null = null;
  let prefix: number | null = null;
  let labelTokens: string[] = [];

  const slashIdx = first.indexOf("/");
  if (slashIdx !== -1) {
    // CIDR (10.0.0.0/24) or slash-mask hybrid (10.0.0.0/255.255.255.0).
    address = ipToNumber(first.slice(0, slashIdx));
    if (address === null) return fail(`invalid address "${first.slice(0, slashIdx)}"`);
    const p = tokenToPrefix(first.slice(slashIdx + 1));
    if (p === null) return fail(`invalid prefix or mask "${first.slice(slashIdx + 1)}"`);
    if (typeof p === "object") return fail(p.error);
    prefix = p;
    labelTokens = tokens.slice(1);
  } else {
    // Space-separated mask notation (10.0.0.0 255.255.255.0), or a bare IP.
    address = ipToNumber(first);
    if (address === null) return fail(`invalid address "${first}"`);
    const second = tokens[1];
    const p = second === undefined ? null : tokenToPrefix(second);
    if (p === null) {
      return fail(
        `"${first}" has no prefix or mask (use e.g. ${first}/24 or ${first} 255.255.255.0)`
      );
    }
    if (typeof p === "object") return fail(p.error);
    prefix = p;
    labelTokens = tokens.slice(2);
  }

  // Trailing tokens are a label, unless a leading label was already given.
  if (labelTokens.length > 0) {
    const trailing = labelTokens.join(" ");
    if (label !== undefined) {
      return fail(`unexpected trailing text "${trailing}" after a labeled subnet`);
    }
    label = trailing;
  }

  const subnet: ParsedSubnet = {
    address,
    network: networkAddress(address, prefix),
    prefix,
    lineNumber,
    raw,
  };
  if (label !== undefined) subnet.label = label;
  return subnet;
}

/** True when the line should be skipped silently (blank or comment). */
function isSkippable(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#") || t.startsWith("//");
}

/** Parse a full paste. Bad lines land in `errors`; good lines proceed. */
export function parseSubnetList(text: string): ParseResult {
  const subnets: ParsedSubnet[] = [];
  const errors: ParseError[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || isSkippable(line)) continue;
    const result = parseSubnetLine(line, i + 1);
    if ("message" in result) errors.push(result);
    else subnets.push(result);
  }
  return { subnets, errors };
}
