// The ONE file that talks to the server for the Webhooks library page: every fetch, and the shape of every
// answer. Written against the contract in docs/design/webhooks-library.md ("Contract"); when a route's final
// shape differs, only this file changes. Client-safe (no server imports). Every route is admin + flag, else 404;
// while the SQL is pending a route answers 200 with { needsDatabaseUpdate: true, bundle }.

import { ApiProblem, INSTALLING } from "../middleware/api";

const BASE = "/api/settings/webhooks-library";

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type WebhookKind = "event" | "call";
export const METHODS = ["GET", "POST", "PUT", "PATCH"] as const;
export type Method = (typeof METHODS)[number];
export type PayloadMode = "standard" | "template";
export type UsedBy = { kind: "link" | "coverage" | "button"; label: string };
export type HeaderView = { name: string; set: true };

export type Webhook = {
  id: string;
  kind: WebhookKind;
  name: string;
  url: string;
  method: Method;
  object_type: string | null;
  object_types: string[];
  headers: HeaderView[];
  payload_mode: PayloadMode;
  template: string | null;
  allow_personal_data: boolean;
  timeout_ms: number;
  active: boolean;
  paused_reason: string | null;
  /** Always "set" once created: the signing secret is never returned. */
  secret: "set";
  last_delivery_at: string | null;
  last_status: string | null;
  last_error: string | null;
  failure_count: number;
  /** A plain sentence when the webhook cannot fire as it is (a migrated http:// address), else null. */
  needs_attention: string | null;
  used_by: UsedBy[];
  created_at: string | null;
  updated_at: string | null;
};

export type ObjectChoice = { key: string; label: string };
export type WebhookList = {
  webhooks: Webhook[];
  recordButtons: { accounts: string | null };
  objects: ObjectChoice[];
  needsDatabaseUpdate: boolean;
  bundle: string | null;
};

/** What the person typed on save. Header `value: ""` keeps the stored value; leaving a header out removes it. */
export type WebhookInput = {
  kind?: WebhookKind;
  name?: string;
  url?: string;
  method?: Method;
  object_type?: string | null;
  object_types?: string[];
  headers?: { name: string; value: string }[];
  payload_mode?: PayloadMode;
  template?: string | null;
  allow_personal_data?: boolean;
  timeout_ms?: number;
  button_on?: "accounts" | null;
  active?: boolean;
  regenerate_secret?: boolean;
};

export type TokenKind = "text" | "number" | "array" | "object";
export type TokenChoice = { token: string; label: string; pii: boolean; kind: TokenKind };
export type SampleRecord = { id: string; label: string };
export type PreviewRequest = { method: string; url: string; headers: string[]; body: string | null };
export type TestResult = {
  ok: boolean;
  status: number | null;
  durationMs: number | null;
  request: PreviewRequest | null;
  response: { status: number | null; body: string | null } | null;
  messageId: string | null;
  headline: string | null;
  fix: string | null;
};
export type DeliveryItem = {
  id: string;
  at: string | null;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  headline: string | null;
  monitorId: string | null;
};

// ── Errors ──────────────────────────────────────────────────────────────────

export type FieldError = { field: string; message: string };

/** A refused save: the server's own plain sentences, each tied to the field it is about. */
export class FieldProblem extends ApiProblem {
  constructor(message: string, status: number, readonly errors: FieldError[]) {
    super(message, status, false, null, errors[0]?.field ?? null);
  }
}

/** The 409 on a delete that is refused while something still uses the webhook. */
export class InUseProblem extends ApiProblem {
  constructor(message: string, readonly usedBy: UsedBy[]) {
    super(message, 409);
  }
}

type Json = Record<string, unknown>;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiProblem("Could not reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let json: Json | null = null;
  try { json = text ? (JSON.parse(text) as Json) : null; } catch { json = null; }
  if (json === null && !res.ok) throw new ApiProblem(INSTALLING, res.status, res.status === 404 || res.status === 405 || res.status >= 500);
  if (!res.ok) {
    const errors = Array.isArray(json?.errors)
      ? (json!.errors as { field?: unknown; message?: unknown }[]).map((e) => ({ field: String(e.field ?? ""), message: String(e.message ?? "") })).filter((e) => e.message)
      : [];
    if (res.status === 422 && errors.length > 0) throw new FieldProblem(errors[0].message, 422, errors);
    if (res.status === 409 && Array.isArray(json?.used_by)) throw new InUseProblem(typeof json?.error === "string" ? json.error : "It is still in use.", normalizeUsedBy(json!.used_by));
    const msg = (typeof json?.headline === "string" && json.headline) || (typeof json?.error === "string" && json.error) || `Request failed (${res.status})`;
    throw new ApiProblem(msg, res.status, false, typeof json?.fix === "string" ? json.fix : null);
  }
  return (json ?? {}) as T;
}

// ── Normalisers: every optional part gets a safe default, so a screen never reads undefined ──────

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function normalizeUsedBy(v: unknown): UsedBy[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((u) => {
    const o = u as { kind?: unknown; label?: unknown };
    const kind = o.kind === "link" || o.kind === "coverage" || o.kind === "button" ? o.kind : null;
    return kind && typeof o.label === "string" ? [{ kind, label: o.label }] : [];
  });
}

export function normalizeWebhook(raw: Partial<Webhook> & Json): Webhook {
  const method = METHODS.includes(raw.method as Method) ? (raw.method as Method) : "POST";
  return {
    id: String(raw.id ?? ""),
    kind: raw.kind === "event" ? "event" : "call",
    name: String(raw.name ?? ""),
    url: String(raw.url ?? ""),
    method,
    object_type: str(raw.object_type),
    object_types: Array.isArray(raw.object_types) ? raw.object_types.map(String) : [],
    headers: Array.isArray(raw.headers) ? raw.headers.flatMap((h) => (h && typeof (h as HeaderView).name === "string" ? [{ name: (h as HeaderView).name, set: true as const }] : [])) : [],
    payload_mode: raw.payload_mode === "template" ? "template" : "standard",
    template: str(raw.template),
    allow_personal_data: raw.allow_personal_data === true,
    timeout_ms: num(raw.timeout_ms) ?? 15000,
    active: raw.active !== false,
    paused_reason: str(raw.paused_reason),
    secret: "set",
    last_delivery_at: str(raw.last_delivery_at),
    last_status: raw.last_status == null || raw.last_status === "" ? null : String(raw.last_status),
    last_error: str(raw.last_error),
    failure_count: num(raw.failure_count) ?? 0,
    needs_attention: str(raw.needs_attention),
    used_by: normalizeUsedBy(raw.used_by),
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at),
  };
}

export function normalizeList(raw: Json): WebhookList {
  const pending = raw.needsDatabaseUpdate === true;
  const rb = raw.recordButtons as { accounts?: unknown } | undefined;
  return {
    webhooks: Array.isArray(raw.webhooks) ? (raw.webhooks as Json[]).map((w) => normalizeWebhook(w)) : [],
    recordButtons: { accounts: str(rb?.accounts) },
    objects: Array.isArray(raw.objects) ? (raw.objects as ObjectChoice[]).map((o) => ({ key: String(o.key), label: String(o.label ?? o.key) })) : [],
    needsDatabaseUpdate: pending,
    bundle: str(raw.bundle),
  };
}

export function normalizeTest(raw: Json): TestResult {
  const req = raw.request as Partial<PreviewRequest> | undefined;
  const res = raw.response as { status?: unknown; body?: unknown } | undefined;
  return {
    ok: raw.ok === true,
    status: num(raw.status),
    durationMs: num(raw.durationMs),
    request: req ? normalizePreview({ request: req }) : null,
    response: res ? { status: num(res.status), body: typeof res.body === "string" ? res.body : res.body == null ? null : JSON.stringify(res.body, null, 2) } : null,
    messageId: str(raw.messageId),
    headline: str(raw.headline),
    fix: str(raw.fix),
  };
}

export function normalizePreview(raw: Json): PreviewRequest {
  const r = (raw.request ?? raw) as Partial<PreviewRequest> & { body?: unknown };
  return {
    method: String(r.method ?? "POST"),
    url: String(r.url ?? ""),
    headers: Array.isArray(r.headers) ? r.headers.map(String) : [],
    body: typeof r.body === "string" ? r.body : r.body == null ? null : JSON.stringify(r.body, null, 2),
  };
}

export function normalizeDelivery(raw: Json): DeliveryItem {
  return {
    id: String(raw.id ?? ""),
    at: str(raw.at),
    status: String(raw.status ?? ""),
    http_status: num(raw.http_status),
    duration_ms: num(raw.duration_ms),
    headline: str(raw.headline),
    monitorId: str(raw.monitorId),
  };
}

// ── Calls ───────────────────────────────────────────────────────────────────

export async function listWebhooks(): Promise<WebhookList> {
  return normalizeList(await request<Json>("GET", BASE));
}
/**
 * A saved webhook, plus the signing secret when the server shows it for this one response only (a new webhook or a
 * regenerated secret). The contract returns "set" in every GET, so a plain string anywhere else is that one-time reveal.
 */
export type SavedWebhook = { webhook: Webhook; revealedSecret: string | null };

function saved(r: { webhook: Json; secret?: unknown }): SavedWebhook {
  const inner = r.webhook?.secret;
  const shown = typeof r.secret === "string" ? r.secret : typeof inner === "string" && inner !== "set" ? inner : null;
  return { webhook: normalizeWebhook(r.webhook), revealedSecret: shown };
}

export async function createWebhook(input: WebhookInput): Promise<SavedWebhook> {
  return saved(await request<{ webhook: Json; secret?: unknown }>("POST", BASE, input));
}
export async function updateWebhook(id: string, input: WebhookInput): Promise<SavedWebhook> {
  return saved(await request<{ webhook: Json; secret?: unknown }>("PATCH", `${BASE}/${encodeURIComponent(id)}`, input));
}
export async function deleteWebhook(id: string): Promise<void> {
  await request<Json>("DELETE", `${BASE}/${encodeURIComponent(id)}`);
}
export async function listTokens(objectType: string): Promise<TokenChoice[]> {
  const r = await request<{ tokens?: TokenChoice[] }>("GET", `${BASE}/tokens?object_type=${encodeURIComponent(objectType)}`);
  return (r.tokens ?? []).map((t) => ({ token: String(t.token), label: String(t.label ?? t.token), pii: t.pii === true, kind: (["text", "number", "array", "object"] as const).includes(t.kind) ? t.kind : "text" }));
}
export async function listSamples(objectType: string): Promise<SampleRecord[]> {
  const r = await request<{ records?: SampleRecord[] }>("GET", `${BASE}/samples?object_type=${encodeURIComponent(objectType)}`);
  return (r.records ?? []).map((x) => ({ id: String(x.id), label: String(x.label ?? x.id) }));
}
/** Event webhooks are pinged without a record; the server ignores objectId for them. */
export async function previewWebhook(id: string, objectId: string | null): Promise<PreviewRequest> {
  return normalizePreview(await request<Json>("POST", `${BASE}/${encodeURIComponent(id)}/preview`, { object_id: objectId }));
}
export async function testWebhook(id: string, objectId: string | null): Promise<TestResult> {
  return normalizeTest(await request<Json>("POST", `${BASE}/${encodeURIComponent(id)}/test`, { object_id: objectId }));
}
export async function listDeliveries(id: string): Promise<DeliveryItem[]> {
  const r = await request<{ items?: Json[] }>("GET", `${BASE}/${encodeURIComponent(id)}/deliveries`);
  return (r.items ?? []).map(normalizeDelivery);
}

/** The Call webhooks for Standard Quotes, picked from the Links panel; read through the library list. */
export const callWebhooksFor = (list: readonly Webhook[], objectType: string): Webhook[] =>
  list.filter((w) => w.kind === "call" && w.object_type === objectType && w.active && !w.needs_attention);
