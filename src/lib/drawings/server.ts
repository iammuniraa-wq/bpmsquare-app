import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { isMissingSchema } from "@/lib/tender/server";
import { loadActorNames } from "@/lib/actorNames";
import { nameFromEmail } from "@/lib/personName";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import type { DrawingRow, DrawingTypeRow, ElementRow, RevisionRow } from "./types";

// Shared plumbing of the /api/drawings* routes and the pages (migrations 0255-0257). Every query is tenant-scoped on the admin client
// (MULTI_TENANT_GUARDRAILS.md); every one tolerates the migration being pending (a missing table reads as "database update needed",
// never a crash); nothing runs for a workspace without the platform-admin flag `drawing_register` (the gate answers 404 first).
// Writes are ONLY made through the admin client behind this gate: the tables carry a select-only member policy (0255).

export const DRAWINGS_BUNDLE = "scripts/run-bundle-dwg-0255-0256-2026-11-24.sql";
export const PINS_BUNDLE = "scripts/run-bundle-dwg-0257-2026-11-24.sql";
export { isMissingSchema };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DrawingCtx = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  canEdit: boolean;
};
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };

export const needsUpdate = (): Failure => ({
  status: 503, error: "A database update is needed before the drawing register can be used. Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: DRAWINGS_BUNDLE },
});
export const needsPinsUpdate = (): Failure => ({
  status: 503, error: "Drawing quantities on the bill of quantities need a database update (migration 0257). Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: PINS_BUNDLE },
});

/**
 * The gate every route starts with: a signed-in member of a workspace that owns the module, who may open Engineering. `write` also needs
 * the edit grant (preparing and submitting only: RELEASING is an authority decided by the drawing type, not by this grant) and `admin`
 * the workspace admin. A miss on the module is a plain 404, so a workspace without it cannot tell the module exists.
 */
export async function openDrawingRequest(opts: { write?: boolean; admin?: boolean } = {}): Promise<{ ok: true; req: DrawingCtx } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  if (!(await tenantHasFeature(supabase, tenantId, "drawing_register"))) return notFound;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "drawing_register")) return notFound;
  const canEdit = canEditWorkcenter(perms, "drawing_register");
  if (opts.admin && role !== "admin") return { ok: false, status: 403, error: "Only a workspace admin can do this" };
  if (opts.write && !canEdit) return { ok: false, status: 403, error: "You can view drawings but not change them" };
  return { ok: true, req: { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit } };
}

// ── Column lists (explicit: nothing internal leaks through a select *) ──────────────────────────────────────────────

export const TYPE_COLS = "id, tenant_id, name, numbering_pattern, rev_scheme, approver_ids, second_person, required_fields, feeds, schedule_map, active, sort_order";
export const DRAWING_COLS = "id, tenant_id, ref, drawing_no, external_no, title, type_id, opportunity_id, project_id, wbs_item_id, current_rev_id, custom_data, archived_at, created_by, created_at, updated_at";
export const REVISION_COLS = "id, tenant_id, drawing_id, rev_no, rev_label, status, file_path, file_name, file_type, file_size, file_sha256, source, source_ref, notes, return_reason, submitted_by, submitted_at, released_by, released_at, effective_from, supersedes_rev_id, change_summary, created_by, created_at";
export const ELEMENT_COLS = "id, tenant_id, revision_id, drawing_id, row_no, model_uid, element_code, element_type, building, wbs_item_id, level, qty, unit, volume_m3, area_m2, length_m, weight_t, weight_calculated, attrs";

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export const normaliseType = (r: Record<string, unknown>): DrawingTypeRow => ({
  ...(r as unknown as DrawingTypeRow),
  approver_ids: Array.isArray(r.approver_ids) ? (r.approver_ids as string[]) : [],
  required_fields: Array.isArray(r.required_fields) ? (r.required_fields as string[]) : [],
  feeds: Array.isArray(r.feeds) ? (r.feeds as string[]) : [],
  second_person: r.second_person !== false,
  active: r.active !== false,
  rev_scheme: r.rev_scheme === "numbers" ? "numbers" : "letters",
  sort_order: Number(r.sort_order ?? 0),
  schedule_map: (r.schedule_map as Record<string, unknown> | null) ?? null,
});
export const normaliseRevision = (r: Record<string, unknown>): RevisionRow => ({
  ...(r as unknown as RevisionRow), rev_no: Number(r.rev_no ?? 0), file_size: numOrNull(r.file_size),
  change_summary: (r.change_summary as RevisionRow["change_summary"]) ?? {},
});
export const normaliseElement = (r: Record<string, unknown>): ElementRow => ({
  ...(r as unknown as ElementRow), row_no: Number(r.row_no ?? 0), qty: Number(r.qty ?? 0),
  volume_m3: numOrNull(r.volume_m3), area_m2: numOrNull(r.area_m2), length_m: numOrNull(r.length_m), weight_t: numOrNull(r.weight_t),
  weight_calculated: r.weight_calculated === true, attrs: (r.attrs as Record<string, unknown> | null) ?? {},
});

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadDrawing(admin: SupabaseClient, tenantId: string, id: string): Promise<{ kind: "ok"; drawing: DrawingRow } | { kind: "missing" } | { kind: "pending" }> {
  if (!UUID_RE.test(id)) return { kind: "missing" };
  const { data, error } = await admin.from("drawings").select(DRAWING_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return isMissingSchema(error) ? { kind: "pending" } : { kind: "missing" };
  return data ? { kind: "ok", drawing: data as unknown as DrawingRow } : { kind: "missing" };
}

export async function loadRevisions(admin: SupabaseClient, tenantId: string, drawingId: string): Promise<{ rows: RevisionRow[]; pending: boolean }> {
  const { data, error } = await admin.from("drawing_revisions").select(REVISION_COLS).eq("tenant_id", tenantId).eq("drawing_id", drawingId).order("rev_no", { ascending: true });
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(normaliseRevision), pending: false };
}

export async function loadRevision(admin: SupabaseClient, tenantId: string, drawingId: string, revisionId: string): Promise<RevisionRow | null> {
  if (!UUID_RE.test(revisionId)) return null;
  const { data } = await admin.from("drawing_revisions").select(REVISION_COLS).eq("id", revisionId).eq("drawing_id", drawingId).eq("tenant_id", tenantId).maybeSingle();
  return data ? normaliseRevision(data as unknown as Record<string, unknown>) : null;
}

export async function loadType(admin: SupabaseClient, tenantId: string, typeId: string | null): Promise<DrawingTypeRow | null> {
  if (!typeId || !UUID_RE.test(typeId)) return null;
  const { data } = await admin.from("drawing_types").select(TYPE_COLS).eq("id", typeId).eq("tenant_id", tenantId).maybeSingle();
  return data ? normaliseType(data as unknown as Record<string, unknown>) : null;
}

export async function listTypes(admin: SupabaseClient, tenantId: string): Promise<{ rows: DrawingTypeRow[]; pending: boolean }> {
  const { data, error } = await admin.from("drawing_types").select(TYPE_COLS).eq("tenant_id", tenantId).order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(normaliseType), pending: false };
}

/** The one default type ("Drawing") a workspace starts with. Created on first use, never twice (the name is unique). */
export async function ensureDefaultType(admin: SupabaseClient, tenantId: string): Promise<DrawingTypeRow | null> {
  const { rows, pending } = await listTypes(admin, tenantId);
  if (pending) return null;
  // The default is the type called "Drawing" when the workspace has it, else its first type that is in use.
  if (rows.length > 0) return rows.find((t) => t.active && t.name.trim().toLowerCase() === "drawing") ?? rows.find((t) => t.active) ?? rows[0];
  const { data, error } = await admin.from("drawing_types").insert({ tenant_id: tenantId, name: "Drawing", rev_scheme: "letters", second_person: true, feeds: ["estimate", "boq", "handover"] }).select(TYPE_COLS).single();
  if (error) {
    const again = await listTypes(admin, tenantId);
    return again.rows[0] ?? null;
  }
  return normaliseType(data as unknown as Record<string, unknown>);
}

export async function loadElements(admin: SupabaseClient, tenantId: string, revisionId: string): Promise<ElementRow[]> {
  const out: ElementRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("drawing_revision_elements").select(ELEMENT_COLS).eq("tenant_id", tenantId).eq("revision_id", revisionId).order("row_no", { ascending: true }).range(from, from + 999);
    if (error) break;
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...batch.map(normaliseElement));
    if (batch.length < 1000) break;
  }
  return out;
}

/** How many elements each revision declares (a cheap exact count per revision; a drawing has a handful of revisions). */
export async function loadElementCounts(admin: SupabaseClient, tenantId: string, revisionIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(revisionIds.map(async (id) => {
    const { count, error } = await admin.from("drawing_revision_elements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("revision_id", id);
    out.set(id, error ? 0 : count ?? 0);
  }));
  return out;
}

/** Names for the "By" of a row: the workspace's own name for the person, else a readable name from their sign-in, never a bare address. */
export async function namesFor(admin: SupabaseClient, tenantId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const names = await loadActorNames(admin, tenantId, ids);
  const want = [...new Set(ids.filter((x): x is string => !!x))].filter((i) => !names.has(i));
  if (want.length) {
    try {
      const members = await listMembersForPicker(admin, tenantId);
      for (const m of members) if (want.includes(m.user_id)) names.set(m.user_id, m.name ?? nameFromEmail(m.email) ?? "A colleague");
    } catch { /* names are a courtesy */ }
  }
  return names;
}

// ── Foreign ids from a body: verified before use (MULTI_TENANT_GUARDRAILS.md) ──────────────────────────────────────

export type Links = { opportunity_id?: string | null; project_id?: string | null; wbs_item_id?: string | null; type_id?: string | null };

/**
 * Every foreign id a client sends is resolved against the caller's own tenant before it is written. Returns a message for the first one
 * that does not belong, else null. A building (WBS item) must belong to the tender it is filed under when both are given.
 */
export async function verifyLinks(admin: SupabaseClient, tenantId: string, links: Links): Promise<string | null> {
  const check = async (table: string, id: string | null | undefined, label: string): Promise<string | null> => {
    if (!id) return null;
    if (!UUID_RE.test(id)) return `${label} is not valid`;
    const { data } = await admin.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    return data ? null : `${label} was not found`;
  };
  const a = await check("drawing_types", links.type_id, "That drawing type")
    ?? await check("opportunities", links.opportunity_id, "That tender")
    ?? await check("contract_projects", links.project_id, "That project");
  if (a) return a;
  if (links.wbs_item_id) {
    if (!UUID_RE.test(links.wbs_item_id)) return "That building is not valid";
    const { data } = await admin.from("tender_wbs_items").select("id, opportunity_id").eq("id", links.wbs_item_id).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return "That building was not found";
    if (links.opportunity_id && (data as { opportunity_id: string }).opportunity_id !== links.opportunity_id) return "That building belongs to a different tender";
  }
  return null;
}

/** Approvers must be members of THIS workspace. Returns the ids that are not. */
export async function foreignApprovers(admin: SupabaseClient, tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", ids);
  const known = new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  return ids.filter((i) => !known.has(i));
}

/** The signed download link of a revision's file: 5 minutes, an attachment (never rendered in our origin). */
export async function signedDownload(admin: SupabaseClient, rev: Pick<RevisionRow, "file_path" | "file_name">): Promise<string | null> {
  if (!rev.file_path) return null;
  const { data, error } = await admin.storage.from("drawing-files").createSignedUrl(rev.file_path, 300, { download: rev.file_name ?? true });
  return error || !data?.signedUrl ? null : data.signedUrl;
}
