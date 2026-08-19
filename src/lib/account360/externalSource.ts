import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Account360SourceDef } from "@/lib/constants";
import type { Account360Card } from "./types";

/**
 * Account 360's plug-and-play half: a tenant admin points a card at their
 * ERP (or any JSON endpoint), maps a few paths, and it renders next to the
 * built-in cards. Standard product code never learns the source exists.
 *
 * The URL is tenant-supplied and fetched BY OUR SERVER, which is textbook
 * SSRF territory -- our egress can reach things the admin's browser can't
 * (cloud metadata endpoints, anything on the deployment's private network).
 * So every request is checked twice: the host must resolve to a public
 * address before the fetch, and any redirect is refused outright rather
 * than re-validated (a 302 to 169.254.169.254 is the classic bypass).
 */

const BLOCKED_MESSAGE = "That URL points at a private or internal address";

function isPrivateAddress(ip: string): boolean {
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

/** Throws with a user-facing message if the URL isn't safe to fetch server-side. */
export async function assertSafeSourceUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return Promise.reject(new Error("That isn't a valid URL"));
  }
  if (url.protocol !== "https:") throw new Error("Source URLs must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(BLOCKED_MESSAGE);
    return url;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(BLOCKED_MESSAGE);
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new Error("That host could not be resolved");
  }
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new Error(BLOCKED_MESSAGE);
  }
  return url;
}

export type SourceTokens = Record<string, string | null>;

export function fillTokens(template: string, tokens: SourceTokens): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) =>
    encodeURIComponent(tokens[key] ?? "")
  );
}

/** Reads a dot/bracket path out of a parsed JSON value. */
export function readPath(source: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = source;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function display(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} item(s)` : JSON.stringify(v).slice(0, 120);
  return String(v).slice(0, 200);
}

export async function loadExternalCard(
  source: Account360SourceDef,
  tokens: SourceTokens
): Promise<Account360Card> {
  const card: Account360Card = { id: `src:${source.id}`, title: source.title, kind: "external" };
  let url: URL;
  try {
    url = await assertSafeSourceUrl(fillTokens(source.url, tokens));
  } catch (e) {
    return { ...card, error: (e as Error).message };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (source.auth_header && source.auth_value) headers[source.auth_header] = source.auth_value;

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      // A redirect is never followed: the destination would bypass the
      // pre-flight address check above.
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
  } catch {
    return { ...card, error: "Source did not respond in time" };
  }
  if (res.status >= 300 && res.status < 400) {
    return { ...card, error: "Source redirected — point the card at the final URL instead" };
  }
  if (!res.ok) return { ...card, error: `Source returned ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ...card, error: "Source did not return JSON" };
  }

  const root = source.root_path ? readPath(body, source.root_path) : body;
  if (root === undefined || root === null) {
    return { ...card, empty: "No matching record in the source" };
  }

  const rows = (source.fields ?? []).slice(0, 12).map((f) => ({
    title: f.label,
    value: display(readPath(root, f.path)),
  }));
  return rows.length > 0 ? { ...card, rows } : { ...card, empty: "No fields mapped on this card yet" };
}
