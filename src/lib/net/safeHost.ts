import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// One SSRF guard for every place OUR server connects to a host a TENANT
// typed: Account 360 sources, a tenant's own mail server (RFQ mailbox mode),
// the Dynamics 365 connector. Our egress can reach things a tenant's browser
// can't (cloud metadata, the deployment's private network), so the host must
// resolve to public addresses only. Extracted 2026-10-15 from
// account360/externalSource.ts so the rule exists once.

export const BLOCKED_HOST_MESSAGE = "That address points at a private or internal network";

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true;   // unique-local
    if (v6.startsWith("fe80")) return true;                        // link-local
    // IPv4-mapped (::ffff:10.0.0.1) — check the embedded v4 instead.
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;                          // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true;                // carrier-grade NAT
  if (a >= 224) return true;                                        // multicast / reserved
  return false;
}

/** Throws with a user-facing message unless `host` resolves to public
 *  addresses only. */
export async function assertPublicHost(rawHost: string): Promise<void> {
  const host = rawHost.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new Error("No host given");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(BLOCKED_HOST_MESSAGE);
    return;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new Error(`The host ${host} could not be resolved`);
  }
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new Error(BLOCKED_HOST_MESSAGE);
  }
}

/** https only, public host only. */
export async function assertSafeHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("The URL must use https");
  await assertPublicHost(url.hostname);
  return url;
}
