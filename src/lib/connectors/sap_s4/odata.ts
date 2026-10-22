// A small, defensive OData V2 client for the SAP S/4HANA APIs. No server-only import, so the paging, retry and
// message logic is unit-tested with a fake fetch (sap.test.ts); the credentials come from the caller and the
// caller passes a fetch that only reaches public hosts (fetchPublic).
//
//  - Every request asks for JSON (`$format=json`); a V2 answer is { d: { results, __next } } or { d: { ... } }.
//  - 429 / 503 / 504 are retried on a GET, honouring Retry-After (capped). A write is never retried (there is none yet).
//  - A server-supplied next link is NEVER followed to another address: only its query (the skip token) is applied
//    to our own base, so the login can not be sent anywhere else.
//  - Paging stops at a row cap; the caller resumes next run from its position.

import { retryDelayMs } from "@/lib/connectors/d365/odata";
import { SAP_SCENARIO } from "./types";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class SapError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type SapScenario = (typeof SAP_SCENARIO)[keyof typeof SAP_SCENARIO] | null;

const scenarioWords = (s: SapScenario): string => (s ? `scenario ${s.id} (${s.name})` : "the scenario this API belongs to");

/** What a status means to the person at the SAP screen, in the words of the Communication Management apps. */
export function explainSapStatus(status: number, scenario: SapScenario, sandbox: boolean, sapMessage?: string | null): string {
  const extra = sapMessage ? ` SAP says: ${sapMessage}` : "";
  if (sandbox) {
    if (status === 401) return "The sandbox refused the API key. Copy it again from the SAP Business Accelerator Hub (Show API Key).";
    if (status === 403) return "The sandbox did not accept this key for this API. Check that the key is the one shown for your SAP Business Accelerator Hub account.";
    if (status === 404) return "The sandbox does not offer this API.";
    return `The sandbox answered ${status}.${extra}`.slice(0, 500);
  }
  if (status === 401) {
    return `SAP refused the user name or password. Check the Communication User and its password, and that the user belongs to a Communication Arrangement for ${scenarioWords(scenario)}.`;
  }
  if (status === 403) {
    return `The Communication User is not assigned to the Communication Arrangement for ${scenarioWords(scenario)}. In SAP open Communication Arrangements, select that arrangement and set this user.`;
  }
  if (status === 404) {
    return `SAP does not serve this API for the user. Create a Communication Arrangement for ${scenarioWords(scenario)}, then test again.`;
  }
  if (status === 429) return "SAP is limiting how fast it answers. Try again in a few minutes.";
  if (status >= 500) return `SAP returned ${status}.${extra}`.slice(0, 500);
  return `SAP returned ${status}.${extra}`.slice(0, 500);
}

/** The message inside a V2 error body, or null. */
export function sapErrorMessage(json: unknown): string | null {
  const m = (json as { error?: { message?: { value?: unknown } | string } } | null)?.error?.message;
  const v = typeof m === "string" ? m : typeof m?.value === "string" ? m.value : null;
  return v ? v.replace(/\s+/g, " ").trim().slice(0, 300) : null;
}

export type SapAuth = () => Promise<Record<string, string>>;

export type SapClientOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  scenario?: SapScenario;
  sandbox?: boolean;
  /** The host in words, for "could not reach". */
  hostWord?: string;
};

export class SapClient {
  private readonly origin: string;

  constructor(private readonly base: string, private readonly auth: SapAuth, private readonly opts: SapClientOptions = {}) {
    this.origin = new URL(base).origin;
  }

  private url(path: string, query?: Record<string, string | undefined>): string {
    const u = new URL(`${this.base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  /** The raw answer: parsed JSON where the body is JSON, and the text either way (`$metadata` is XML). */
  async requestRaw(path: string, init: { query?: Record<string, string | undefined>; accept?: string } = {}): Promise<{ json: unknown; text: string; headers: Headers; status: number }> {
    const fetcher = this.opts.fetch ?? (fetch as unknown as FetchLike);
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const maxRetries = this.opts.maxRetries ?? 3;
    const url = this.url(path, init.query);
    if (new URL(url).origin !== this.origin) throw new SapError("Refused to call another address.", 400);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      let res: Response;
      let text: string;
      try {
        res = await fetcher(url, { method: "GET", redirect: "error", signal: ctrl.signal, headers: { Accept: init.accept ?? "application/json", ...(await this.auth()) } });
        text = await res.text();
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof SapError) throw e;
        if (attempt < maxRetries) { await sleep(Math.min(30_000, 500 * 2 ** attempt)); continue; }
        const word = this.opts.hostWord ?? "SAP";
        const msg = (e as Error).name === "AbortError" ? `${word} did not answer in time.` : `Could not reach ${word}: ${(e as Error).message}`;
        throw new SapError(msg.slice(0, 500), 0);
      }
      clearTimeout(timer);
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
        await sleep(retryDelayMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      let json: unknown = null;
      if (text && (init.accept ?? "application/json").includes("json")) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      if (!res.ok) {
        let body = json;
        if (body === null && text.trim().startsWith("<")) body = null;
        throw new SapError(explainSapStatus(res.status, this.opts.scenario ?? null, this.opts.sandbox === true, sapErrorMessage(body)), res.status);
      }
      return { json, text, headers: res.headers, status: res.status };
    }
  }

  /** A V2 collection or single entity: the `d` envelope removed. */
  async get(path: string, query?: Record<string, string | undefined>): Promise<{ results: Record<string, unknown>[]; next: string | null }> {
    const { json } = await this.requestRaw(path, { query: { $format: "json", ...(query ?? {}) } });
    return unwrapV2(json);
  }

  /** `$metadata` as text. */
  async metadata(): Promise<string> {
    return (await this.requestRaw("$metadata", { accept: "application/xml" })).text;
  }

  /** Every row of an entity set, page by page, up to `maxRows`. */
  async *list(entitySet: string, q: { select?: string[]; filter?: string; orderby?: string; expand?: string[]; pageSize?: number; maxRows?: number } = {}): AsyncGenerator<Record<string, unknown>> {
    const maxRows = q.maxRows ?? 5000;
    const pageSize = q.pageSize ?? 200;
    let seen = 0;
    let query: Record<string, string | undefined> = {
      $select: q.select?.length ? q.select.join(",") : undefined,
      $filter: q.filter, $orderby: q.orderby, $expand: q.expand?.length ? q.expand.join(",") : undefined, $top: String(pageSize), $inlinecount: undefined,
    };
    for (;;) {
      const page = await this.get(entitySet, query);
      for (const row of page.results) {
        yield row;
        if (++seen >= maxRows) return;
      }
      if (page.next) {
        // Only the query of the server's link is used, on our own base.
        const qs = new URL(page.next, this.base).searchParams;
        const next: Record<string, string | undefined> = {};
        qs.forEach((v, k) => { next[k] = v; });
        query = next;
      } else if (page.results.length >= pageSize) {
        query = { ...query, $skip: String(seen) };
      } else {
        return;
      }
    }
  }
}

/** { d: { results: [...], __next } } -> rows; { d: { ... } } -> one row. */
export function unwrapV2(json: unknown): { results: Record<string, unknown>[]; next: string | null } {
  const d = (json as { d?: unknown } | null)?.d;
  if (!d || typeof d !== "object") return { results: [], next: null };
  const results = (d as { results?: unknown }).results;
  const next = (d as { __next?: unknown }).__next;
  if (Array.isArray(results)) return { results: results as Record<string, unknown>[], next: typeof next === "string" ? next : null };
  return { results: [d as Record<string, unknown>], next: null };
}
