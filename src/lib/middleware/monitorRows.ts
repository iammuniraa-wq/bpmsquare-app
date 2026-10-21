import { D365_ENTITY_KEYS } from "@/lib/connectors/d365/types";
import { TARGET_KINDS, TARGET_LABEL, type MessageChannel, type MessageDirection, type MessageFilters, type MessageSource, type MonitorMessage, type MonitorStatus, type TargetKind } from "./types";

// The message monitor reads six tables and shows one shape. This file is the
// pure half: which filters each source can answer (a plan, or null when the
// source cannot produce a match), and how one row of each source becomes a
// MonitorMessage. Lists never carry a body or a phone number; those stay
// encrypted until the detail route opens them for an admin.

export type Row = Record<string, unknown>;

export type Plan = {
  eq?: Record<string, string | boolean>;
  in?: Record<string, string[]>;
  notNull?: string[];
  /** A PostgREST `or` expression for a filter one column cannot express. */
  or?: string;
};

export type SourceSpec = {
  source: MessageSource;
  table: string;
  /** The column the list is ordered and paged by. */
  timeCol: string;
  cols: string;
  /** null = this source can never match the filters, so it is not read. */
  plan(f: MessageFilters): Plan | null;
  normalize(row: Row, ctx: NormalizeCtx): MonitorMessage;
};

export type NormalizeCtx = { webhookNames: Map<string, string> };

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ── What a row is, and whether Restart can run it again ─────────────────────

/** The connector entity a run row names, when Restart can run it again. */
export const isRunnableEntity = (v: unknown): v is (typeof D365_ENTITY_KEYS)[number] => typeof v === "string" && (D365_ENTITY_KEYS as readonly string[]).includes(v);

const ENTITY_WORD: Record<string, string> = {
  customers: "Customers", contacts: "Contacts", vendors: "Suppliers", products: "Products", projects: "Projects", fence_projects: "Fence projects",
};

/** Payloads are kept 48 hours (the prune job nulls the column then); the line itself stays 30 days. */
export const payloadStillKept = (createdAt: unknown, nowMs: number = Date.now()): boolean => {
  const t = Date.parse(String(createdAt));
  return Number.isFinite(t) && nowMs - t < 48 * 3_600_000;
};

export type RowKind = "document" | "run" | "webhook_call" | null;

/** Restart can act on: an awarded-quote document that failed or is waiting, and a connector run that failed.
 *  Never an OK row, never one skipped by design, never a rejected quote (those are never sent). */
export function classifyIntegrationRow(r: { object_type?: unknown; object_id?: unknown; status?: unknown; entity?: unknown; summary?: unknown }): RowKind {
  const sum = (r.summary && typeof r.summary === "object" ? r.summary : {}) as Record<string, unknown>;
  if (sum.kind === "connector_run") return r.status === "failed" && isRunnableEntity(r.entity) ? "run" : null;
  // A library webhook call: Restart fires it again (the award path through its claim). A paused webhook reports itself when restarted.
  if (sum.kind === "webhook_call") return r.status === "failed" && s(r.object_id) ? "webhook_call" : null;
  if (r.object_type === "standard_quotes" && s(r.object_id) && (r.status === "failed" || r.status === "pending") && sum.outcome === "awarded") return "document";
  return null;
}

function documentWord(entity: string | null, sum: Record<string, unknown>): string {
  if (sum.test === true) return "Test quote";
  return (TARGET_KINDS as readonly string[]).includes(entity ?? "") ? TARGET_LABEL[entity as TargetKind] : "Quote";
}

// ── integration_messages ────────────────────────────────────────────────────

const integration: SourceSpec = {
  source: "integration",
  table: "integration_messages",
  timeCol: "created_at",
  cols: "id, direction, channel, connector_id, entity, object_type, object_id, ref_label, status, http_status, error, duration_ms, correlation_id, summary, created_at",
  plan(f) {
    if (f.status === "dry_run") return null;
    const eq: Record<string, string> = {};
    if (f.direction) eq.direction = f.direction;
    if (f.channel) eq.channel = f.channel;
    if (f.status) eq.status = f.status;
    if (f.object_id) eq.object_id = f.object_id;
    return { eq };
  },
  normalize(r) {
    const sum = (r.summary ?? {}) as Record<string, unknown>;
    const channel = (s(r.channel) ?? "connector") as MessageChannel;
    const status = (s(r.status) ?? "ok") as MonitorMessage["status"];
    let summary = s(sum.headline) ?? "";
    if (!summary) {
      if (channel === "api") summary = `${s(sum.method) ?? "GET"} ${s(sum.path) ?? ""}${n(r.http_status) ? ` → ${r.http_status}` : ""}`.trim();
      else if (sum.kind === "connector_run") {
        const c = (sum.counts ?? {}) as Record<string, number>;
        summary = `${s(r.entity) ?? "Sync"}: ${c.read ?? 0} read, ${c.created ?? 0} created, ${c.updated ?? 0} updated, ${c.failed ?? 0} failed`;
      } else if (s(sum.ref)) summary = `${s(sum.ref)} ${s(sum.outcome) ?? ""}${s(sum.erp_number) ? ` → ${s(sum.erp_number)}` : ""}`.trim();
      else summary = s(r.entity) ?? "Message";
    }
    const objectType = s(r.object_type);
    const kind = classifyIntegrationRow(r);
    const entity = s(r.entity);
    const what = sum.kind === "connector_run" ? (ENTITY_WORD[entity ?? ""] ?? entity ?? "Sync")
      : sum.kind === "webhook_call" ? "Webhook"
      : objectType === "standard_quotes" || sum.outcome ? documentWord(entity, sum)
      : channel === "api" ? `API ${entity ?? ""}`.trim() : (entity ?? "Message");
    return {
      id: `integration:${r.id}`, source: "integration", at: String(r.created_at),
      direction: (s(r.direction) ?? "out") as MessageDirection, channel,
      counterpart: sum.kind === "webhook_call" ? s(sum.webhook) : s(r.connector_id) === "dynamics365" ? "Dynamics 365" : s(r.connector_id),
      summary, status, record: objectType ? { type: objectType, id: s(r.object_id), label: s(r.ref_label) } : null,
      duration_ms: n(r.duration_ms),
      what, restartable: kind !== null, fix: s(sum.fix) ?? (kind === "run" ? "Restart to run it again." : null),
      erpNumber: s(sum.erp_number), hasPayload: sum.has_payload === true && payloadStillKept(r.created_at),
    };
  },
};

// ── email_log ───────────────────────────────────────────────────────────────

const email: SourceSpec = {
  source: "email",
  table: "email_log",
  timeCol: "created_at",
  cols: "id, kind, to_email, subject, status, error, related_object_type, related_object_id, related_object_label, created_at",
  plan(f) {
    if (f.direction === "in" || (f.channel && f.channel !== "email")) return null;
    const eq: Record<string, string> = {};
    if (f.status === "ok") eq.status = "sent";
    else if (f.status === "failed") eq.status = "failed";
    else if (f.status) return null;
    if (f.object_id) eq.related_object_id = f.object_id;
    return { eq };
  },
  normalize(r) {
    const type = s(r.related_object_type);
    return {
      id: `email:${r.id}`, source: "email", at: String(r.created_at), direction: "out", channel: "email",
      counterpart: s(r.to_email), summary: s(r.subject) ?? "Email",
      status: r.status === "failed" ? "failed" : r.status === "redirected" ? "redirected" : "ok",
      record: type ? { type, id: s(r.related_object_id), label: s(r.related_object_label) } : null, duration_ms: null,
      what: "Email", restartable: false, fix: null, erpNumber: null, hasPayload: false,
    };
  },
};

// ── rfq_messages ────────────────────────────────────────────────────────────

const RFQ_OK = ["sent", "received", "logged"];
const rfq: SourceSpec = {
  source: "rfq",
  table: "rfq_messages",
  timeCol: "created_at",
  cols: "id, rfq_id, direction, channel, from_address, to_addresses, subject, status, error, created_at",
  plan(f) {
    const p: Plan = { in: { direction: ["in", "out"] } };
    if (f.direction) p.in = { direction: [f.direction] };
    if (f.channel === "email") p.in = { ...p.in, channel: ["email", "portal"] };
    else if (f.channel === "whatsapp") p.in = { ...p.in, channel: ["whatsapp"] };
    else if (f.channel) return null;
    if (f.status === "ok") p.in = { ...p.in, status: RFQ_OK };
    else if (f.status === "failed") p.in = { ...p.in, status: ["failed"] };
    else if (f.status === "redirected") p.in = { ...p.in, status: ["redirected"] };
    else if (f.status) return null;
    if (f.object_id) p.eq = { rfq_id: f.object_id };
    return p;
  },
  normalize(r) {
    const to = Array.isArray(r.to_addresses) ? (r.to_addresses as string[]) : [];
    const out = r.direction === "out";
    const counterpart = out ? (to[0] ? `${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ""}` : null) : s(r.from_address);
    const st = String(r.status ?? "sent");
    return {
      id: `rfq:${r.id}`, source: "rfq", at: String(r.created_at), direction: out ? "out" : "in",
      channel: r.channel === "whatsapp" ? "whatsapp" : "email", counterpart, summary: s(r.subject) ?? "RFQ message",
      status: st === "failed" ? "failed" : st === "redirected" ? "redirected" : "ok",
      record: { type: "rfqs", id: s(r.rfq_id), label: null }, duration_ms: null,
      what: "RFQ message", restartable: false, fix: null, erpNumber: null, hasPayload: false,
    };
  },
};

// ── whatsapp_messages ───────────────────────────────────────────────────────

const WA_OK = ["sent", "delivered", "read", "received"];
const whatsapp: SourceSpec = {
  source: "whatsapp",
  table: "whatsapp_messages",
  timeCol: "created_at",
  cols: "id, direction, contact_id, account_id, kind, category, status, redirected_to, error, created_at",
  plan(f) {
    if (f.channel && f.channel !== "whatsapp") return null;
    const p: Plan = {};
    if (f.direction) p.eq = { direction: f.direction };
    if (f.status === "ok") p.in = { status: WA_OK };
    else if (f.status === "failed") p.eq = { ...p.eq, status: "failed" };
    else if (f.status === "pending") p.eq = { ...p.eq, status: "queued" };
    else if (f.status === "dry_run") p.eq = { ...p.eq, status: "dry_run" };
    else if (f.status === "redirected") p.notNull = ["redirected_to"];
    else if (f.status) return null;
    // A WhatsApp row belongs to a person; the contact is the record it opens.
    if (f.object_id) p.eq = { ...p.eq, contact_id: f.object_id };
    return p;
  },
  normalize(r) {
    const st = String(r.status ?? "sent");
    const status: MonitorStatus = r.redirected_to ? "redirected" : st === "failed" ? "failed" : st === "queued" ? "pending" : st === "dry_run" ? "dry_run" : "ok";
    return {
      id: `whatsapp:${r.id}`, source: "whatsapp", at: String(r.created_at), direction: r.direction === "in" ? "in" : "out", channel: "whatsapp",
      counterpart: null, // the number is encrypted; the detail route decrypts it for an admin
      summary: `WhatsApp ${s(r.kind) ?? "message"}${s(r.category) ? ` (${s(r.category)})` : ""}`,
      status, record: s(r.contact_id) ? { type: "contacts", id: s(r.contact_id), label: null } : null, duration_ms: null,
      what: "WhatsApp", restartable: false, fix: null, erpNumber: null, hasPayload: false,
    };
  },
};

// ── webhook_deliveries ──────────────────────────────────────────────────────

const webhook: SourceSpec = {
  source: "webhook",
  table: "webhook_deliveries",
  timeCol: "created_at",
  cols: "id, webhook_id, event_count, status, ok, error, duration_ms, created_at",
  plan(f) {
    if (f.direction === "in" || (f.channel && f.channel !== "webhook") || f.object_id) return null;
    if (f.status === "ok") return { eq: { ok: true } };
    if (f.status === "failed") return { eq: { ok: false } };
    if (f.status) return null;
    return {};
  },
  normalize(r, ctx) {
    const c = n(r.event_count) ?? 0;
    return {
      id: `webhook:${r.id}`, source: "webhook", at: String(r.created_at), direction: "out", channel: "webhook",
      counterpart: ctx.webhookNames.get(String(r.webhook_id)) ?? "Webhook",
      summary: `${c} change${c === 1 ? "" : "s"} delivered${n(r.status) ? ` (HTTP ${r.status})` : ""}`,
      status: r.ok ? "ok" : "failed", record: null, duration_ms: n(r.duration_ms),
      what: "Webhook", restartable: false, fix: null, erpNumber: null, hasPayload: false,
    };
  },
};

// ── connector_sync_runs ─────────────────────────────────────────────────────

const connector: SourceSpec = {
  source: "connector",
  table: "connector_sync_runs",
  timeCol: "started_at",
  cols: "id, connector_id, entity, direction, trigger, status, started_at, finished_at, counts, error",
  plan(f) {
    if ((f.channel && f.channel !== "connector") || f.object_id) return null;
    const p: Plan = {};
    if (f.direction) p.eq = { direction: f.direction === "in" ? "pull" : "push" };
    if (f.status === "ok") p.eq = { ...p.eq, status: "succeeded" };
    else if (f.status === "failed") p.in = { status: ["failed", "partial"] };
    else if (f.status === "pending") p.eq = { ...p.eq, status: "running" };
    else if (f.status) return null;
    return p;
  },
  normalize(r) {
    const c = (r.counts ?? {}) as Record<string, number>;
    const st = String(r.status ?? "succeeded");
    const start = Date.parse(String(r.started_at));
    const end = r.finished_at ? Date.parse(String(r.finished_at)) : NaN;
    return {
      id: `connector:${r.id}`, source: "connector", at: String(r.started_at), direction: r.direction === "pull" ? "in" : "out", channel: "connector",
      counterpart: s(r.connector_id) === "dynamics365" ? "Dynamics 365" : s(r.connector_id),
      summary: `${s(r.entity) ?? "Sync"}: ${c.read ?? 0} read, ${c.created ?? 0} created, ${c.updated ?? 0} updated, ${c.failed ?? 0} failed`,
      status: st === "succeeded" ? "ok" : st === "running" ? "pending" : "failed", record: null,
      duration_ms: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
      what: ENTITY_WORD[s(r.entity) ?? ""] ?? s(r.entity) ?? "Sync",
      restartable: (st === "failed" || st === "partial") && isRunnableEntity(r.entity),
      fix: (st === "failed" || st === "partial") && isRunnableEntity(r.entity) ? "Restart to run it again." : null, erpNumber: null, hasPayload: false,
    };
  },
};

export const SOURCES: SourceSpec[] = [integration, email, rfq, whatsapp, webhook, connector];

// ── Cursor and merge ────────────────────────────────────────────────────────

export type Cursor = { t: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof c.t !== "string" || typeof c.id !== "string" || Number.isNaN(Date.parse(c.t)) || !/^[0-9a-f-]{8,40}$/i.test(c.id)) return null;
    return { t: c.t, id: c.id };
  } catch {
    return null;
  }
}

export const rawId = (m: Pick<MonitorMessage, "id">): string => m.id.slice(m.id.indexOf(":") + 1);

/** Newest first; ties broken by id so the order is the same every time. */
export function compareNewest(a: MonitorMessage, b: MonitorMessage): number {
  const d = Date.parse(b.at) - Date.parse(a.at);
  if (d !== 0 && !Number.isNaN(d)) return d;
  return rawId(b) < rawId(a) ? -1 : rawId(b) > rawId(a) ? 1 : 0;
}

/** Free-text filter over what a list row shows. */
export function matchesQuery(m: MonitorMessage, q: string | undefined): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;
  return [m.summary, m.counterpart, m.record?.label, m.record?.type].some((x) => x?.toLowerCase().includes(needle));
}
