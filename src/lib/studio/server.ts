import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import { insertWithMasterRef } from "@/lib/masterRef";
import { decrypt } from "@/lib/encryption";
import type { TenantConfig } from "@/lib/constants";
import { canSeeStudy } from "./access";
import { isUuid, type ListParams } from "./requests";
import type {
  ChangeRow, CommentRow, FitRow, MessageRow, RequestRow, StepRow, StudyBundle, StudyRow, TaskRow,
} from "./types";

// Studio server core (0152, docs/process-design-studio-architecture.md).
//
// How tenant isolation holds here, concretely (MULTI_TENANT_GUARDRAILS.md):
//   - every route starts with studioAccess() -> requireTenantUser(); the
//     tenantId used afterwards is only the one that returns;
//   - reads use the SESSION client, so the RLS policy of 0152 (creator-only on a
//     demo workspace) is the real backstop, and every query also chains
//     .eq("tenant_id", tenantId) and filters by canSeeStudy() in code;
//   - writes use the service-role client because the tables are select-only
//     for members (a study carries trust claims a member must not forge). That
//     client BYPASSES RLS, so every write below chains .eq("tenant_id", tenantId)
//     and .eq("study_id", studyId), and runs only after ownedStudy() has proved
//     the caller may see that study;
//   - ids from request bodies (a step, a task, a change) are re-checked against
//     the study before they are used.

export const PENDING_MESSAGE = "The Process Design Studio is waiting for a database update (migration 0152 has not been applied to this database).";

/** A table or column the database does not have yet (migration pending). */
export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? "");
}

export type StudioAction = "view" | "create" | "edit" | "delete";

export type StudioCtx = {
  /** The session client: RLS applies. Reads only. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Writes only, after ownedStudy(). */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  isDemo: boolean;
  config: TenantConfig;
  tenantName: string;
};

export async function studioAccess(action: StudioAction): Promise<StudioCtx> {
  const a = await requireTenantUser();
  if (!(await tenantOwnsObject(a.tenantId, "process_studies"))) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const allowed = action === "view" ? canViewWorkcenter(perms, "process_studio")
    : action === "create" ? canCreateWorkcenter(perms, "process_studio")
    : action === "edit" ? canEditWorkcenter(perms, "process_studio")
    : canDeleteWorkcenter(perms, "process_studio");
  if (!allowed) throw { status: 403, message: "Forbidden" };
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("name, is_demo, config").eq("id", a.tenantId).maybeSingle(),
  ]);
  return {
    ...a,
    admin,
    email: user?.email ?? null,
    isDemo: tenant.data?.is_demo === true,
    config: (tenant.data?.config ?? {}) as TenantConfig,
    tenantName: (tenant.data?.name as string | undefined) ?? "",
  };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string; code?: string; confirm?: boolean };
  if (typeof err.status !== "number") console.error("process studio route failed:", e);
  return Response.json({
    error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error",
    ...(err.confirm ? { confirm_required: true } : {}),
    ...(typeof err.status === "number" && typeof err.code === "string" ? { code: err.code } : {}),
  }, { status: err.status ?? 500 });
}

export function pendingResponse(): Response {
  return Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type Loaded<T> = { data: T | null; missing: boolean };

const STUDY_COLUMNS = "id, ref, name, status, reached, created_by, areas, lanes, language, follow_ups, summary, noticed, plan_start_date, weekend, contact_name, contact_email, current_version, reviewed_at, review_note, custom_data, created_at, updated_at";

export function toStudyRow(r: Record<string, unknown>): StudyRow {
  return {
    ...(r as unknown as StudyRow),
    // Encrypted at rest like contacts; the plaintext only ever goes back to the person who owns the study.
    contact_email: decrypt((r.contact_email as string | null) ?? null),
    areas: (r.areas as StudyRow["areas"]) ?? {},
    lanes: Array.isArray(r.lanes) ? (r.lanes as string[]) : [],
    noticed: Array.isArray(r.noticed) ? (r.noticed as string[]) : [],
  };
}

/**
 * The one way a route opens a study by id: tenant-scoped, RLS-backed, and
 * checked against canSeeStudy() in code. Another creator's study on a demo
 * workspace is "not found", exactly as a missing one is.
 */
export async function loadOwnedStudy(ctx: StudioCtx, id: string): Promise<Loaded<StudyRow>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("process_studies").select(STUDY_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  if (!data) return { data: null, missing: false };
  const row = toStudyRow(data as Record<string, unknown>);
  if (!canSeeStudy({ userId: ctx.userId, role: ctx.role, tenantIsDemo: ctx.isDemo }, row)) return { data: null, missing: false };
  return { data: row, missing: false };
}

/** ownedStudy(): loadOwnedStudy that throws the HTTP answer a route should give. */
export async function ownedStudy(ctx: StudioCtx, id: string): Promise<StudyRow> {
  const r = await loadOwnedStudy(ctx, id);
  if (r.missing) throw { status: 503, message: PENDING_MESSAGE };
  if (!r.data) throw { status: 404, message: "Study not found" };
  return r.data;
}

export type ListedStudy = Pick<StudyRow, "id" | "ref" | "name" | "status" | "reached" | "current_version" | "created_by" | "created_at" | "updated_at">;

export async function listStudies(ctx: StudioCtx, p: ListParams): Promise<{ rows: ListedStudy[]; total: number; missing: boolean }> {
  let q = ctx.supabase
    .from("process_studies")
    .select("id, ref, name, status, reached, current_version, created_by, created_at, updated_at", { count: "exact" })
    .eq("tenant_id", ctx.tenantId);
  if (p.status) q = q.eq("status", p.status);
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q.order("created_at", { ascending: false }).order("id").range(from, from + p.page_size - 1);
  if (error) {
    if (isMissingRelation(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: error.message };
  }
  const viewer = { userId: ctx.userId, role: ctx.role, tenantIsDemo: ctx.isDemo };
  const rows = ((data ?? []) as ListedStudy[]).filter((r) => canSeeStudy(viewer, r));
  return { rows, total: count ?? rows.length, missing: false };
}

const PAGE = 1000;

async function all<T>(
  supabase: SupabaseClient, table: string, columns: string, tenantId: string, studyId: string, order: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).eq("tenant_id", tenantId).eq("study_id", studyId);
    for (const o of order) q = q.order(o);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Everything a study screen needs, read through the caller's own session. */
export async function loadBundle(ctx: StudioCtx, study: StudyRow): Promise<StudyBundle> {
  const [messages, steps, fit, changes, tasks, comments, requests] = await Promise.all([
    all<MessageRow>(ctx.supabase, "process_study_messages", "id, role, area, text, understood, questions, created_at", ctx.tenantId, study.id, ["created_at", "id"]),
    all<StepRow>(ctx.supabase, "process_study_steps", "id, area, lane, sort_order, name, what, how_today, frequency, assumed, hands_over", ctx.tenantId, study.id, ["sort_order", "created_at", "id"]),
    all<FitRow>(ctx.supabase, "process_study_fit", "id, step_id, rating, capability_ids, why, confidence, warnings, reviewed", ctx.tenantId, study.id, ["created_at", "id"]),
    all<ChangeRow>(ctx.supabase, "process_study_changes", "id, kind, title, plain, alternative, effort_band, step_ids, extension_hook, connector, kept, client_added, sort_order", ctx.tenantId, study.id, ["sort_order", "created_at", "id"]),
    all<TaskRow>(ctx.supabase, "process_study_tasks", "id, phase, sort_order, name, owner, duration_days, milestone, from_template, client_added", ctx.tenantId, study.id, ["sort_order", "created_at", "id"]),
    all<CommentRow>(ctx.supabase, "process_study_comments", "id, phase, task_id, text, phase_ok, created_at", ctx.tenantId, study.id, ["created_at", "id"]),
    all<RequestRow>(ctx.supabase, "process_study_requests", "id, version, status, email_status, created_at", ctx.tenantId, study.id, ["created_at", "id"]),
  ]);
  return {
    study, messages, steps, changes, tasks, comments, requests,
    fit: fit.map((f) => ({ ...f, capability_ids: f.capability_ids ?? [], warnings: Array.isArray(f.warnings) ? f.warnings : [] })),
  };
}

// ── Writes (service-role client; ownership already proved) ───────────────────

export async function createStudy(ctx: StudioCtx, name: string): Promise<{ id: string; ref: string | null } | { missing: true }> {
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(
    ctx.admin, "process_studies", ctx.tenantId,
    { tenant_id: ctx.tenantId, name, created_by: ctx.userId, status: "telling", reached: 1 },
    "id, ref",
  );
  if (error || !data) {
    if (isMissingRelation(error)) return { missing: true };
    throw { status: 500, message: error?.message ?? "Could not create the study." };
  }
  return data;
}

export async function updateStudy(ctx: StudioCtx, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await ctx.admin.from("process_studies")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: error.code === "42P01" ? 503 : 500, message: error.message };
}

/** Move the study to a status and make sure the stepper has unlocked at least `reached`. */
export async function advance(ctx: StudioCtx, study: StudyRow, status: StudyRow["status"], reached: number, extra: Record<string, unknown> = {}): Promise<void> {
  // Never step backwards once submitted or reviewed: those statuses belong to the hand-off.
  const keep = ["submitted", "reviewed", "accepted", "rescoped", "closed"].includes(study.status);
  await updateStudy(ctx, study.id, { ...(keep ? {} : { status }), reached: Math.max(study.reached, reached), ...extra });
}

/** Insert rows for a study; every row carries the tenant and the study explicitly. */
export async function insertRows(ctx: StudioCtx, table: string, studyId: string, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const { data, error } = await ctx.admin.from(table)
    .insert(rows.map((r) => ({ ...r, tenant_id: ctx.tenantId, study_id: studyId })))
    .select("*");
  if (error) throw { status: error.code === "42P01" ? 503 : 500, message: error.message };
  return (data ?? []) as Record<string, unknown>[];
}

export async function deleteRows(ctx: StudioCtx, table: string, studyId: string): Promise<void> {
  const { error } = await ctx.admin.from(table).delete().eq("tenant_id", ctx.tenantId).eq("study_id", studyId);
  if (error) throw { status: error.code === "42P01" ? 503 : 500, message: error.message };
}

/** A child row of this study, or null: the check every id from a request body goes through. */
export async function childOf<T extends { id: string }>(
  ctx: StudioCtx, table: string, studyId: string, childId: unknown, columns = "*",
): Promise<T | null> {
  if (!isUuid(childId)) return null;
  const { data } = await ctx.admin.from(table).select(columns).eq("id", childId).eq("tenant_id", ctx.tenantId).eq("study_id", studyId).maybeSingle();
  return (data as unknown as T | null) ?? null;
}

// ── Versions ────────────────────────────────────────────────────────────────

/** Freeze the study as the next version: steps + fit + changes + tasks + comments, as they stand now. */
export async function snapshotVersion(ctx: StudioCtx, study: StudyRow, reason: "submitted" | "re-run" | "manual"): Promise<number> {
  const bundle = await loadBundle(ctx, study);
  const version = study.current_version + 1;
  const { error } = await ctx.admin.from("process_study_versions").insert({
    tenant_id: ctx.tenantId, study_id: study.id, version, reason, created_by: ctx.userId,
    snapshot: {
      name: study.name, summary: study.summary, noticed: study.noticed, plan_start_date: study.plan_start_date, weekend: study.weekend,
      steps: bundle.steps, fit: bundle.fit, changes: bundle.changes, tasks: bundle.tasks, comments: bundle.comments,
    },
  });
  if (error) throw { status: error.code === "42P01" ? 503 : 500, message: error.message };
  await updateStudy(ctx, study.id, { current_version: version });
  return version;
}

// ── Platform settings (where "Talk to us" goes) ──────────────────────────────

export const NOTIFY_SETTING_KEY = "process_studio";

/** The address a study request is emailed to: the platform setting first, then PROCESS_STUDIO_NOTIFY_EMAIL. Null when neither is set. */
export async function loadNotifyAddress(): Promise<{ address: string | null; source: "setting" | "env" | "none" }> {
  const { data, error } = await createAdminSupabase().from("platform_settings").select("value").eq("key", NOTIFY_SETTING_KEY).maybeSingle();
  if (!error) {
    const v = ((data?.value ?? {}) as { notify_email?: unknown }).notify_email;
    if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return { address: v.trim(), source: "setting" };
  }
  const env = (process.env.PROCESS_STUDIO_NOTIFY_EMAIL ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env)) return { address: env, source: "env" };
  return { address: null, source: "none" };
}
