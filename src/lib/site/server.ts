import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/tender/server";
import { loadActorNames } from "@/lib/actorNames";
import { loadApprovers } from "@/lib/tender/approvalServer";
import { loadNotifyTenant, memberEmails } from "@/lib/tender/notify";
import { projectInboxNote, projectLink, sendProjectMail } from "@/lib/contractProjects/notify";
import { loadRevisions, currentRevision } from "@/lib/contractProjects/server";
import { readAllPages } from "@/lib/pagedRead";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { EVIDENCE_BUCKET, evidencePath, evidenceProblem, pathBelongsTo, siteConfig, sniffEvidence } from "./files";
import { DEFAULT_CATEGORIES, SITE_LIMITS, UUID_RE, isUuid, type SiteExpenseCategory } from "./types";

// Shared plumbing of the /api/site-* routes and the site pages (migrations 0258 expenses, 0259 receipts, 0260 the per-project switch). Every
// query is tenant-scoped on the admin client (MULTI_TENANT_GUARDRAILS.md: the tables have a SELECT-only policy, so a write can only come
// from here) and every one tolerates a migration still pending: a missing table or column reads as "database update needed", never a crash.
// Nothing here runs for a workspace without the platform-admin flag of the module: the gate answers 404 first.

export const EXPENSES_BUNDLE = "scripts/run-bundle-site-0258-expenses-2026-11-24.sql";
export const RECEIPTS_BUNDLE = "scripts/run-bundle-site-0259-receipts-2026-11-24.sql";
export const SITE_ENTRY_BUNDLE = "scripts/run-bundle-site-0260-site-entry-2026-11-24.sql";
export { isMissingSchema, UUID_RE };

export type SiteModule = "site_expenses" | "site_receipts";
export type SiteCtx = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  config: ReturnType<typeof siteConfig>;
  tenantConfig: TenantConfig | null;
  features: Partial<TenantFeatures>;
};
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };

export const needsUpdate = (module: SiteModule): Failure => ({
  status: 503,
  error: `${module === "site_expenses" ? "Site expenses need" : "Site receipts need"} a database update. Ask your administrator to apply it.`,
  extra: { needsDatabaseUpdate: true, bundle: module === "site_expenses" ? EXPENSES_BUNDLE : RECEIPTS_BUNDLE },
});

/**
 * The gate every site route starts with: a signed-in member of a workspace that owns the module and Contract projects. Any miss is a plain
 * 404, so a workspace without the module cannot tell it exists. The site workcenter keys only hide menu items (Business Roles are not a
 * security boundary), so no workcenter is checked here; what a person may do to a record is decided by its own rules.
 */
export async function openSiteRequest(module: SiteModule | "any"): Promise<{ ok: true; req: SiteCtx } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = ((data as { features?: Partial<TenantFeatures> } | null)?.features ?? {}) as Partial<TenantFeatures>;
  const on = module === "any" ? features.site_expenses === true || features.site_receipts === true : features[module] === true;
  if (!on || features.contract_projects !== true) return { ok: false, status: 404, error: "Not found" };
  const tenantConfig = ((data as { config?: TenantConfig } | null)?.config ?? null) as TenantConfig | null;
  return { ok: true, req: { admin, supabase, tenantId, userId, role, config: siteConfig(tenantConfig as { site?: unknown } | null), tenantConfig, features } };
}

export const failure = (f: Failure) => Response.json({ error: f.error, ...(f.extra ?? {}) }, { status: f.status });

// ── Projects, cost lines, categories ───────────────────────────────────────────────────────────────────────────────

export type SiteProject = { id: string; ref: string | null; name: string; currency: string | null; manager_id: string | null; status: string; site_entry: boolean };

/** The projects a site person may record on: active, with Site entry on (a database without 0260 reads every project as on). */
export async function loadSiteProjects(admin: SupabaseClient, tenantId: string, onlyId?: string): Promise<SiteProject[]> {
  const read = async (cols: string) => {
    let q = admin.from("contract_projects").select(cols).eq("tenant_id", tenantId).eq("status", "active");
    if (onlyId) q = q.eq("id", onlyId);
    return q.order("name", { ascending: true }).limit(500);
  };
  let { data, error } = await read("id, ref, name, currency, manager_id, status, site_entry");
  if (error && isMissingSchema(error)) ({ data, error } = await read("id, ref, name, currency, manager_id, status"));
  if (error) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((r) => ({ ...(r as unknown as SiteProject), site_entry: r.site_entry !== false }))
    .filter((p) => p.site_entry);
}

/** One project a site entry may be made on, or null (another workspace's, closed, or switched off). */
export async function projectForSite(admin: SupabaseClient, tenantId: string, projectId: string): Promise<SiteProject | null> {
  if (!isUuid(projectId)) return null;
  return (await loadSiteProjects(admin, tenantId, projectId))[0] ?? null;
}

/** Any project of this workspace (a manager looking at a closed one too): the display side. */
export async function anyProject(admin: SupabaseClient, tenantId: string, projectId: string): Promise<SiteProject | null> {
  if (!isUuid(projectId)) return null;
  let { data, error } = await admin.from("contract_projects").select("id, ref, name, currency, manager_id, status, site_entry").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
  // Migration 0260 pending: every project reads as "site entry on".
  if (error && isMissingSchema(error)) ({ data, error } = await admin.from("contract_projects").select("id, ref, name, currency, manager_id, status").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle());
  if (error || !data) return null;
  return { ...(data as unknown as SiteProject), site_entry: (data as { site_entry?: boolean }).site_entry !== false };
}

export type CostLineChoice = { line_key: string; description: string; resource_code: string | null; wbs: string | null };

/**
 * The names a site person picks a cost line from: NO amounts, quantities or costs (a site person never sees budget figures). The approved
 * revision when there is one, else the one being worked on.
 */
export async function loadCostLineChoices(admin: SupabaseClient, tenantId: string, projectId: string): Promise<CostLineChoice[]> {
  const { rows } = await loadRevisions(admin, tenantId, projectId);
  const revision = rows.filter((r) => r.status === "approved").sort((a, b) => b.rev_no - a.rev_no)[0] ?? currentRevision(rows);
  if (!revision) return [];
  const { data, error } = await readAllPages((lo, hi) => admin.from("project_budget_lines").select("line_key, description, resource_code, wbs, reserve").eq("tenant_id", tenantId).eq("revision_id", revision.id).order("line_no", { ascending: true }).range(lo, hi));
  if (error) return [];
  return ((data ?? []) as { line_key: string; description: string; resource_code: string | null; wbs: string | null; reserve: boolean }[])
    .filter((l) => !l.reserve)
    .map((l) => ({ line_key: l.line_key, description: l.description, resource_code: l.resource_code, wbs: l.wbs }));
}

/** Is this line key one of the project's budget lines (any revision)? The tenant-scoped check for a client-supplied key. */
export async function lineKeyBelongs(admin: SupabaseClient, tenantId: string, projectId: string, lineKey: string): Promise<boolean> {
  if (!isUuid(lineKey)) return false;
  const { data } = await admin.from("project_budget_lines").select("line_key").eq("tenant_id", tenantId).eq("project_id", projectId).eq("line_key", lineKey).limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/** Every key in `keys` that does NOT belong to the project. */
export async function foreignLineKeys(admin: SupabaseClient, tenantId: string, projectId: string, keys: readonly string[]): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const found = new Set<string>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await admin.from("project_budget_lines").select("line_key").eq("tenant_id", tenantId).eq("project_id", projectId).in("line_key", unique.slice(i, i + 100));
    for (const r of (data ?? []) as { line_key: string }[]) found.add(r.line_key);
  }
  return unique.filter((k) => !found.has(k));
}

const CATEGORY_COLS = "id, name, resource_code, cost_code, erp_category, limit_amount, active, sort_order";
const normaliseCategory = (r: Record<string, unknown>): SiteExpenseCategory => ({
  ...(r as unknown as SiteExpenseCategory), limit_amount: r.limit_amount == null ? null : Number(r.limit_amount), active: r.active !== false, sort_order: Number(r.sort_order ?? 0),
});

/** The categories of the workspace, seeded on first use with the six defaults (idempotent: the name is unique per workspace). */
export async function loadCategories(admin: SupabaseClient, tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<{ rows: SiteExpenseCategory[]; pending: boolean }> {
  const read = () => admin.from("site_expense_categories").select(CATEGORY_COLS).eq("tenant_id", tenantId).order("sort_order", { ascending: true }).order("name", { ascending: true }).limit(200);
  let { data, error } = await read();
  if (error) return { rows: [], pending: isMissingSchema(error) };
  if (((data ?? []) as unknown[]).length === 0) {
    await admin.from("site_expense_categories").upsert(
      DEFAULT_CATEGORIES.map((c, i) => ({ tenant_id: tenantId, name: c.name, resource_code: c.resource_code, erp_category: c.erp_category, sort_order: i })),
      { onConflict: "tenant_id,name", ignoreDuplicates: true },
    );
    ({ data, error } = await read());
    if (error) return { rows: [], pending: isMissingSchema(error) };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map(normaliseCategory);
  return { rows: opts.activeOnly ? rows.filter((c) => c.active) : rows, pending: false };
}

/** A category of THIS workspace, or null. */
export async function categoryOf(admin: SupabaseClient, tenantId: string, id: string): Promise<SiteExpenseCategory | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("site_expense_categories").select(CATEGORY_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? normaliseCategory(data as Record<string, unknown>) : null;
}

// ── Request body: JSON, or a form with the data and the photos ─────────────────────────────────────────────────────

export type SiteBody = { body: Record<string, unknown>; files: File[]; signature: File | null };

/**
 * A phone sends one request: the data as a JSON string in `payload` and the photos as `photos` (a receipt also sends `signature`), so a
 * queued entry is one atomic upload; a JSON body is accepted for a call without files. Never throws: a bad body is an empty one.
 */
export async function readSiteBody(request: NextRequest | Request): Promise<SiteBody> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return { body: {}, files: [], signature: null };
    let body: Record<string, unknown> = {};
    const raw = form.get("payload");
    if (typeof raw === "string") { try { const j = JSON.parse(raw); if (j && typeof j === "object" && !Array.isArray(j)) body = j as Record<string, unknown>; } catch { /* an empty body is refused by the validator */ } }
    const files = form.getAll("photos").filter((f): f is File => typeof f !== "string").slice(0, SITE_LIMITS.maxPhotos + 1);
    const sig = form.get("signature");
    return { body, files, signature: sig && typeof sig !== "string" ? sig : null };
  }
  const json = await request.json().catch(() => ({}));
  return { body: json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {}, files: [], signature: null };
}

export type StoredFile = { id: string; kind: "photo" | "signature"; path: string; mime: string; size: number };

/** Check every file by its bytes first; the answer is the problems or the checked files with their real types. */
export async function checkFiles(files: readonly File[], signature: File | null): Promise<{ ok: true; items: { file: File; bytes: Buffer; kind: "photo" | "signature" }[] } | { ok: false; error: string }> {
  if (files.length > SITE_LIMITS.maxPhotos) return { ok: false, error: `At most ${SITE_LIMITS.maxPhotos} photos` };
  const items: { file: File; bytes: Buffer; kind: "photo" | "signature" }[] = [];
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const problem = evidenceProblem({ name: f.name, size: f.size }, bytes);
    if (problem) return { ok: false, error: problem };
    items.push({ file: f, bytes, kind: "photo" });
  }
  if (signature) {
    const bytes = Buffer.from(await signature.arrayBuffer());
    const problem = evidenceProblem({ name: "The signature", size: signature.size }, bytes, { imageOnly: true });
    if (problem) return { ok: false, error: problem };
    items.push({ file: signature, bytes, kind: "signature" });
  }
  return { ok: true, items };
}

/** A short fingerprint of the first photo, so the same picture sent twice is noticed. */
export const photoHash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex").slice(0, 40);

/** Store checked files: each in the private bucket under this workspace's folder, each with a site_files row. All or nothing: a failure removes what was stored. */
export async function storeEvidence(admin: SupabaseClient, args: { tenantId: string; userId: string; objectType: "site_expense" | "site_receipt"; objectId: string; items: readonly { file: File; bytes: Buffer; kind: "photo" | "signature" }[] }): Promise<{ ok: true; stored: StoredFile[] } | { ok: false; error: string }> {
  const stored: StoredFile[] = [];
  const undo = async () => {
    if (stored.length === 0) return;
    await admin.storage.from(EVIDENCE_BUCKET).remove(stored.map((s) => s.path)).catch(() => {});
    await admin.from("site_files").delete().eq("tenant_id", args.tenantId).eq("object_id", args.objectId).in("id", stored.map((s) => s.id));
  };
  for (const it of args.items) {
    const type = sniffEvidence(it.bytes);
    if (!type) { await undo(); return { ok: false, error: "A file is not a photo or PDF" }; }
    const id = randomUUID();
    const path = evidencePath(args.tenantId, args.objectType, args.objectId, id, type.ext);
    const up = await admin.storage.from(EVIDENCE_BUCKET).upload(path, it.bytes, { contentType: type.mime, upsert: false });
    if (up.error) { await undo(); return { ok: false, error: "A photo could not be saved. Try again" }; }
    const row = { id, tenant_id: args.tenantId, object_type: args.objectType, object_id: args.objectId, kind: it.kind, storage_path: path, mime_type: type.mime, size_bytes: it.bytes.length, created_by: args.userId };
    stored.push({ id, kind: it.kind, path, mime: type.mime, size: it.bytes.length });
    const ins = await admin.from("site_files").insert(row);
    if (ins.error) { await undo(); return { ok: false, error: "A photo could not be recorded. Try again" }; }
  }
  return { ok: true, stored };
}

/** A 60-second link to one stored file of THIS workspace, or null. The caller has already decided the person may see the record. */
export async function signedEvidenceLink(admin: SupabaseClient, tenantId: string, fileId: string): Promise<{ url: string; mime: string | null; objectType: string; objectId: string } | null> {
  if (!isUuid(fileId)) return null;
  const { data } = await admin.from("site_files").select("storage_path, mime_type, object_type, object_id").eq("id", fileId).eq("tenant_id", tenantId).maybeSingle();
  const f = data as { storage_path: string; mime_type: string | null; object_type: string; object_id: string } | null;
  if (!f || !pathBelongsTo(tenantId, f.storage_path)) return null;
  const { data: signed, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrl(f.storage_path, 60);
  return error || !signed ? null : { url: signed.signedUrl, mime: f.mime_type, objectType: f.object_type, objectId: f.object_id };
}

export async function loadFiles(admin: SupabaseClient, tenantId: string, objectType: "site_expense" | "site_receipt", objectId: string): Promise<{ id: string; kind: string; mime_type: string | null; size_bytes: number | null; created_at: string }[]> {
  const { data, error } = await admin.from("site_files").select("id, kind, mime_type, size_bytes, created_at").eq("tenant_id", tenantId).eq("object_type", objectType).eq("object_id", objectId).order("created_at", { ascending: true }).limit(40);
  return error ? [] : ((data ?? []) as { id: string; kind: string; mime_type: string | null; size_bytes: number | null; created_at: string }[]);
}

// ── Who decides, and telling them ──────────────────────────────────────────────────────────────────────────────────

export type Deciders = { costApprovers: string[]; allowSelfApproval: boolean };

/** Settings > Tenders approvers (workspace admins by default) and the self-approval switch. */
export async function loadDeciders(admin: SupabaseClient, tenantId: string, config: TenantConfig | null): Promise<Deciders> {
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, config);
  return { costApprovers: approvers, allowSelfApproval };
}

/**
 * E-mail through resolveOutbound plus a Nova inbox entry (a system comment on the project that mentions each person), both best effort:
 * a notification that fails never fails the thing that caused it. The people are workspace members only.
 */
export async function notifyPeople(req: Pick<SiteCtx, "admin" | "tenantId" | "userId">, args: { projectId: string; projectLabel: string; recipients: readonly string[]; subject: string; text: string; comment: string; actorEmail: string | null }): Promise<void> {
  try {
    const ids = [...new Set(args.recipients.filter((id) => id && id !== req.userId))];
    if (ids.length === 0) return;
    const tenant = await loadNotifyTenant(req.admin, req.tenantId);
    if (!tenant) return;
    const to = await memberEmails(req.admin, req.tenantId, ids);
    if (to.length === 0) return;
    await projectInboxNote(req.admin, { tenantId: req.tenantId, projectId: args.projectId, authorId: req.userId, authorEmail: args.actorEmail, body: args.comment, mentionEmails: to.map((t) => t.email) });
    await sendProjectMail(req.admin, tenant, { to: to.map((t) => t.email), subject: args.subject, text: `${args.text}\n\nOpen the project: ${projectLink(tenant, args.projectId)}`, projectId: args.projectId, projectLabel: args.projectLabel, actorId: req.userId, actorEmail: args.actorEmail });
  } catch (e) {
    console.error("[site] notification failed", (e as Error).message);
  }
}

export { loadActorNames };
