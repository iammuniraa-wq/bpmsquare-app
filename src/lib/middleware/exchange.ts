import { redactPayload, redactText } from "./redact";
import type { ErpHttp } from "./erp";

// What an outbound document send leaves behind for the "View request / View
// response" buttons (spec section 8): the request body and the response body of
// the call that matters, redacted, size-capped, stored with the message in
// integration_messages.payload and pruned with it at 30 days. Pure, except
// that recordingHttp() wraps a client.
//
// Shape: { request: { method, url, body } | null, response: { status, body, durationMs } | null, truncated }
// `url` is the path and entity only -- never a query string, never a host.

export type StoredPayload = {
  request: { method: string; url: string; body: unknown } | null;
  response: { status: number | null; body: unknown; durationMs: number | null } | null;
  truncated: boolean;
};

/** One call to the ERP, as it happened. */
export type Exchange = {
  method: string;
  path: string;
  requestBody: unknown;
  status: number | null;
  responseBody: unknown;
  durationMs: number;
  failed: boolean;
};

/** A body larger than this (after redaction) is replaced by a marker, so the stored shape never has to be cut. */
export const MAX_BODY_CHARS = 24_000;

/** The path and entity only: no query string, no host. */
export function cleanPath(p: string): string {
  let path = p.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    // keep as given
  }
  path = path.split("?")[0].split("#")[0];
  return redactText(path.startsWith("/") ? path : `/${path}`);
}

/** True when redaction cut something: a long list, a long string, a deep tree, or a body replaced outright. */
export function wasTruncated(v: unknown, depth = 0): boolean {
  if (v === null || v === undefined || depth > 12) return false;
  if (typeof v === "string") return /^\[\d+ more\]$/.test(v) || v === "[too deep]" || v.endsWith("…");
  if (Array.isArray(v)) return v.some((x) => wasTruncated(x, depth + 1));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.truncated === true && Object.keys(o).length <= 2) return true;
    return Object.values(o).some((x) => wasTruncated(x, depth + 1));
  }
  return false;
}

function safeBody(body: unknown): { value: unknown; truncated: boolean } {
  const red = redactPayload(body === undefined ? null : body);
  let size = 0;
  try { size = JSON.stringify(red)?.length ?? 0; } catch { size = Infinity; }
  if (size > MAX_BODY_CHARS) return { value: { truncated: true, note: "The body was too large to keep." }, truncated: true };
  return { value: red, truncated: wasTruncated(red) };
}

/** The stored, redacted payload for one call. Null when there was no call. */
export function buildExchangePayload(x: Exchange | null): StoredPayload | null {
  if (!x) return null;
  const req = safeBody(x.requestBody);
  const res = safeBody(x.responseBody);
  return {
    request: { method: x.method.toUpperCase(), url: cleanPath(x.path), body: req.value },
    response: { status: x.status, body: res.value, durationMs: Math.max(0, Math.round(x.durationMs)) },
    truncated: req.truncated || res.truncated,
  };
}

/** The call that explains the message: the one that failed, else the call that created the document, else the last write. */
export function pickExchange(calls: readonly Exchange[]): Exchange | null {
  const failed = [...calls].reverse().find((c) => c.failed);
  if (failed) return failed;
  const created = calls.find((c) => c.method === "POST" && c.requestBody !== undefined && !/^(WinQuote|CloseQuote)$/.test(c.path));
  if (created) return created;
  const writes = calls.filter((c) => c.method !== "GET");
  return writes[writes.length - 1] ?? null;
}

/** An old-shape or partial stored payload, brought to the one shape the screen reads. */
export function normalizePayload(raw: unknown): StoredPayload | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return { request: null, response: { status: null, body: raw, durationMs: null }, truncated: false };
  const o = raw as Record<string, unknown>;
  const rq = o.request;
  const rs = o.response;
  const isReq = rq && typeof rq === "object" && !Array.isArray(rq) && "method" in (rq as object);
  const isRes = rs && typeof rs === "object" && !Array.isArray(rs) && "status" in (rs as object);
  if (!("request" in o) && !("response" in o)) return { request: null, response: { status: null, body: o, durationMs: null }, truncated: o.truncated === true };
  const r = rq as { method?: unknown; url?: unknown; body?: unknown };
  const p = rs as { status?: unknown; body?: unknown; durationMs?: unknown };
  return {
    request: rq === null || rq === undefined ? null : isReq
      ? { method: String(r.method), url: typeof r.url === "string" ? r.url : "", body: r.body ?? null }
      : { method: "POST", url: "", body: rq },
    response: rs === null || rs === undefined ? null : isRes
      ? { status: typeof p.status === "number" ? p.status : null, body: p.body ?? null, durationMs: typeof p.durationMs === "number" ? p.durationMs : null }
      : { status: null, body: rs, durationMs: null },
    truncated: o.truncated === true,
  };
}

// ── Recording ───────────────────────────────────────────────────────────────

export type Recorder = { http: ErpHttp; calls: Exchange[] };

const errorBody = (e: unknown) => {
  const x = e as { message?: string; code?: string };
  return { error: { ...(x.code ? { code: x.code } : {}), message: x.message ?? "Unexpected error" } };
};

/** Wraps an ERP client so every write, and every call that fails, is kept as an Exchange. Reads that succeed are not. */
export function recordingHttp(inner: ErpHttp): Recorder {
  const calls: Exchange[] = [];
  const http: ErpHttp = {
    async requestRaw(method, pathOrUrl, init) {
      const t0 = Date.now();
      try {
        const out = await inner.requestRaw(method, pathOrUrl, init);
        if (method !== "GET") calls.push({ method, path: pathOrUrl, requestBody: init?.body, status: out.status, responseBody: out.json, durationMs: Date.now() - t0, failed: false });
        return out;
      } catch (e) {
        calls.push({ method, path: pathOrUrl, requestBody: init?.body, status: (e as { status?: number }).status ?? null, responseBody: errorBody(e), durationMs: Date.now() - t0, failed: true });
        throw e;
      }
    },
    async get(pathOrUrl, query, headers) {
      const t0 = Date.now();
      try {
        return await inner.get(pathOrUrl, query, headers);
      } catch (e) {
        calls.push({ method: "GET", path: pathOrUrl, requestBody: undefined, status: (e as { status?: number }).status ?? null, responseBody: errorBody(e), durationMs: Date.now() - t0, failed: true });
        throw e;
      }
    },
    async create(entitySet, body) {
      const t0 = Date.now();
      try {
        const out = await inner.create(entitySet, body);
        calls.push({ method: "POST", path: entitySet, requestBody: body, status: out.status ?? 201, responseBody: out.row, durationMs: Date.now() - t0, failed: false });
        return out;
      } catch (e) {
        calls.push({ method: "POST", path: entitySet, requestBody: body, status: (e as { status?: number }).status ?? null, responseBody: errorBody(e), durationMs: Date.now() - t0, failed: true });
        throw e;
      }
    },
  };
  return { http, calls };
}
