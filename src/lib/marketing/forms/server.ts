import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_HOST, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange, diffForLog } from "@/lib/changeLog";
import { decrypt } from "@/lib/encryption";
import { topicsOf } from "../config";
import { isSchemaPending } from "../pending";
import { allowedRedirectHosts, sanitizeFormSave, type FormSavePayload } from "./sanitize";
import { newPublicKey } from "./links";
import { formsEnabled, toFormRow } from "./submit";
import { defaultAfterSubmit, defaultConsentText, defaultFields, type FormRow } from "./types";

// Forms: the signed-in side (docs/shells/forms-shell.md). Every route starts with
// formsAccess() -> requireTenantUser(); the tenant used afterwards is only the one it
// returns. Reads and plain writes use the SESSION client (the 0170 policy is the real
// backstop) and every query also chains .eq("tenant_id", tenantId).

export const PENDING_MESSAGE = "Forms are waiting for a database update (migration 0170 has not been applied to this database).";

export type FormAction = "view" | "create" | "edit" | "delete";

export type FormsCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  tenantName: string;
  customDomain: string | null;
  isDemo: boolean;
  config: TenantConfig;
  can: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

export async function formsAccess(action: FormAction): Promise<FormsCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("name, is_demo, custom_domain, config, features").eq("id", a.tenantId).maybeSingle(),
  ]);
  if (!formsEnabled(tenant.data?.features as Partial<TenantFeatures> | undefined)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = {
    view: canViewWorkcenter(perms, "marketing_forms"), create: canCreateWorkcenter(perms, "marketing_forms"),
    edit: canEditWorkcenter(perms, "marketing_forms"), delete: canDeleteWorkcenter(perms, "marketing_forms"),
  };
  if (!can[action]) throw { status: 403, message: "Forbidden" };
  return {
    ...a, admin, email: user?.email ?? null,
    tenantName: (tenant.data?.name as string | undefined) ?? "", customDomain: (tenant.data?.custom_domain as string | null | undefined) ?? null,
    isDemo: tenant.data?.is_demo === true, config: (tenant.data?.config ?? {}) as TenantConfig, can,
  };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  if (typeof err.status !== "number") console.error("forms route failed:", e);
  return Response.json({ error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error" }, { status: err.status ?? 500 });
}

export const pendingResponse = (): Response => Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const saveContext = (ctx: FormsCtx) => ({
  topicKeys: topicsOf(ctx.config).map((t) => t.key),
  redirectHosts: allowedRedirectHosts({ custom_domain: ctx.customDomain, is_demo: ctx.isDemo }, PRIMARY_HOST),
});

// ── reads ───────────────────────────────────────────────────────────────────

export type Loaded<T> = { data: T | null; missing: boolean };

export async function loadForm(ctx: FormsCtx, id: string): Promise<Loaded<FormRow>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("forms").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isSchemaPending(error) };
  return { data: data ? toFormRow(data as Record<string, unknown>) : null, missing: false };
}

export type ListedForm = Pick<FormRow, "id" | "ref" | "name" | "slug" | "status" | "updated_at"> & { submissions: number; last_submitted: string | null };

export type ListFormsParams = { q: string; status: "draft" | "live" | "archived" | null; page: number; page_size: number };

export function parseFormListParams(sp: URLSearchParams): ListFormsParams {
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  const status = sp.get("status");
  return {
    q: (sp.get("q") ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60),
    status: status === "draft" || status === "live" || status === "archived" ? status : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: 20,
  };
}

export async function listForms(ctx: FormsCtx, p: ListFormsParams): Promise<{ rows: ListedForm[]; total: number; missing: boolean }> {
  let q = ctx.supabase.from("forms").select("id, ref, name, slug, status, updated_at", { count: "exact" }).eq("tenant_id", ctx.tenantId);
  if (p.status) q = q.eq("status", p.status);
  else q = q.neq("status", "archived");
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%,slug.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q.order("updated_at", { ascending: false }).order("id").range(from, from + p.page_size - 1);
  if (error) {
    if (isSchemaPending(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: "Could not load forms" };
  }
  const base = (data ?? []) as Omit<ListedForm, "submissions" | "last_submitted">[];
  const subs = base.length
    ? await ctx.supabase.from("form_submissions").select("form_id, created_at").eq("tenant_id", ctx.tenantId).in("form_id", base.map((r) => r.id)).order("created_at", { ascending: false }).limit(2000)
    : { data: [] as { form_id: string; created_at: string }[] };
  const counts = new Map<string, { n: number; last: string | null }>();
  for (const s of (subs.data ?? []) as { form_id: string; created_at: string }[]) {
    const c = counts.get(s.form_id) ?? { n: 0, last: null };
    c.n++; c.last = c.last ?? s.created_at;
    counts.set(s.form_id, c);
  }
  return { rows: base.map((r) => ({ ...r, submissions: counts.get(r.id)?.n ?? 0, last_submitted: counts.get(r.id)?.last ?? null })), total: count ?? base.length, missing: false };
}

export type SubmissionView = { id: string; created_at: string; name: string; email: string; company: string; message: string; consent_given: boolean; outcome: string; lead_id: string | null };

/** The latest answers, decrypted for a signed-in member of the same workspace. */
export async function recentSubmissions(ctx: FormsCtx, formId: string, limit = 25): Promise<SubmissionView[]> {
  const { data, error } = await ctx.supabase
    .from("form_submissions").select("id, created_at, answers, consent_given, outcome, lead_id")
    .eq("tenant_id", ctx.tenantId).eq("form_id", formId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return ((data ?? []) as { id: string; created_at: string; answers: Record<string, string | null> | null; consent_given: boolean; outcome: string; lead_id: string | null }[]).map((r) => ({
    id: r.id, created_at: r.created_at, consent_given: r.consent_given, outcome: r.outcome, lead_id: r.lead_id,
    name: decrypt(r.answers?.name ?? null) ?? "", email: decrypt(r.answers?.email ?? null) ?? "",
    company: decrypt(r.answers?.company ?? null) ?? "", message: decrypt(r.answers?.message ?? null) ?? "",
  }));
}

// ── writes ──────────────────────────────────────────────────────────────────

export function newFormDefaults(ctx: Pick<FormsCtx, "tenantName">): FormSavePayload {
  return {
    name: "", slug: "", status: "draft", title: "Contact us", intro: "Tell us a little about what you need and we will get back to you.", button_label: "Send",
    fields: defaultFields(), consent: { text: defaultConsentText(ctx.tenantName), topics: [], required: false }, after_submit: defaultAfterSubmit(),
  };
}

/** The person told about each answer must belong to THIS workspace; an id from the request body is never trusted. */
async function checkNotifyUser(ctx: FormsCtx, after: FormSavePayload["after_submit"]): Promise<void> {
  if (!after.notify_user_id) return;
  const { data } = await ctx.admin.from("tenant_users").select("user_id").eq("tenant_id", ctx.tenantId).eq("user_id", after.notify_user_id).maybeSingle();
  if (!data) throw { status: 422, message: "That person is not a member of this workspace" };
}

const slugTaken = (e: { code?: string; message?: string } | null) => e?.code === "23505" && (e.message ?? "").includes("forms_tenant_slug_uniq");

export async function createForm(ctx: FormsCtx, body: unknown): Promise<{ id: string; ref: string | null; slug: string; warnings: string[] } | { missing: true }> {
  const r = sanitizeFormSave(body, saveContext(ctx), ctx.tenantName);
  if (!r.ok) throw { status: 422, message: r.error };
  const v = r.value;
  await checkNotifyUser(ctx, v.after_submit);
  for (let n = 0; n < 6; n++) {
    const slug = n === 0 ? v.slug : `${v.slug.slice(0, 54)}-${n + 1}`;
    const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(ctx.supabase, "forms", ctx.tenantId, {
      tenant_id: ctx.tenantId, name: v.name, slug, public_key: newPublicKey(), status: v.status, title: v.title, intro: v.intro,
      button_label: v.button_label, fields: v.fields, consent: v.consent, after_submit: v.after_submit, created_by: ctx.userId,
    }, "id, ref");
    if (!error && data) {
      await logChange(ctx.supabase, {
        tenantId: ctx.tenantId, objectType: "forms", objectId: data.id, objectLabel: data.ref ?? v.name,
        action: "create", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "name", from: null, to: v.name }],
      });
      return { id: data.id, ref: data.ref, slug, warnings: r.warnings };
    }
    if (error && isSchemaPending(error)) return { missing: true };
    if (!slugTaken(error)) throw { status: 500, message: "Could not save the form" };
  }
  throw { status: 409, message: "That web address is already used by another form" };
}

export async function saveForm(ctx: FormsCtx, id: string, body: unknown): Promise<{ warnings: string[] } | { missing: true }> {
  const current = await loadForm(ctx, id);
  if (current.missing) return { missing: true };
  if (!current.data) throw { status: 404, message: "Form not found" };
  const r = sanitizeFormSave(body, saveContext(ctx), ctx.tenantName);
  if (!r.ok) throw { status: 422, message: r.error };
  const v = r.value;
  await checkNotifyUser(ctx, v.after_submit);
  const { error } = await ctx.supabase.from("forms").update({
    name: v.name, slug: v.slug, status: v.status, title: v.title, intro: v.intro, button_label: v.button_label,
    fields: v.fields, consent: v.consent, after_submit: v.after_submit, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) {
    if (slugTaken(error)) throw { status: 409, message: "That web address is already used by another form" };
    throw { status: 500, message: "Could not save the form" };
  }
  const before = current.data as unknown as Record<string, unknown>;
  const changes = diffForLog("forms", before, {
    name: v.name, slug: v.slug, status: v.status, title: v.title, intro: v.intro, button_label: v.button_label,
    fields: v.fields, consent: v.consent, after_submit: v.after_submit,
  });
  if (changes.length) {
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "forms", objectId: id, objectLabel: current.data.ref ?? current.data.name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes,
    });
  }
  return { warnings: r.warnings };
}

/** A form with answers is archived, not deleted: deleting it would delete the evidence with it. */
export async function deleteForm(ctx: FormsCtx, id: string): Promise<"deleted" | "has_submissions" | "missing" | "not_found"> {
  const current = await loadForm(ctx, id);
  if (current.missing) return "missing";
  if (!current.data) return "not_found";
  const { data } = await ctx.admin.from("form_submissions").select("id").eq("tenant_id", ctx.tenantId).eq("form_id", id).limit(1);
  if (((data ?? []) as unknown[]).length > 0) return "has_submissions";
  const { error } = await ctx.supabase.from("forms").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: 500, message: "Could not delete the form" };
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "forms", objectId: id, objectLabel: current.data.ref ?? current.data.name,
    action: "delete", actorId: ctx.userId, actorEmail: ctx.email, changes: [],
  });
  return "deleted";
}
