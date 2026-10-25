import { BodyTooLargeError, readBounded } from "@/lib/net/readBounded";
import { fetchPublic } from "@/lib/net/safeHost";
import { redactSecrets, vendorMessage } from "./redact";
import { DEFAULT_METHOD } from "./endpointMap";
import type { EndpointDef, EpromisConfig, EpromisOperation, HttpMethod } from "./types";

// The one place OUR server talks to the host a workspace admin typed. Every request goes through fetchPublic (public
// host only, https or http as typed but https is enforced on save, redirects refused), carries the sealed credential
// attached here and nowhere else, is bounded in time and size, and turns a failure into words that contain none of the
// secrets that were sent.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type EpromisDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxPages?: number;
  maxRows?: number;
};

export type Creds = { secret?: string };

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_PAGES = 50;
export const DEFAULT_MAX_ROWS = 50_000;

export type CallKind = "http" | "network" | "refused" | "timeout" | "too_large" | "config";

export class EpromisCallError extends Error {
  constructor(message: string, readonly status: number, readonly kind: CallKind) {
    super(message);
  }
}

/** Every string that must never reach a message, a log line or a response: the secret and what is derived from it. */
export function secretsOf(cfg: Pick<EpromisConfig, "auth_type" | "username">, creds: Creds): string[] {
  const s = creds.secret;
  if (!s) return [];
  const out = [s];
  if (cfg.auth_type === "basic") out.push(`${cfg.username}:${s}`, Buffer.from(`${cfg.username}:${s}`).toString("base64"));
  return out;
}

export function authHeaders(cfg: Pick<EpromisConfig, "auth_type" | "key_header" | "username">, creds: Creds): Record<string, string> {
  if (!creds.secret) throw new EpromisCallError("The credential is missing. Enter it under Edit.", 400, "config");
  if (cfg.auth_type === "api_key") {
    if (!cfg.key_header) throw new EpromisCallError("The API key header name is missing. Enter it under Edit.", 400, "config");
    return { [cfg.key_header]: creds.secret };
  }
  if (cfg.auth_type === "bearer") return { Authorization: `Bearer ${creds.secret}` };
  if (!cfg.username) throw new EpromisCallError("The user name is missing. Enter it under Edit.", 400, "config");
  return { Authorization: `Basic ${Buffer.from(`${cfg.username}:${creds.secret}`).toString("base64")}` };
}

/** The base URL as an address, https only: a stored value that is anything else is refused here too, not only on save. */
export function parseBase(raw: string): URL {
  let base: URL;
  try { base = new URL(raw); } catch { throw new EpromisCallError("The base URL is not a valid address. Correct it under Edit.", 400, "config"); }
  if (base.protocol !== "https:") throw new EpromisCallError("The base URL must use https. Correct it under Edit.", 400, "refused");
  return base;
}

/** The address for a path under the base URL; {placeholders} are filled with encoded values. Always on the base's own host. */
export function buildUrl(cfg: Pick<EpromisConfig, "base_url" | "company_name" | "company_value" | "company_in">, path: string, vars: Record<string, unknown> = {}): string {
  const base = parseBase(cfg.base_url);
  const filled = path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n: string) => {
    const v = vars[n];
    if (v === undefined || v === null || v === "") throw new EpromisCallError(`The address needs {${n}}, which was not given.`, 400, "config");
    return encodeURIComponent(String(v));
  });
  const url = new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}${filled}`);
  if (url.origin !== base.origin) throw new EpromisCallError("Refused to call another address.", 400, "refused");
  if (cfg.company_value && cfg.company_name && cfg.company_in === "query") url.searchParams.set(cfg.company_name, cfg.company_value);
  return url.toString();
}

function statusWords(status: number, vendor: string | null): string {
  const says = vendor ? ` ePROMIS says: ${vendor}` : "";
  if (status === 401) return `ePROMIS refused the sign-in (401). Check the credential and the sign-in type.${says}`;
  if (status === 403) return `ePROMIS knows the sign-in but does not allow this request (403). Check the user's rights in ePROMIS.${says}`;
  if (status === 404) return `ePROMIS has nothing at that address (404). Check the path in the endpoint map.${says}`;
  if (status === 405) return `ePROMIS does not accept that method at that address (405). Check the method in the endpoint map.${says}`;
  if (status === 422 || status === 400) return `ePROMIS did not accept the request (${status}).${says}`;
  if (status === 429) return `ePROMIS is limiting how fast it answers (429). Try again in a few minutes.${says}`;
  if (status >= 500) return `ePROMIS reported an error (${status}).${says}`;
  return `ePROMIS answered ${status}.${says}`;
}

const isRetryable = (m: HttpMethod | "HEAD") => m === "GET" || m === "HEAD" || m === "PUT";

export type SendRequest = {
  method: HttpMethod | "HEAD";
  path: string;
  vars?: Record<string, unknown>;
  body?: unknown;
  /** An absolute next-page link taken from an answer: used only when it is on the base URL's own host. */
  absoluteUrl?: string;
};

export type Sent = { status: number; json: unknown; text: string; headers: Headers };

/**
 * One request. A 2xx answer is returned; anything else throws EpromisCallError with a message that is safe to show.
 * A network error is retried once for a read or a replace; a write that may already have been made (POST, PATCH) is
 * never repeated, and a timeout or a refused address is never retried.
 */
export async function send(cfg: EpromisConfig, creds: Creds, req: SendRequest, deps: EpromisDeps = {}): Promise<Sent> {
  const secrets = secretsOf(cfg, creds);
  const fetcher: FetchLike = deps.fetch ?? ((u, init) => fetchPublic(u, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = { Accept: "application/json", ...authHeaders(cfg, creds) };
  if (cfg.company_value && cfg.company_name && cfg.company_in === "header") headers[cfg.company_name] = cfg.company_value;
  if (req.body !== undefined) headers["Content-Type"] = "application/json";

  let url: string;
  if (req.absoluteUrl) {
    const base = parseBase(cfg.base_url);
    let next: URL;
    try { next = new URL(req.absoluteUrl, base.origin); } catch { throw new EpromisCallError("ePROMIS named a next page that is not an address.", 400, "refused"); }
    if (next.origin !== base.origin) throw new EpromisCallError("ePROMIS named a next page on another address; it was not followed.", 400, "refused");
    if (cfg.company_value && cfg.company_name && cfg.company_in === "query" && !next.searchParams.has(cfg.company_name)) next.searchParams.set(cfg.company_name, cfg.company_value);
    url = next.toString();
  } else {
    url = buildUrl(cfg, req.path, req.vars);
  }

  const attempts = isRetryable(req.method) ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetcher(url, {
        method: req.method, redirect: "error", signal: ctrl.signal, headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
      text = req.method === "HEAD" ? "" : await readBounded(res, deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof EpromisCallError) throw e;
      if (e instanceof BodyTooLargeError) throw new EpromisCallError("ePROMIS answered with more data than one request may carry. Ask for a smaller page.", 0, "too_large");
      const raw = (e as Error).message ?? "";
      // An address the guard refused (private network, not https, a redirect) will not get better by asking again.
      if (/private or internal network|must use https|valid URL|redirected|could not be resolved/i.test(raw)) {
        throw new EpromisCallError(redactSecrets(raw, secrets).slice(0, 240), 0, "refused");
      }
      if ((e as Error).name === "AbortError") throw new EpromisCallError("ePROMIS did not answer in time.", 0, "timeout");
      if (attempt < attempts) { await sleep(500); continue; }
      throw new EpromisCallError(`Could not reach ${new URL(url).host}: ${redactSecrets(raw, secrets).slice(0, 200)}`.trim(), 0, "network");
    }
    clearTimeout(timer);
    if (res.status >= 200 && res.status < 300) {
      let json: unknown = null;
      if (text) { try { json = JSON.parse(text); } catch { json = null; } }
      return { status: res.status, json, text, headers: res.headers };
    }
    throw new EpromisCallError(statusWords(res.status, vendorMessage(text, secrets)), res.status, "http");
  }
}

/** The definition of an operation if it is configured, else null. */
export function definition(cfg: EpromisConfig, op: EpromisOperation): (EndpointDef & { path: string; method: HttpMethod }) | null {
  const d = cfg.endpoints[op];
  if (!d?.path) return null;
  return { ...d, path: d.path, method: d.method ?? DEFAULT_METHOD[op] };
}
