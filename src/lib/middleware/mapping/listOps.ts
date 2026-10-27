import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import type { TenantConfig } from "@/lib/constants";
import { loadOrgDirectory, type OrgDirectory } from "../erpOrgNames";
import { isOrgKind, keyFromText, orgKeyLabel, orgKindsFor, parseOrgKey } from "../erpOrgPure";
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
    // An organisation list is read by the order, not by a mapping field, so "unused" would only mislead.
    counts: { rows: list.rows.length, unused: isOrgKind(list.kind) ? 0 : unusedCount(list, usedKinds), unmapped: unmappedOut.length + unmappedIn.length },
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
  const orgKinds = orgKindsFor(r.conn.id);
  // SAP S/4HANA reads what it maps, so the ordinary unit/currency lists are not offered there; only its organisation list.
  const sapOnly = r.conn.id === "sap_s4" || r.conn.id === "sap";
  const offered = STANDARD_LIST_KINDS.filter((k) => (isOrgKind(k) ? orgKinds.includes(k) : !sapOnly));
  const directory = orgKinds.length ? await loadOrgDirectory(ctx.admin, ctx.tenantId) : null;
  return ok({
    lists: all.lists.filter((l) => !isOrgKind(l.kind) || orgKinds.includes(l.kind)).map((l) => describe(l, used, outValues.get(l.kind) ?? [])),
    standardKinds: offered.map((k) => ({ kind: k, label: kindLabel(k), created: all.lists.some((l) => l.kind === k) })),
    // What the BPMSquare side of an organisation list can be: every coverage and order type of this workspace, and their names.
    ...(directory ? { org: directory } : {}),
  });
}

type OrgRow = { bpm: string; erp: string; inbound?: boolean };

/**
 * The server half of an org list's validation: every key has to be a coverage or order type of THIS workspace. A row that was
 * already saved may stay even when its target has since been removed (it shows "(removed)" until the person deletes it); a new or
 * changed key may not point at anything that is not here, which is also what stops another workspace's id being saved.
 */
function orgTargetErrors(rows: readonly OrgRow[], directory: OrgDirectory, savedKeys: ReadonlySet<string>): { row: number; message: string }[] {
  const out: { row: number; message: string }[] = [];
  rows.forEach((r, i) => {
    const k = parseOrgKey(r.bpm);
    if (!k) return;
    const here = directory.names[k.type][k.id] !== undefined;
    if (!here && !savedKeys.has(r.bpm.toLowerCase())) out.push({ row: i, message: "That coverage or order type was not found in this workspace." });
  });
  return out;
}

function orgGuard(connId: string, kind: string): Out | null {
  if (!isOrgKind(kind)) return null;
  if (!orgKindsFor(connId).includes(kind)) {
    return fail(422, kind === "sales_area" ? "A sales area list belongs to SAP S/4HANA." : "An ERP company list belongs to Dynamics 365.");
  }
  return null;
}

export async function putList(ctx: OpsCtx, connRaw: unknown, kind: string, body: Record<string, unknown>): Promise<Out> {
  if (!isListKind(kind)) return fail(422, "Choose a kind of list: unit, currency, country, payment_terms, incoterms, status, sales_area, erp_company, or custom:<name>.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const wrong = orgGuard(r.conn.id, kind);
  if (wrong) return wrong;
  const v = validateListInput(body.rows, body.default_in, kind);
  if (!v.ok) return fail(422, v.errors[0].message, { errors: v.errors });
  if (isOrgKind(kind)) {
    const [directory, current] = await Promise.all([loadOrgDirectory(ctx.admin, ctx.tenantId), listAll(ctx.admin, ctx.tenantId, r.conn.id)]);
    const savedKeys = new Set(current.pending ? [] : (current.lists.find((l) => l.kind === kind)?.rows ?? []).map((x) => x.bpm.toLowerCase()));
    const errors = orgTargetErrors(v.rows, directory, savedKeys);
    if (errors.length) return fail(422, errors[0].message, { errors });
  }
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
  if (isOrgKind(l.kind)) {
    // A person reads and edits names, not ids: the file carries the current name of each coverage or order type.
    const { names } = await loadOrgDirectory(ctx.admin, ctx.tenantId);
    const named = l.rows.map((x) => { const lab = orgKeyLabel(x.bpm, names); return lab.removed ? x : { ...x, bpm: lab.label }; });
    return { csv: listToCsv({ rows: named }), filename: `${kind.replace(/[^a-z0-9_]+/g, "-")}-value-list.csv` };
  }
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
  const wrong = orgGuard(r.conn.id, kind);
  if (wrong) return wrong;
  const parsed = parseListCsv(text);
  if (!parsed.ok) return fail(422, parsed.errors[0].message, { errors: parsed.errors });
  const before = all.lists.find((l) => l.kind === kind) ?? null;
  let fileRows: OrgRow[] = parsed.rows;
  let directory: OrgDirectory | null = null;
  if (isOrgKind(kind)) {
    // The file names coverages and order types the way the screen does; each name becomes its key, or the row says why not.
    const dir = await loadOrgDirectory(ctx.admin, ctx.tenantId);
    directory = dir;
    const errors: { row: number; message: string }[] = [];
    fileRows = parsed.rows.map((x, i) => {
      if (!x.bpm.trim() && !x.erp.trim()) return x;
      const k = keyFromText(x.bpm, dir.names);
      if (!k.ok) { errors.push({ row: i, message: k.message }); return x; }
      return { ...x, bpm: k.key };
    });
    if (errors.length) return fail(422, errors[0].message, { errors });
  }
  const v = validateListInput(fileRows, before?.default_in ?? null, kind);
  if (!v.ok) return fail(422, v.errors[0].message, { errors: v.errors });
  if (directory) {
    const errors = orgTargetErrors(v.rows, directory, new Set((before?.rows ?? []).map((x) => x.bpm.toLowerCase())));
    if (errors.length) return fail(422, errors[0].message, { errors });
  }
  const preview = diffRows(before?.rows ?? [], v.rows);
  if (!confirm) return ok({ preview, rows: v.rows.length });
  const saved = await saveList(ctx.admin, ctx.tenantId, ctx.userId, r.conn.id, kind, { rows: v.rows, default_in: v.default_in });
  if (!saved.ok) return saved.error === "pending" ? needsUpdate() : fail(saved.status, saved.error);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "value_list", objectId: `${r.conn.id}:${kind}`.slice(0, 120), objectLabel: `${r.conn.label} · ${saved.list.label}`, action: before ? "update" : "create", actorId: ctx.userId, changes: [{ field: "csv import", from: before?.rows.length ?? 0, to: v.rows.length }, { field: "changes", from: null, to: JSON.stringify(preview) }] });
  return ok({ preview, applied: true, rows: v.rows.length });
}

