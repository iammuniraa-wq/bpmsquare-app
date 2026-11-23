import "server-only";
import { fetchPublic } from "@/lib/net/safeHost";
import { describeNetworkError, describeTokenFailure, fail, TOKEN_EMPTY } from "./plain";
import { defaultScope, entraTokenUrl, type ConnectionConfig, type ConnectionSecrets, type TestResult } from "./spec";

// How a saved connection talks to its system. Every call to an address a person typed goes through fetchPublic (https, public
// addresses only, every redirect refused, a time limit), the credentials are laid on here and nowhere else, and a failure comes
// back as plain words (plain.ts), never an exception text. The client-credentials token is kept until it expires: the store
// behind `TokenStore` decides where (the database, sealed), this file only decides when it is still good.

export type LiveConnection = {
  id: string;
  tenantId: string;
  config: ConnectionConfig;
  /** Plain values, unsealed for this one call. Never logged, never returned. */
  secrets: ConnectionSecrets;
};

export type Token = { token: string; exp: number };

export interface TokenStore {
  get(): Promise<Token | null>;
  set(t: Token): Promise<void>;
  clear(): Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_BODY_CHARS = 12 * 1024 * 1024;
const TOKEN_MARGIN_MS = 60_000;

export const tokenFresh = (t: Token | null, now: number = Date.now()): t is Token => !!t && t.exp - TOKEN_MARGIN_MS > now;

/** base + path, kept on the base's own origin and under its own path: a path can never steer a request to another host. */
export function joinUrl(base: string, path: string): string {
  const b = new URL(base);
  const p = (path ?? "").trim();
  if (!p) return b.toString().replace(/\/+$/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("//") || p.includes("\\")) throw new Error("The path must stay on the connection's own server.");
  const joined = new URL(`${b.origin}${b.pathname.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`);
  if (joined.origin !== b.origin || !joined.pathname.startsWith(b.pathname.replace(/\/+$/, ""))) throw new Error("The path must stay on the connection's own server.");
  return joined.toString();
}

/** The token request of an OAuth 2 client-credentials connection. Pure. */
export function tokenRequest(c: Pick<LiveConnection, "config" | "secrets">): { url: string; body: URLSearchParams } {
  const cfg = c.config;
  const url = cfg.oauth_provider === "custom" ? (cfg.token_url ?? "") : entraTokenUrl(cfg.directory_id ?? "");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.client_id ?? "",
    client_secret: c.secrets.client_secret ?? "",
  });
  const scope = cfg.scope || (cfg.oauth_provider === "custom" ? "" : defaultScope(cfg.base_url));
  if (scope) {
    // Microsoft's older token address (oauth2/token, no v2.0) asks for a resource; every other server asks for a scope.
    const v1 = /\/oauth2\/token(\?|$)/.test(url) && !/\/v2\.0\//.test(url);
    if (v1) body.set("resource", scope.replace(/\/\.default$/, ""));
    else body.set("scope", scope);
  }
  return { url, body };
}

/** A new token, or the plain reason there is none. */
export async function fetchToken(c: Pick<LiveConnection, "config" | "secrets">, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: true; token: Token } | { ok: false; result: TestResult }> {
  const { url, body } = tokenRequest(c);
  let res: Response;
  try {
    res = await fetchPublic(url, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const r = describeNetworkError(e, Math.round(timeoutMs / 1000));
    return { ok: false, result: { ...r, message: `Could not reach the sign-in server. ${r.message}` } };
  }
  const text = (await res.text().catch(() => "")).slice(0, 20_000);
  if (!res.ok) return { ok: false, result: describeTokenFailure(res.status, text) };
  let json: { access_token?: unknown; expires_in?: unknown } = {};
  try { json = JSON.parse(text) as typeof json; } catch { /* handled below */ }
  if (typeof json.access_token !== "string" || !json.access_token) return { ok: false, result: TOKEN_EMPTY() };
  const secs = Number(json.expires_in);
  const ttl = Number.isFinite(secs) && secs > 0 ? Math.min(secs, 24 * 3600) : 3000;
  return { ok: true, token: { token: json.access_token, exp: Date.now() + ttl * 1000 } };
}

export type CallInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export type CallOutcome =
  | { ok: true; status: number; text: string; contentType: string; ms: number }
  | { ok: false; status: number | null; result: TestResult; ms: number };

/** Headers and query the sign-in adds, with a token resolved first when the sign-in needs one. Pure given the token. */
export function authParts(c: Pick<LiveConnection, "config" | "secrets">, token: string | null): { headers: Record<string, string>; query: Record<string, string> } {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const cfg = c.config;
  if (cfg.auth === "api_key" && c.secrets.api_key) {
    const name = cfg.key_name || "X-API-Key";
    if (cfg.key_in === "query") query[name] = c.secrets.api_key;
    else headers[name] = c.secrets.api_key;
  } else if (cfg.auth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.username ?? ""}:${c.secrets.password ?? ""}`, "utf8").toString("base64")}`;
  } else if (cfg.auth === "bearer" && c.secrets.token) {
    headers.Authorization = `Bearer ${c.secrets.token}`;
  } else if (cfg.auth === "oauth2_cc" && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { headers, query };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BODY_CHARS);
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
    if (out.length > MAX_BODY_CHARS) { await reader.cancel().catch(() => undefined); return out.slice(0, MAX_BODY_CHARS); }
  }
  return out + dec.decode();
}

/**
 * One authenticated call. A cached token is used while it is fresh; a 401 with a cached token drops it and tries once more with a
 * new one (the secret may have been renewed). Nothing here throws: a failure is a plain result.
 */
export async function callConnection(c: LiveConnection, init: CallInit = {}, store?: TokenStore): Promise<CallOutcome> {
  const started = Date.now();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const elapsed = () => Date.now() - started;

  let url: string;
  try {
    url = joinUrl(c.config.base_url, init.path ?? "");
  } catch {
    return { ok: false, status: null, ms: elapsed(), result: fail("That path is not on the connection's server.", "Use a path that starts with /, such as /health.") };
  }

  const attempt = async (token: string | null): Promise<CallOutcome> => {
    const { headers, query } = authParts(c, token);
    const target = new URL(url);
    for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);
    try {
      const res = await fetchPublic(target.toString(), {
        method: init.method ?? "GET", redirect: "error",
        headers: { Accept: "application/json, application/xml;q=0.9, */*;q=0.5", ...(init.headers ?? {}), ...headers },
        body: init.body, signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await readCapped(res);
      return { ok: true, status: res.status, text, contentType: res.headers.get("content-type") ?? "", ms: elapsed() };
    } catch (e) {
      return { ok: false, status: null, result: describeNetworkError(e, Math.round(timeoutMs / 1000)), ms: elapsed() };
    }
  };

  if (c.config.auth !== "oauth2_cc") return attempt(null);

  let cached = store ? await store.get().catch(() => null) : null;
  const usedCache = tokenFresh(cached);
  if (!usedCache) {
    const t = await fetchToken(c, timeoutMs);
    if (!t.ok) return { ok: false, status: t.result.httpStatus, result: t.result, ms: elapsed() };
    cached = t.token;
    if (store) await store.set(t.token).catch(() => undefined);
  }
  const first = await attempt(cached!.token);
  if (first.ok && first.status === 401 && usedCache) {
    if (store) await store.clear().catch(() => undefined);
    const t = await fetchToken(c, timeoutMs);
    if (!t.ok) return { ok: false, status: t.result.httpStatus, result: t.result, ms: elapsed() };
    if (store) await store.set(t.token).catch(() => undefined);
    return attempt(t.token.token);
  }
  return first;
}
