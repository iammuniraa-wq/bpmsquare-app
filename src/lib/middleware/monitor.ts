import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { decrypt } from "@/lib/encryption";
import {
  SOURCES, compareNewest, decodeCursor, encodeCursor, matchesQuery, rawId, type Cursor, type NormalizeCtx, type Plan, type Row, type SourceSpec,
} from "./monitorRows";
import { MESSAGES_TABLE } from "./messages";
import { normalizePayload, type StoredPayload } from "./exchange";
import { MESSAGE_SOURCES, SQL_BUNDLES, type MessageFilters, type MessageSource, type MonitorMessage } from "./types";

// The message monitor: one list over the new integration_messages table and the
// sources that already record messages. Every read is tenant-filtered (the
// admin client bypasses RLS), tolerates a source whose table does not exist
// yet, and pages by keyset so a long history stays cheap.

export type MessagePage = {
  items: MonitorMessage[];
  nextCursor: string | null;
  /** integration_messages is missing: the page shows "database update needed". */
  needsDatabaseUpdate: boolean;
  bundle: string | null;
  /** Sources that do not exist in this database (reported, never an error). */
  missingSources: MessageSource[];
  /** Sources that failed for another reason; the rest of the list is still shown. */
  failedSources: MessageSource[];
};

// A structural slice of the PostgREST builder, so the filters are applied by
// one function and the reader is testable against a fake.
type Builder = {
  eq(c: string, v: unknown): Builder; in(c: string, v: unknown[]): Builder; not(c: string, op: string, v: unknown): Builder;
  gte(c: string, v: unknown): Builder; lte(c: string, v: unknown): Builder; or(expr: string): Builder;
  order(c: string, o?: { ascending?: boolean }): Builder; limit(n: number): Builder;
};

function applyPlan(q: Builder, p: Plan): Builder {
  for (const [c, v] of Object.entries(p.eq ?? {})) q = q.eq(c, v);
  for (const [c, v] of Object.entries(p.in ?? {})) q = q.in(c, v);
  for (const c of p.notNull ?? []) q = q.not(c, "is", null);
  if (p.or) q = q.or(p.or);
  return q;
}

const MAX_LIMIT = 100;

export async function listMessages(
  admin: SupabaseClient, tenantId: string, filters: MessageFilters = {}, cursorRaw: string | null = null, limitIn = 50,
): Promise<MessagePage> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitIn) || 50));
  const cursor: Cursor | null = decodeCursor(cursorRaw);
  const missing: MessageSource[] = [];
  const failed: MessageSource[] = [];
  const ctx: NormalizeCtx = { webhookNames: new Map() };

  const specs = SOURCES.map((spec) => ({ spec, plan: spec.plan(filters) })).filter((x): x is { spec: SourceSpec; plan: Plan } => x.plan !== null);

  const rows = await Promise.all(specs.map(async ({ spec, plan }) => {
    let q = admin.from(spec.table).select(spec.cols).eq("tenant_id", tenantId) as unknown as Builder;
    q = applyPlan(q, plan);
    if (filters.from) q = q.gte(spec.timeCol, filters.from);
    if (filters.to) q = q.lte(spec.timeCol, filters.to);
    if (cursor) q = q.or(`${spec.timeCol}.lt.${cursor.t},and(${spec.timeCol}.eq.${cursor.t},id.lt.${cursor.id})`);
    const { data, error } = (await q.order(spec.timeCol, { ascending: false }).order("id", { ascending: false }).limit(limit + 1)) as unknown as { data: Row[] | null; error: { code?: string; message?: string } | null };
    if (error) {
      if (isSchemaPending(error)) missing.push(spec.source);
      else failed.push(spec.source);
      return { spec, rows: [] as Row[] };
    }
    return { spec, rows: data ?? [] };
  }));

  // Webhook names, for the counterpart column (the table holds ids only).
  const hookIds = [...new Set(rows.filter((r) => r.spec.source === "webhook").flatMap((r) => r.rows.map((x) => String(x.webhook_id))))];
  if (hookIds.length) {
    const { data } = await admin.from("webhooks").select("id, name").eq("tenant_id", tenantId).in("id", hookIds);
    for (const h of (data ?? []) as { id: string; name: string }[]) ctx.webhookNames.set(h.id, h.name);
  }

  // A connector run that also has an integration message (its correlation id is
  // the run id) is shown once, as the message. Asked of the table directly, so a
  // run and its message on different pages still count as one.
  const covered = new Set<string>();
  const runIds = rows.filter((r) => r.spec.source === "connector").flatMap((r) => r.rows.map((x) => String(x.id)));
  if (runIds.length) {
    const { data } = await admin.from(MESSAGES_TABLE).select("correlation_id").eq("tenant_id", tenantId).eq("channel", "connector").in("correlation_id", runIds);
    for (const x of (data ?? []) as { correlation_id: string }[]) covered.add(x.correlation_id);
  }

  let overflow = false;
  const merged: MonitorMessage[] = [];
  for (const { spec, rows: rs } of rows) {
    if (rs.length > limit) overflow = true;
    for (const r of rs) {
      if (spec.source === "connector" && covered.has(String(r.id))) continue;
      merged.push(spec.normalize(r, ctx));
    }
  }
  merged.sort(compareNewest);
  const page = merged.slice(0, limit);
  const hasMore = overflow || merged.length > limit;
  const last = page[page.length - 1];
  const items = page.filter((m) => matchesQuery(m, filters.q));

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ t: last.at, id: rawId(last) }) : null,
    needsDatabaseUpdate: missing.includes("integration"),
    bundle: missing.includes("integration") ? SQL_BUNDLES.middleware : null,
    missingSources: missing,
    failedSources: failed,
  };
}

// ── One message, opened ─────────────────────────────────────────────────────

export type MessageDetail = {
  message: MonitorMessage;
  /** Raw facts for the side panel. Bodies and phone numbers appear here only, for an admin. */
  detail: Record<string, unknown>;
  /** The request and response stored with an outbound document send or a failed connector call, in one shape.
   *  Null for every other message, and for the older sources (email, WhatsApp, RFQ, webhooks). */
  payload: StoredPayload | null;
};

export function parseMessageId(id: string): { source: MessageSource; uuid: string } | null {
  const i = id.indexOf(":");
  if (i < 1) return null;
  const source = id.slice(0, i) as MessageSource;
  const uuid = id.slice(i + 1);
  if (!(MESSAGE_SOURCES as readonly string[]).includes(source) || !/^[0-9a-f-]{32,40}$/i.test(uuid)) return null;
  return { source, uuid };
}

const DETAIL_COLS: Record<MessageSource, string> = {
  integration: "*",
  email: "*",
  rfq: "id, rfq_id, direction, channel, from_address, to_addresses, subject, body_text, status, error, provider, created_at",
  whatsapp: "*",
  webhook: "*",
  connector: "*",
};

/** Admin only (the route enforces it). Decrypts what the list keeps sealed. The
 *  route also writes a change-log entry for every open. */
export async function getMessageDetail(admin: SupabaseClient, tenantId: string, id: string): Promise<{ ok: true; value: MessageDetail } | { ok: false; reason: "bad_id" | "not_found" | "needs_database_update" }> {
  const parsed = parseMessageId(id);
  if (!parsed) return { ok: false, reason: "bad_id" };
  const spec = SOURCES.find((s) => s.source === parsed.source)!;
  const { data, error } = await admin.from(spec.table).select(DETAIL_COLS[parsed.source]).eq("id", parsed.uuid).eq("tenant_id", tenantId).maybeSingle();
  if (error) return { ok: false, reason: isSchemaPending(error) ? "needs_database_update" : "not_found" };
  if (!data) return { ok: false, reason: "not_found" };
  const row = data as unknown as Row;
  const ctx: NormalizeCtx = { webhookNames: new Map() };
  if (parsed.source === "webhook" && row.webhook_id) {
    const { data: h } = await admin.from("webhooks").select("id, name").eq("id", row.webhook_id as string).eq("tenant_id", tenantId).maybeSingle();
    if (h) ctx.webhookNames.set((h as { id: string; name: string }).id, (h as { name: string }).name);
  }
  const message = spec.normalize(row, ctx);
  const detail: Record<string, unknown> = { ...row };
  delete detail.tenant_id;
  // The stored payload is returned once, in its own field and shape, not repeated inside the raw columns.
  const payload = parsed.source === "integration" ? normalizePayload(row.payload) : null;
  delete detail.payload;
  if (parsed.source === "integration") message.hasPayload = payload !== null;
  if (parsed.source === "whatsapp") {
    detail.body = decrypt(typeof row.body === "string" ? row.body : null);
    detail.to_phone = decrypt(typeof row.to_phone === "string" ? row.to_phone : null);
    detail.redirected_to = decrypt(typeof row.redirected_to === "string" ? row.redirected_to : null);
  }
  return { ok: true, value: { message, detail, payload } };
}
