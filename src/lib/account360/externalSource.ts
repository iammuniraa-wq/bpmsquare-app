import "server-only";
import { assertSafeHttpsUrl, BLOCKED_HOST_MESSAGE } from "@/lib/net/safeHost";
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

/** Throws with a user-facing message if the URL isn't safe to fetch server-side. */
export async function assertSafeSourceUrl(raw: string): Promise<URL> {
  try {
    return await assertSafeHttpsUrl(raw);
  } catch (e) {
    const msg = (e as Error).message;
    // Keep the wording this screen always used.
    if (msg === BLOCKED_HOST_MESSAGE) throw new Error("That URL points at a private or internal address");
    if (msg === "The URL must use https") throw new Error("Source URLs must use https");
    throw e;
  }
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
