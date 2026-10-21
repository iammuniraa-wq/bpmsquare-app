// A small, defensive OData client for the three Dynamics 365 APIs. No
// server-only import so the retry/paging logic is unit-tested with a fake
// fetch (d365.test.ts); the auth header comes from the caller.
//
// Robustness, because a sync runs unattended:
//  - 429 / 503 / 504 are retried, honouring Retry-After (capped), with
//    exponential backoff otherwise -- Dynamics throttles by design.
//  - every request has a timeout.
//  - @odata.nextLink is followed only on the SAME origin as the base URL: a
//    next link is server-supplied, and following one to another host would
//    send our bearer token there.
//  - paging stops at a row cap; the caller resumes next run from its watermark.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class D365Error extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const RETRY_STATUSES = new Set([429, 503, 504]);

/** Retry-After is seconds or an HTTP date; capped at 60 s (a run has a time
 *  budget -- a longer wait is better spent on the next run). */
export function retryDelayMs(retryAfter: string | null, attempt: number, nowMs: number = Date.now()): number {
  const backoff = Math.min(30_000, 500 * 2 ** attempt);
  if (!retryAfter) return backoff;
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(Math.max(secs * 1000, 250), 60_000);
  const at = Date.parse(retryAfter);
  if (Number.isFinite(at)) return Math.min(Math.max(at - nowMs, 250), 60_000);
  return backoff;
}

/** The new record id from an OData-EntityId header,
 *  e.g. https://org.crm.dynamics.com/api/data/v9.2/msdyn_projects(00000000-...) -> 00000000-... */
export function idFromEntityIdHeader(h: string | null): string | null {
  const m = h?.match(/\(([^()]+)\)\s*$/);
  if (!m) return null;
  // A composite key (F&O: dataAreaId='sa01',ProjectID='P-1') is kept as is.
  if (m[1].includes("=")) return m[1];
  const single = m[1].match(/^'(.*)'$/);
  return single ? single[1].replace(/''/g, "'") : m[1];
}

export class D365Client {
  private readonly origin: string;

  constructor(
    private readonly base: string,
    private readonly authHeader: () => Promise<string>,
    private readonly opts: {
      fetch?: FetchLike; timeoutMs?: number; maxRetries?: number; sleep?: (ms: number) => Promise<void>; headers?: Record<string, string>;
      /** Called once when Dynamics answers 401 -- drop the cached token so the
       *  retry fetches a fresh one (a revoked token otherwise fails every run
       *  until its cached expiry). */
      onUnauthorized?: () => Promise<void>;
    } = {},
  ) {
    this.origin = new URL(base).origin;
  }

  private url(pathOrUrl: string, query?: Record<string, string | undefined>): string {
    const u = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(`${this.base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`);
    if (u.origin !== this.origin) throw new D365Error("Refused to follow a link to another host", 400);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  /** The response body (parsed) and headers. A GET is retried on network
   *  errors, 429, 503 and 504; a write only on 429 -- a write that timed out
   *  or hit a 503/504 may already have been applied, and repeating it would
   *  create a second record in the customer's ERP. */
  async requestRaw(method: string, pathOrUrl: string, init: { query?: Record<string, string | undefined>; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ json: unknown; headers: Headers; status: number; text: string }> {
    const fetcher = this.opts.fetch ?? (fetch as unknown as FetchLike);
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const maxRetries = this.opts.maxRetries ?? 4;
    const idempotent = method === "GET";
    const url = this.url(pathOrUrl, init.query);
    let reauthed = false;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      let res: Response;
      let text: string;
      try {
        res = await fetcher(url, {
          method,
          redirect: "error",
          signal: ctrl.signal,
          headers: {
            Accept: "application/json",
            "OData-Version": "4.0",
            "OData-MaxVersion": "4.0",
            Authorization: await this.authHeader(),
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(this.opts.headers ?? {}),
            ...(init.headers ?? {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        // The body read stays inside the timeout: a server that sends headers
        // and then stalls must not hang the run.
        text = await res.text();
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof D365Error) throw e;
        if (idempotent && attempt < maxRetries) { await sleep(Math.min(30_000, 500 * 2 ** attempt)); continue; }
        throw new D365Error((e as Error).name === "AbortError" ? "Dynamics 365 did not answer in time" : `Could not reach Dynamics 365: ${(e as Error).message}`, 0);
      }
      clearTimeout(timer);
      const retryable = res.status === 429 || (idempotent && RETRY_STATUSES.has(res.status));
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      if (res.status === 401 && !reauthed && this.opts.onUnauthorized) {
        reauthed = true;
        await this.opts.onUnauthorized();
        attempt--;
        continue;
      }
      let json: unknown = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        const msg = err?.message || (res.status === 401 ? "Dynamics 365 refused the login (401)" : res.status === 403 ? "The app user has no permission for this (403)" : `Dynamics 365 returned ${res.status}`);
        throw new D365Error(msg.slice(0, 500), res.status, err?.code);
      }
      return { json, headers: res.headers, status: res.status, text };
    }
  }

  async request(method: string, pathOrUrl: string, init: { query?: Record<string, string | undefined>; body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
    return (await this.requestRaw(method, pathOrUrl, init)).json;
  }

  get(pathOrUrl: string, query?: Record<string, string | undefined>, headers?: Record<string, string>) {
    return this.request("GET", pathOrUrl, { query, headers });
  }

  /** Create a record. Returns the created row when the API sends it back,
   *  and the new id from the OData-EntityId header when it doesn't (Dataverse
   *  answers 204 without a body unless return=representation is honoured). */
  async create(entitySet: string, body: Record<string, unknown>): Promise<{ row: Record<string, unknown>; entityId: string | null }> {
    const out = await this.requestRaw("POST", entitySet, { body, headers: { Prefer: "return=representation" } });
    return { row: (out.json ?? {}) as Record<string, unknown>, entityId: idFromEntityIdHeader(out.headers.get("odata-entityid")) };
  }

  /** Every row of an entity set, page by page, up to `maxRows`. */
  async *list(entitySet: string, q: { select?: string[]; filter?: string; orderby?: string; top?: number; pageSize?: number; maxRows?: number; extraQuery?: Record<string, string> } = {}): AsyncGenerator<Record<string, unknown>> {
    const maxRows = q.maxRows ?? 5000;
    let seen = 0;
    let next: string | null = null;
    let first = true;
    while (first || next) {
      const page = (first
        ? await this.get(entitySet, {
            $select: q.select?.length ? q.select.join(",") : undefined,
            $filter: q.filter,
            $orderby: q.orderby,
            $top: q.top ? String(q.top) : undefined,
            ...(q.extraQuery ?? {}),
          }, { Prefer: `odata.maxpagesize=${q.pageSize ?? 500}` })
        : await this.get(next!, undefined, { Prefer: `odata.maxpagesize=${q.pageSize ?? 500}` })) as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };
      first = false;
      for (const row of page.value ?? []) {
        yield row;
        if (++seen >= maxRows) return;
      }
      next = page["@odata.nextLink"] ?? null;
    }
  }
}
