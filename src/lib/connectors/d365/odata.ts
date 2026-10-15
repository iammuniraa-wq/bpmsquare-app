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

export class D365Client {
  private readonly origin: string;

  constructor(
    private readonly base: string,
    private readonly authHeader: () => Promise<string>,
    private readonly opts: { fetch?: FetchLike; timeoutMs?: number; maxRetries?: number; sleep?: (ms: number) => Promise<void>; headers?: Record<string, string> } = {},
  ) {
    this.origin = new URL(base).origin;
  }

  private url(pathOrUrl: string, query?: Record<string, string | undefined>): string {
    const u = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(`${this.base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`);
    if (u.origin !== this.origin) throw new D365Error("Refused to follow a link to another host", 400);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  async request(method: string, pathOrUrl: string, init: { query?: Record<string, string | undefined>; body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
    const fetcher = this.opts.fetch ?? (fetch as unknown as FetchLike);
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const maxRetries = this.opts.maxRetries ?? 4;
    const url = this.url(pathOrUrl, init.query);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      let res: Response;
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
      } catch (e) {
        clearTimeout(timer);
        if (attempt < maxRetries) { await sleep(Math.min(30_000, 500 * 2 ** attempt)); continue; }
        throw new D365Error((e as Error).name === "AbortError" ? "Dynamics 365 did not answer in time" : `Could not reach Dynamics 365: ${(e as Error).message}`, 0);
      }
      clearTimeout(timer);
      if (RETRY_STATUSES.has(res.status) && attempt < maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        const msg = err?.message || (res.status === 401 ? "Dynamics 365 refused the login (401)" : res.status === 403 ? "The app user has no permission for this (403)" : `Dynamics 365 returned ${res.status}`);
        throw new D365Error(msg.slice(0, 500), res.status, err?.code);
      }
      return json;
    }
  }

  get(pathOrUrl: string, query?: Record<string, string | undefined>, headers?: Record<string, string>) {
    return this.request("GET", pathOrUrl, { query, headers });
  }

  /** Create a record; returns the created row when the API sends it back. */
  async create(entitySet: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const out = await this.request("POST", entitySet, { body, headers: { Prefer: "return=representation" } });
    return (out ?? {}) as Record<string, unknown>;
  }

  /** Every row of an entity set, page by page, up to `maxRows`. */
  async *list(entitySet: string, q: { select?: string[]; filter?: string; orderby?: string; pageSize?: number; maxRows?: number; extraQuery?: Record<string, string> } = {}): AsyncGenerator<Record<string, unknown>> {
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
