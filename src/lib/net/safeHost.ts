import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// One SSRF guard for every place OUR server connects to a host a TENANT
// typed: Account 360 sources, a tenant's own mail server (RFQ mailbox mode),
// the Dynamics 365 connector, outbound webhooks and the ERP push. Our egress
// can reach things a tenant's browser can't (cloud metadata, the deployment's
// private network), so the host must resolve to public addresses only.
// Extracted 2026-10-15 from account360/externalSource.ts so the rule exists
// once; the IPv6 handling and fetchPublic() were added by the 2026-10-21 audit.

export const BLOCKED_HOST_MESSAGE = "That address points at a private or internal network";

function isPrivateV4Parts(p: number[]): boolean {
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;                          // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true;                // carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true;                 // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;                 // documentation
  if (a === 198 && (b === 18 || b === 19)) return true;             // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;              // documentation
  if (a === 203 && b === 0 && c === 113) return true;               // documentation
  if (a >= 224) return true;                                        // multicast / reserved
  return false;
}

/** The eight 16-bit groups of an IPv6 literal, or null when it does not parse. */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // A dotted IPv4 tail (::ffff:10.0.0.1) becomes its two hex groups first.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const p = tail.slice(1, 5).map(Number);
    if (p.some((n) => n > 255)) return null;
    s = `${s.slice(0, s.length - tail[0].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    if (head.length + rest.length > 7) return null;
    groups = [...head, ...Array<string>(8 - head.length - rest.length).fill("0"), ...rest];
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateV6(raw: string): boolean {
  const g = parseIPv6(raw);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => isPrivateV4Parts([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 6).every((n) => n === 0)) return true;                       // ::, ::1 and the deprecated IPv4-compatible ::/96
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return v4(g[6], g[7]);   // IPv4-mapped, hex form included
  if (g[0] === 0x64 && g[1] === 0xff9b) {                                     // NAT64: the embedded IPv4 is what is reached
    return g.slice(2, 6).every((n) => n === 0) ? v4(g[6], g[7]) : true;
  }
  if (g[0] === 0x2002) return v4(g[1], g[2]);                                 // 6to4 embeds the IPv4 in bits 16-48
  if (g[0] === 0x2001 && g[1] === 0) return true;                             // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;                         // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                // unique-local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;  // link-local and the old site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 6) return isPrivateV6(ip);
  return isPrivateV4Parts(ip.split(".").map(Number));
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

/** http or https, public host only. For integrations that were configured
 *  before https was required (an ERP receiver on plain http still works, a
 *  private address never does -- this server cannot reach one legitimately). */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The URL must start with https://");
  await assertPublicHost(url.hostname);
  return url;
}

/**
 * fetch() for a URL a tenant typed. The host is checked before the request and
 * again for every redirect hop (a 302 to 169.254.169.254 is the classic bypass),
 * and credentials are not carried across to another origin.
 */
export async function fetchPublic(raw: string, init: RequestInit = {}, opts: { maxRedirects?: number } = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = await assertPublicHttpUrl(raw);
  let method = init.method ?? "GET";
  let body = init.body;
  let headers = new Headers(init.headers);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...init, method, body, headers, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= maxRedirects) throw new Error("The address redirected too many times");
    const next = await assertPublicHttpUrl(new URL(location, url).toString());
    if (next.origin !== url.origin) {
      headers = new Headers(headers);
      headers.delete("authorization");
      headers.delete("cookie");
    }
    if (res.status !== 307 && res.status !== 308) {
      method = "GET";
      body = undefined;
      headers = new Headers(headers);
      headers.delete("content-type");
    }
    url = next;
  }
}
