/**
 * Opt-in shareable links.
 *
 * Encoding happens ONLY when the user clicks "Copy shareable link" — never
 * live URL sync as they type. The deliberate action is the safeguard: these
 * payloads contain customer addressing, and once in a URL they propagate
 * into ticket systems, chat logs, and browser history.
 *
 * Payload: compact JSON of the non-default state fields, UTF-8, base64url,
 * carried in the fragment (`#s=...`) so it never reaches a server log.
 */

import type { ShellState } from "./state";
import { initialState } from "./state";
import { PLATFORMS } from "../cloud/platforms";
import { VENDORS } from "../vendor/templates";

const FRAGMENT_KEY = "s";

/** Version tag so a future payload change can stay decodable. */
const VERSION = 1;

type SharePayload = { v: number } & Partial<
  Pick<
    ShellState,
    | "mode"
    | "platform"
    | "calculateInput"
    | "calculateSelected"
    | "splitTarget"
    | "overlapInput"
    | "vlsmSupernetInput"
    | "vlsmRequirementsInput"
    | "vlsmHeadroom"
    | "vendorInput"
    | "vendorId"
  >
>;

const SHARE_KEYS = [
  "mode",
  "platform",
  "calculateInput",
  "calculateSelected",
  "splitTarget",
  "overlapInput",
  "vlsmSupernetInput",
  "vlsmRequirementsInput",
  "vlsmHeadroom",
  "vendorInput",
  "vendorId",
] as const;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa exists in browsers and Node 16+.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Encode the sharable subset of state as a fragment value. */
export function encodeShare(state: ShellState): string {
  const payload: SharePayload = { v: VERSION };
  for (const key of SHARE_KEYS) {
    const value = state[key];
    if (value !== initialState[key] && value !== null && value !== "") {
      // Payload stays Partial<ShellState>; assignment through a narrow view.
      (payload as Record<string, unknown>)[key] = value;
    }
  }
  const json = JSON.stringify(payload);
  return toBase64Url(new TextEncoder().encode(json));
}

/** Full URL for the copy button. */
export function shareUrl(baseUrl: string, state: ShellState): string {
  return `${baseUrl}#${FRAGMENT_KEY}=${encodeShare(state)}`;
}

/** Decode a fragment ("#s=..." or the bare payload). Null when invalid. */
export function decodeShare(fragment: string): Partial<ShellState> | null {
  let payload = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (payload.startsWith(`${FRAGMENT_KEY}=`)) {
    payload = payload.slice(FRAGMENT_KEY.length + 1);
  }
  if (payload === "") return null;
  const bytes = fromBase64Url(payload);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw["v"] !== VERSION) return null;

  const out: Partial<ShellState> = {};
  const modes = ["calculate", "overlap", "vlsm", "vendor"];
  const vendorIds = VENDORS.map((v) => v.id as string);
  const platformIds = PLATFORMS.map((p) => p.id as string);
  if (typeof raw["mode"] === "string" && modes.includes(raw["mode"])) {
    out.mode = raw["mode"] as ShellState["mode"];
  }
  if (typeof raw["platform"] === "string" && platformIds.includes(raw["platform"])) {
    out.platform = raw["platform"] as ShellState["platform"];
  }
  for (const key of [
    "calculateInput",
    "overlapInput",
    "vlsmSupernetInput",
    "vlsmRequirementsInput",
    "vendorInput",
  ] as const) {
    if (typeof raw[key] === "string") out[key] = raw[key];
  }
  for (const key of ["calculateSelected", "splitTarget", "vlsmHeadroom"] as const) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) {
      out[key] = raw[key];
    }
  }
  if (typeof raw["vendorId"] === "string" && vendorIds.includes(raw["vendorId"])) {
    out.vendorId = raw["vendorId"] as ShellState["vendorId"];
  }
  return out;
}
