import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import type { TenantConfig } from "@/lib/constants";
import { MESSAGES_TABLE } from "../messages";
import { resolveConnection } from "./connection";
import { fail, knownValues, needsUpdate, type Out, type OpsCtx } from "./engineOps";
import { getDraft, listActive } from "./mappingStore";
import { listsFromFields, listKindFor } from "./propose";
import { STANDARD_LIST_KINDS, type TargetField, type ValueList } from "./types";
import { listAll, removeList, saveList } from "./valueListStore";
import {
  diffRows, isListKind, kindLabel, listToCsv, listUsedBy, listKindsUsed, parseListCsv, stillUnknown, unusedCount, validateListInput,
} from "./valueLists";

// The operations behind /api/middleware/value-lists* (contract). Lists belong to a connection and are shared by every document
// of it. All queries name the tenant; the connection id from the request is resolved with the tenant first.

const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const THIRTY_DAYS = 30 * 24 * 3_600_000;

/** The values distinct sends failed on, per list, from the Monitor rows of the last 30 days (no extra table). */
async function unmappedOut(admin: SupabaseClient, tenantId: string, now = Date.now()): Promise<Map<string, string[]>> {
  const since = new Date(now - THIRTY_DAYS).toISOString();
  const { data, error } = await admin.from(MESSAGES_TABLE).select("summary").eq("tenant_id", tenantId).eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  const out = new Map<string, string[]>();
  if (error) return out;
  for (const r of (data ?? []) as { summary?: { kind?: unknown; unmapped?: { list?: unknown; value?: unknown }[] } | null }[]) {
    if (r.summary?.kind !== "mapping_value" || !Array.isArray(r.summary.unmapped)) continue;
    for (const u of r.summary.unmapped) {
      if (typeof u?.list !== "string" || typeof u?.value !== "string") continue;
      const cur = out.get(u.list) ?? [];
      if (!cur.includes(u.value)) cur.push(u.value);
      out.set(u.list, cur);
    }
  }
  return out;
}

async function usage(ctx: OpsCtx, connection: string) {
  const docs = await listActive(ctx.admin, ctx.tenantId, connection);
  return docs.map((d) => ({ document: d.document, doc: d.doc }));
}

function describe(list: ValueList, usedKinds: Set<string>, out: string[]) {
  const unmappedOut = out.filter((v) => !list.rows.some((r) => r.bpm.toLowerCase() === v.toLowerCase() && r.erp.trim() !== ""));
  const unmappedIn = stillUnknown(list);
  return {
    kind: list.kind, label: list.label, rows: list.rows, default_in: list.default_in,
    counts: { rows: list.rows.length, unused: unusedCount(list, usedKinds), unmapped: unmappedOut.length + unmappedIn.length },
    unmapped: { out: unmappedOut, in: unmappedIn },
  };
}

export async function listsView(ctx: OpsCtx, connRaw: unknown): Promise<Out> {
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const all = await listAll(ctx.admin, ctx.tenantId, r.conn.id);
  if (all.pending) return needsUpdate();
  const docs = await usage(ctx, r.conn.id);
  const used = new Set(docs.flatMap((d) => [...listKindsUsed(d.doc).keys()]));
  const outValues = await unmappedOut(ctx.admin, ctx.tenantId);
  return ok({
    lists: all.lists.map((l) => describe(l, used, outValues.get(l.kind) ?? [])),
    standardKinds: STANDARD_LIST_KINDS.map((k) => ({ kind: k, label: kindLabel(k), created: all.lists.some((l) => l.kind === k) })),
  });
}

export async function putList(ctx: OpsCtx, connRaw: unknown, kind: string, body: Record<string, unknown>): Promise<Out> {
  if (!isListKind(kind)) return fail(422, "Choose a kind of list: unit, currency, country, payment_terms, incoterms, status, or custom:<name>.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const v = validateListInput(body.rows, body.default_in);
  if (!v.ok) return fail(422, v.errors[0].message, { errors: v.errors });
  if (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length > 60)) return fail(422, "The label is up to 60 characters.");
  const saved = await saveList(ctx.admin, ctx.tenantId, ctx.userId, r.conn.id, kind, { label: body.label as string | undefined, rows: v.rows, default_in: v.default_in });
  if (!saved.ok) return saved.error === "pending" ? needsUpdate() : fail(saved.status, saved.error);
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "value_list", objectId: `${r.conn.id}:${kind}`.slice(0, 120), objectLabel: `${r.conn.label} · ${saved.list.label}`, action: saved.before ? "update" : "create", actorId: ctx.userId,
    changes: [{ field: "rows", from: saved.before?.rows.length ?? 0, to: v.rows.length }, ...(saved.before ? [{ field: "changes", from: null, to: JSON.stringify(diffRows(saved.before.rows, v.rows)) }] : [])],
  });
  const docs = await usage(ctx, r.conn.id);
  const used = new Set(docs.flatMap((d) => [...listKindsUsed(d.doc).keys()]));
  return ok(describe(saved.list, used, (await unmappedOut(ctx.admin, ctx.tenantId)).get(kind) ?? []));
}

export async function deleteListOp(ctx: OpsCtx, connRaw: unknown, kind: string): Promise<Out> {
  if (!isListKind(kind)) return fail(422, "Choose a kind of list.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const all = await listAll(ctx.admin, ctx.tenantId, r.conn.id);
  if (all.pending) return needsUpdate();
  const existing = all.lists.find((l) => l.kind === kind);
  if (!existing) return fail(404, "That list was not found.");
  const by = listUsedBy(kind, await usage(ctx, r.conn.id));
  if (by.length) return fail(409, `${existing.label} is used by ${by.slice(0, 3).map((u) => `${u.field} (${u.document})`).join(", ")}${by.length > 3 ? " and more" : ""}. Change those rows first.`, { used_by: by });
  const done = await removeList(ctx.admin, ctx.tenantId, r.conn.id, kind);
  if (!done.ok) return fail(500, done.error);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "value_list", objectId: `${r.conn.id}:${kind}`.slice(0, 120), objectLabel: `${r.conn.label} · ${existing.label}`, action: "delete", actorId: ctx.userId, changes: [{ field: "rows", from: existing.rows.length, to: 0 }] });
  return ok({ deleted: true });
}

/** Proposed rows from the enum values of every target field in the connection's snapshots (active or fetched), nothing saved. */
export async function proposeListsOp(ctx: OpsCtx, connRaw: unknown, body: Record<string, unknown>): Promise<Out> {
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  if (body.kind !== undefined && !isListKind(body.kind)) return fail(422, "Choose a kind of list.");
  const [all, active] = [await listAll(ctx.admin, ctx.tenantId, r.conn.id), await listActive(ctx.admin, ctx.tenantId, r.conn.id)];
  if (all.pending) return needsUpdate();
  const fields: TargetField[] = [];
  for (const a of active) {
    const d = await getDraft(ctx.admin, ctx.tenantId, r.conn.id, a.document);
    const t = (!d.pending && d.value ? d.value.doc : a.doc).target.schema;
    fields.push(...t.fields, ...(t.lineFields ?? []));
  }
  if (!active.length) {
    // No saved mapping yet: the fetched field lists of the connection's documents.
    for (const doc of ["quote", "customers", "contacts", "products", "projects"]) {
      const d = await getDraft(ctx.admin, ctx.tenantId, r.conn.id, doc);
      if (!d.pending && d.value) fields.push(...d.value.doc.target.schema.fields, ...(d.value.doc.target.schema.lineFields ?? []));
    }
  }
  const { data } = await ctx.admin.from("tenants").select("config").eq("id", ctx.tenantId).maybeSingle();
  const known = knownValues(((data as { config?: object } | null)?.config ?? {}) as Partial<TenantConfig>);
  const items = fields.filter((f) => f.enum?.length).map((f) => ({ kind: listKindFor(f), field: f })).filter((x) => !body.kind || x.kind === body.kind);
  return ok({ lists: listsFromFields(items, known, all.lists.map((l) => l.kind)) });
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export async function csvExport(ctx: OpsCtx, connRaw: unknown, kind: string): Promise<{ csv: string; filename: string } | Out> {
  if (!isListKind(kind)) return fail(422, "Choose a kind of list.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const all = await listAll(ctx.admin, ctx.tenantId, r.conn.id);
  if (all.pending) return needsUpdate();
  const l = all.lists.find((x) => x.kind === kind);
  if (!l) return fail(404, "That list was not found.");
  return { csv: listToCsv(l), filename: `${kind.replace(/[^a-z0-9_]+/g, "-")}-value-list.csv` };
}

export const MAX_CSV_BYTES = 1024 * 1024;

/** Without `confirm` the file is only read and compared; with it the whole list is replaced. */
export async function csvImport(ctx: OpsCtx, connRaw: unknown, kind: string, text: string, confirm: boolean): Promise<Out> {
  if (!isListKind(kind)) return fail(422, "Choose a kind of list.");
  if (text.length > MAX_CSV_BYTES) return fail(422, "That file is larger than 1 MB.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const all = await listAll(ctx.admin, ctx.tenantId, r.conn.id);
  if (all.pending) return needsUpdate();
  const parsed = parseListCsv(text);
  if (!parsed.ok) return fail(422, parsed.errors[0].message, { errors: parsed.errors });
  const v = validateListInput(parsed.rows, all.lists.find((l) => l.kind === kind)?.default_in ?? null);
  if (!v.ok) return fail(422, v.errors[0].message, { errors: v.errors });
  const before = all.lists.find((l) => l.kind === kind) ?? null;
  const preview = diffRows(before?.rows ?? [], v.rows);
  if (!confirm) return ok({ preview, rows: v.rows.length });
  const saved = await saveList(ctx.admin, ctx.tenantId, ctx.userId, r.conn.id, kind, { rows: v.rows, default_in: v.default_in });
  if (!saved.ok) return saved.error === "pending" ? needsUpdate() : fail(saved.status, saved.error);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "value_list", objectId: `${r.conn.id}:${kind}`.slice(0, 120), objectLabel: `${r.conn.label} · ${saved.list.label}`, action: before ? "update" : "create", actorId: ctx.userId, changes: [{ field: "csv import", from: before?.rows.length ?? 0, to: v.rows.length }, { field: "changes", from: null, to: JSON.stringify(preview) }] });
  return ok({ preview, applied: true, rows: v.rows.length });
}

