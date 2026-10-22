import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unsealSecret } from "@/lib/encryption";
import { assertSafeHttpsUrl, fetchPublic } from "@/lib/net/safeHost";
import { BodyTooLargeError, readBounded as readBoundedBody } from "@/lib/net/readBounded";
import { CREDENTIAL_PARAM } from "@/lib/net/credentialParam";
import { parseOpenApi } from "./openapi";
import { parseODataSchema } from "./odata";
import { parseManualFields, parseSample } from "./sample";
import { parseYaml, YamlError } from "./yaml";
import { LIMITS, type ParseOutcome } from "./types";

// The only server file of schema discovery (spec section 2): validate the address, fetch it with a size and time cap through
// fetchPublic (re-resolved per hop, redirects refused), hand the text to the pure parser. Credentials are never stored: a
// webhook's own sealed headers may be unsealed HERE, for this one request, when the person ticks the box.

export type FetchDeps = { fetch?: (url: string, init: RequestInit) => Promise<Response> };

export class SchemaFetchError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

/** Query-string names that carry a credential. A stored address must not hold one: the key belongs in a header. */
const SECRET_PARAM = CREDENTIAL_PARAM;

export async function validateSchemaUrl(raw: unknown): Promise<URL> {
  if (typeof raw !== "string" || !raw.trim()) throw new SchemaFetchError("Give the address of the spec.");
  if (raw.length > 2000) throw new SchemaFetchError("That address is too long.");
  let url: URL;
  try {
    url = await assertSafeHttpsUrl(raw.trim());
  } catch (e) {
    throw new SchemaFetchError((e as Error).message);
  }
  if (url.username || url.password) throw new SchemaFetchError("Put the key in a header, not in the address.");
  for (const k of url.searchParams.keys()) {
    if (SECRET_PARAM.test(k)) throw new SchemaFetchError("Put the key in a header, not in the address.");
  }
  if (url.hash) url.hash = "";
  return url;
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  try {
    return await readBoundedBody(res, maxBytes);
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new SchemaFetchError(`That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    throw e;
  }
}

export async function fetchSchemaText(url: URL, kind: "openapi" | "odata", headers: Record<string, string>, deps: FetchDeps = {}): Promise<string> {
  const lim = LIMITS[kind];
  const doFetch = deps.fetch ?? ((u: string, init: RequestInit) => fetchPublic(u, init, { maxRedirects: 0 }));
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: "GET", headers: { Accept: kind === "odata" ? "application/xml, text/xml;q=0.9, */*;q=0.1" : "application/json, application/yaml, text/yaml, */*;q=0.1", ...headers },
      signal: AbortSignal.timeout(lim.ms),
    });
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (/redirected too many/i.test(m)) throw new SchemaFetchError("That address redirects. Use the final address of the file.");
    if (/private or internal/i.test(m)) throw new SchemaFetchError(m);
    if ((e as Error).name === "TimeoutError" || /abort|timed? ?out/i.test(m)) throw new SchemaFetchError(`The address did not answer within ${lim.ms / 1000} seconds.`, 504);
    throw new SchemaFetchError("Could not reach that address.", 502);
  }
  if (res.status >= 300 && res.status < 400) throw new SchemaFetchError("That address redirects. Use the final address of the file.");
  if (res.status === 401 || res.status === 403) throw new SchemaFetchError(`The address refused the request (HTTP ${res.status}). Tick "Send the webhook's headers" if the spec needs the key.`);
  if (!res.ok) throw new SchemaFetchError(`The address answered HTTP ${res.status}.`, 502);
  return readBounded(res, lim.bytes);
}

/** JSON first; YAML through the safe reader; never anything that builds objects from tags. */
export function readSpecText(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      throw new SchemaFetchError("That file looks like JSON but could not be read.");
    }
  }
  try {
    return parseYaml(t);
  } catch (e) {
    if (e instanceof YamlError) throw new SchemaFetchError(`That YAML could not be read (${e.message.replace(/\.$/, "")}). Use the JSON version of the spec.`);
    throw new SchemaFetchError("That file could not be read as OpenAPI.");
  }
}

// ── The sealed headers of a webhook, for this one request ────────────────────

export async function webhookHeaders(admin: SupabaseClient, tenantId: string, webhookId: string): Promise<Record<string, string>> {
  const { data } = await admin.from("webhooks").select("headers").eq("id", webhookId).eq("tenant_id", tenantId).maybeSingle();
  const out: Record<string, string> = {};
  const list = (data as { headers?: { name: string; value: string }[] } | null)?.headers;
  for (const h of Array.isArray(list) ? list : []) {
    const v = unsealSecret(h.value);
    if (v !== undefined && v !== null && !/[\r\n\0]/.test(v) && /^[A-Za-z0-9-]{1,64}$/.test(h.name)) out[h.name] = v;
  }
  return out;
}

// ── Entry point for the four sources that are not an adapter ─────────────────

export type DiscoverRequest = {
  source: "openapi" | "odata" | "sample" | "manual";
  url?: unknown;
  sample?: unknown;
  fields?: unknown;
  linesPath?: unknown;
  operation?: { method?: unknown; path?: unknown } | null;
  /** The headers to send, already unsealed by the caller: never part of a request body. */
  headers?: Record<string, string>;
};

export type Discovered = { parsed: ParseOutcome; sourceUrl: string | null };

export async function discoverSchema(req: DiscoverRequest, deps: FetchDeps = {}): Promise<Discovered> {
  if (req.source === "sample") return { parsed: parseSample(typeof req.sample === "string" ? req.sample : ""), sourceUrl: null };
  if (req.source === "manual") {
    const m = parseManualFields(req.fields, req.linesPath);
    if (!m.ok) return { parsed: { ok: false, message: m.message }, sourceUrl: null };
    return { parsed: { ok: true, entity: "Fields added by hand", fields: m.fields, lineFields: m.lineFields, linesPath: m.linesPath, notes: [] }, sourceUrl: null };
  }
  const url = await validateSchemaUrl(req.url);
  const text = await fetchSchemaText(url, req.source, req.headers ?? {}, deps);
  const op = req.operation && typeof req.operation.path === "string" ? { method: typeof req.operation.method === "string" ? req.operation.method : undefined, path: req.operation.path } : undefined;
  const parsed = req.source === "openapi"
    ? parseOpenApi(readSpecText(text), op)
    : parseODataSchema(text, { entitySet: op?.path });
  return { parsed, sourceUrl: `${url.origin}${url.pathname}${url.search}` };
}
