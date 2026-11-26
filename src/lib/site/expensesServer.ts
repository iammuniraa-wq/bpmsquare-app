import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { personLabel } from "@/lib/personName";
import { cfOnly } from "@/lib/customData";
import {
  EXPENSE_APPROVER_FIELDS, EXPENSE_RESUBMIT_FIELDS, canCancelExpense, canDecideExpense, cleanExpenseInput, expenseFlags, findDuplicate, projectAmount, reasonProblem, round2,
  type DuplicateCandidate,
} from "./expenseRules";
import { SITE_LIMITS, isUuid, type ExpenseFlag, type SiteExpense } from "./types";
import {
  anyProject, categoryOf, checkFiles, lineKeyBelongs, loadActorNames, loadDeciders, loadFiles, needsUpdate, notifyPeople, photoHash, projectForSite, readSiteBody, storeEvidence,
  isMissingSchema, type SiteCtx, type SiteProject,
} from "./server";

// The site expense, server side: create (idempotent on the phone's client id), the list a person may see, approve / return / cancel, and
// what an approved expense adds to its budget line. Every query is tenant-scoped on the admin client; the table has a SELECT-only policy, so
// no write can come from anywhere else (MULTI_TENANT_GUARDRAILS.md). Rules live in expenseRules.ts and are shared with the screens.

export const EXPENSE_COLS = "id, ref, project_id, client_id, status, category_id, line_key, wbs_code, expense_date, amount, currency, amount_project_ccy, vat_amount, vendor_text, supplier_id, document_state, invoice_ref, paid_by, note, flags, photo_hash, submitted_by, submitted_at, approved_by, approved_at, reject_reason, cancel_reason, ai_read, source_type, source_id, erp_ref, erp_state, sent_at, posted_amount, posted_at, custom_data, created_at, updated_at";

export type Result<T = Record<string, unknown>> = { status: number; body: T | { error: string; [k: string]: unknown } };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { error, ...extra } });

export function normaliseExpense(r: Record<string, unknown>): SiteExpense {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...(r as unknown as SiteExpense),
    amount: Number(r.amount ?? 0), amount_project_ccy: n(r.amount_project_ccy), vat_amount: n(r.vat_amount), posted_amount: n(r.posted_amount),
    flags: Array.isArray(r.flags) ? (r.flags as ExpenseFlag[]) : [],
    erp_state: (r.erp_state as SiteExpense["erp_state"]) ?? "not_sent",
  };
}

const today = (): string => new Date().toISOString().slice(0, 10);

// ── Who may see what ───────────────────────────────────────────────────────────────────────────────────────────────

export type ViewerScope = { userId: string; isCost: boolean; isAdmin: boolean; managed: Set<string>; allowSelfApproval: boolean; costApprovers: string[] };

/** What this person may reach: everything when they are a cost approver or admin, their own and their projects' expenses otherwise. */
export async function loadViewerScope(req: SiteCtx): Promise<ViewerScope> {
  const d = await loadDeciders(req.admin, req.tenantId, req.tenantConfig);
  const isAdmin = req.role === "admin";
  const isCost = isAdmin || d.costApprovers.includes(req.userId);
  const managed = new Set<string>();
  if (!isCost) {
    const { data } = await req.admin.from("contract_projects").select("id").eq("tenant_id", req.tenantId).eq("manager_id", req.userId).limit(1000);
    for (const r of (data ?? []) as { id: string }[]) managed.add(r.id);
  }
  return { userId: req.userId, isCost, isAdmin, managed, allowSelfApproval: d.allowSelfApproval, costApprovers: d.costApprovers };
}

export const canSeeExpense = (v: ViewerScope, e: Pick<SiteExpense, "submitted_by" | "project_id">): boolean => v.isCost || e.submitted_by === v.userId || v.managed.has(e.project_id);
/** Budget figures belong to the people who manage the money: a cost approver, an admin or the project manager. A site person never sees them. */
export const seesBudget = (v: ViewerScope, projectId: string): boolean => v.isCost || v.managed.has(projectId);
export const isDeciderOn = (v: ViewerScope, projectId: string): boolean => v.isCost || v.managed.has(projectId);

export async function loadExpense(admin: SupabaseClient, tenantId: string, id: string): Promise<SiteExpense | null | "pending"> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("site_expenses").select(EXPENSE_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return isMissingSchema(error) ? "pending" : null;
  return data ? normaliseExpense(data as Record<string, unknown>) : null;
}

// ── Create ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/site-expenses. One request holds the data and the photos, so a queued capture is one atomic upload. Idempotent on `client_id`:
 * the same capture sent twice answers the first row, never a second. The project, the category and the line are verified against THIS
 * workspace; status, tenant, submitter and the money state are never read from the body.
 */
export async function createExpense(req: SiteCtx, request: Request): Promise<Result> {
  const { body, files, signature } = await readSiteBody(request);
  const clientId = body.client_id;
  if (isUuid(clientId)) {
    const { data: prior, error } = await req.admin.from("site_expenses").select(EXPENSE_COLS).eq("tenant_id", req.tenantId).eq("client_id", clientId).maybeSingle();
    if (error && isMissingSchema(error)) return fail(503, needsUpdate("site_expenses").error, needsUpdate("site_expenses").extra);
    if (prior) {
      return (prior as { submitted_by: string }).submitted_by === req.userId
        ? { status: 200, body: { expense: normaliseExpense(prior as Record<string, unknown>), duplicate_request: true } }
        : fail(409, "That capture id is already used");
    }
  }
  const project = typeof body.project_id === "string" ? await projectForSite(req.admin, req.tenantId, body.project_id) : null;
  if (!project) return fail(422, "Choose an active project that takes site entries");
  const cleaned = cleanExpenseInput(body, { today: today(), projectCurrency: project.currency ?? "SAR" });
  if (!cleaned.ok) return fail(422, cleaned.error);
  const v = cleaned.value;
  if (!v.category_id) return fail(422, "Choose a category");
  const category = await categoryOf(req.admin, req.tenantId, v.category_id);
  if (!category || !category.active) return fail(422, "That category is not available");
  if (v.line_key && !(await lineKeyBelongs(req.admin, req.tenantId, project.id, v.line_key))) return fail(422, "That cost line is not on this project");
  const checked = await checkFiles(files, signature);
  if (!checked.ok) return fail(422, checked.error);
  const photos = checked.items.filter((i) => i.kind === "photo");
  if (v.document_state === "receipt_attached" && photos.length === 0) return fail(422, "Take a photo of the receipt, or choose Invoice to follow");

  const inProject = projectAmount({ amount: v.amount, currency: v.currency, amount_project_ccy: v.amount_project_ccy }, project.currency);
  const hash = photos[0] ? photoHash(photos[0].bytes) : null;
  const flags = await computeFlags(req, { projectId: project.id, v, inProject, categoryLimit: category.limit_amount, hash });

  const user = await getAuthUser();
  const row = {
    tenant_id: req.tenantId, project_id: project.id, client_id: v.client_id, status: "submitted", category_id: v.category_id, line_key: v.line_key, wbs_code: v.wbs_code,
    expense_date: v.expense_date, amount: v.amount, currency: v.currency, amount_project_ccy: inProject, vat_amount: v.vat_amount, vendor_text: v.vendor_text,
    document_state: v.document_state, invoice_ref: v.invoice_ref, paid_by: v.paid_by, note: v.note, flags, photo_hash: hash, submitted_by: req.userId, submitted_at: new Date().toISOString(),
    ai_read: v.ai_read, source_type: v.source_type ?? (v.ai_read ? "photo" : "manual"), source_id: v.source_id, erp_state: "not_sent",
  };
  const made = await insertWithMasterRef<Record<string, unknown>>(req.admin, "site_expenses", req.tenantId, row, EXPENSE_COLS);
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return fail(503, needsUpdate("site_expenses").error, needsUpdate("site_expenses").extra);
    if (made.error?.code === "23505") {
      // Two sends of the same capture at once: the second finds the first.
      const { data: again } = await req.admin.from("site_expenses").select(EXPENSE_COLS).eq("tenant_id", req.tenantId).eq("client_id", v.client_id).maybeSingle();
      if (again && (again as { submitted_by: string }).submitted_by === req.userId) return { status: 200, body: { expense: normaliseExpense(again as Record<string, unknown>), duplicate_request: true } };
    }
    return fail(500, made.error?.message ?? "Could not save the expense");
  }
  const expense = normaliseExpense(made.data);
  const stored = await storeEvidence(req.admin, { tenantId: req.tenantId, userId: req.userId, objectType: "site_expense", objectId: expense.id, items: checked.items });
  if (!stored.ok) {
    await req.admin.from("site_expenses").delete().eq("id", expense.id).eq("tenant_id", req.tenantId);
    return fail(500, stored.error);
  }

  await logChange(req.supabase, {
    tenantId: req.tenantId, objectType: "site_expenses", objectId: expense.id, objectLabel: `${expense.ref ?? ""} ${v.vendor_text ?? category.name}`.trim(), action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("site_expenses", {}, { project: `${project.ref ?? ""} ${project.name}`.trim(), category: category.name, amount: `${v.currency} ${v.amount}`, expense_date: v.expense_date, vendor: v.vendor_text, flags: flags.length ? flags.join(", ") : null, photos: stored.stored.length }),
  });
  await tellApprovers(req, project, expense, category.name, user?.email ?? null);
  return { status: 201, body: { expense } };
}

async function computeFlags(req: SiteCtx, a: { projectId: string; v: { amount: number; currency: string; vendor_text: string | null; expense_date: string; line_key: string | null }; inProject: number | null; categoryLimit: number | null; hash: string | null }): Promise<ExpenseFlag[]> {
  const since = new Date(new Date(`${a.v.expense_date}T00:00:00Z`).getTime() - SITE_LIMITS.dupWindowDays * 86_400_000).toISOString().slice(0, 10);
  const { data } = await req.admin.from("site_expenses").select("id, project_id, amount, currency, vendor_text, expense_date, status, photo_hash")
    .eq("tenant_id", req.tenantId).eq("project_id", a.projectId).gte("expense_date", since).order("expense_date", { ascending: false }).limit(500);
  const existing = ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as DuplicateCandidate), amount: Number(r.amount) }));
  let duplicate = findDuplicate({ project_id: a.projectId, amount: a.v.amount, currency: a.v.currency, vendor_text: a.v.vendor_text, expense_date: a.v.expense_date, status: "submitted", photo_hash: a.hash }, existing) !== null;
  if (!duplicate && a.hash) {
    const { data: same } = await req.admin.from("site_expenses").select("id").eq("tenant_id", req.tenantId).eq("photo_hash", a.hash).limit(1);
    duplicate = ((same ?? []) as unknown[]).length > 0;
  }
  const monthStart = `${a.v.expense_date.slice(0, 8)}01`;
  const { data: mine } = await req.admin.from("site_expenses").select("amount, currency, amount_project_ccy, status")
    .eq("tenant_id", req.tenantId).eq("submitted_by", req.userId).gte("expense_date", monthStart).limit(2000);
  const monthSoFar = ((mine ?? []) as { amount: number; amount_project_ccy: number | null; status: string }[])
    .filter((m) => m.status === "submitted" || m.status === "approved").reduce((s, m) => s + Number(m.amount_project_ccy ?? m.amount), 0);
  return expenseFlags({ amountInProject: a.inProject, categoryLimit: a.categoryLimit, config: req.config, monthSoFar, hasLine: !!a.v.line_key, duplicate });
}

async function tellApprovers(req: SiteCtx, project: SiteProject, e: SiteExpense, category: string, actorEmail: string | null): Promise<void> {
  const d = await loadDeciders(req.admin, req.tenantId, req.tenantConfig);
  const overLimit = e.flags.includes("over_limit");
  const people = overLimit || !project.manager_id || project.manager_id === req.userId ? d.costApprovers : [project.manager_id];
  const names = await loadActorNames(req.admin, req.tenantId, [req.userId]);
  const who = personLabel(names.get(req.userId), actorEmail ? { email: actorEmail } : null, "A colleague");
  const what = `${e.ref ?? "An expense"}: ${e.currency} ${e.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${category.toLowerCase()}${e.vendor_text ? `, ${e.vendor_text}` : ""}`;
  await notifyPeople(req, {
    projectId: project.id, projectLabel: `${project.ref ?? ""} ${project.name}`.trim(), recipients: people,
    subject: `Expense waiting: ${what}`.slice(0, 200),
    text: `${who} submitted an expense on "${project.name}".\n${what}${e.flags.length ? `\nFlags: ${e.flags.join(", ")}` : ""}\nApprove or return it on the project's Expenses tab.`,
    comment: `Expense waiting for you: ${what}`.slice(0, 600), actorEmail,
  });
}

// ── Decide, return, cancel, resubmit ───────────────────────────────────────────────────────────────────────────────

type Loaded = { expense: SiteExpense; project: SiteProject; scope: ViewerScope };
async function loadForAction(req: SiteCtx, id: string): Promise<Loaded | Result> {
  const e = await loadExpense(req.admin, req.tenantId, id);
  if (e === "pending") return fail(503, needsUpdate("site_expenses").error, needsUpdate("site_expenses").extra);
  if (!e) return fail(404, "Not found");
  const scope = await loadViewerScope(req);
  if (!canSeeExpense(scope, e)) return fail(404, "Not found");
  const project = await anyProject(req.admin, req.tenantId, e.project_id);
  if (!project) return fail(404, "Not found");
  return { expense: e, project, scope };
}
const isResult = (x: Loaded | Result): x is Result => "status" in x && "body" in x;

const label = (e: SiteExpense) => `${e.ref ?? ""} ${e.vendor_text ?? ""}`.trim();

export async function approveExpense(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const l = await loadForAction(req, id);
  if (isResult(l)) return l;
  const { expense: e, project, scope } = l;
  if (e.status !== "submitted") return fail(409, e.status === "approved" ? "It is already approved" : "Only a waiting expense can be approved");
  // What the approver may set while deciding: a "Not sure" line, the category, the project-currency amount of a foreign expense, the WBS.
  const set: Record<string, unknown> = {};
  for (const k of EXPENSE_APPROVER_FIELDS) if (k in body) set[k] = body[k];
  const categoryId = typeof set.category_id === "string" ? set.category_id : e.category_id;
  const category = categoryId ? await categoryOf(req.admin, req.tenantId, categoryId) : null;
  if (typeof set.category_id === "string" && !category) return fail(422, "That category is not available");
  const lineKey = "line_key" in set ? (isUuid(set.line_key) ? (set.line_key as string) : null) : e.line_key;
  if ("line_key" in set && set.line_key && !(await lineKeyBelongs(req.admin, req.tenantId, e.project_id, set.line_key as string))) return fail(422, "That cost line is not on this project");
  let inProject = e.amount_project_ccy;
  if ("amount_project_ccy" in set) {
    const n = typeof set.amount_project_ccy === "number" ? set.amount_project_ccy : Number(set.amount_project_ccy);
    if (!Number.isFinite(n) || n <= 0 || n > SITE_LIMITS.maxAmount) return fail(422, "The amount in the project currency is not valid");
    inProject = round2(n);
  }
  if (inProject === null && e.currency !== (project.currency ?? e.currency)) return fail(422, `Enter the amount in ${project.currency ?? "the project currency"} before approving`);
  inProject = inProject ?? e.amount;
  const decision = canDecideExpense({
    actorId: req.userId, actorIsAdmin: scope.isAdmin, submitterId: e.submitted_by, managerId: project.manager_id, costApprovers: scope.costApprovers, allowSelfApproval: scope.allowSelfApproval,
    amountInProject: inProject, categoryLimit: category?.limit_amount ?? null, config: req.config,
  });
  if (!decision.ok) return fail(decision.status, decision.error);
  const flags = e.flags.filter((f) => f !== "no_line" || !lineKey);
  const upd = await req.admin.from("site_expenses").update({
    status: "approved", approved_by: req.userId, approved_at: new Date().toISOString(), category_id: categoryId, line_key: lineKey, wbs_code: "wbs_code" in set ? (typeof set.wbs_code === "string" && set.wbs_code.trim() ? set.wbs_code.trim().slice(0, 50) : null) : e.wbs_code,
    amount_project_ccy: inProject, flags, updated_at: new Date().toISOString(),
  }).eq("id", e.id).eq("tenant_id", req.tenantId).eq("status", "submitted").select(EXPENSE_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const done = ((upd.data ?? []) as Record<string, unknown>[])[0];
  if (!done) return fail(409, "Someone else decided it first. Reload");
  const user = await getAuthUser();
  await logChange(req.supabase, {
    tenantId: req.tenantId, objectType: "site_expenses", objectId: e.id, objectLabel: label(e), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Approved", from: "Waiting", to: `${project.currency ?? e.currency} ${inProject}${lineKey && lineKey !== e.line_key ? ", cost line set" : ""}` }],
  });
  await tellSubmitter(req, project, e, `Approved: ${label(e)}`, `Your expense ${e.ref ?? ""} was approved and now counts as recorded cost.`, user?.email ?? null);
  return { status: 200, body: { expense: normaliseExpense(done) } };
}

export async function returnExpense(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const l = await loadForAction(req, id);
  if (isResult(l)) return l;
  const { expense: e, project, scope } = l;
  if (e.status !== "submitted") return fail(409, "Only a waiting expense can be returned");
  const problem = reasonProblem(body.reason);
  if (problem) return fail(422, problem);
  const category = e.category_id ? await categoryOf(req.admin, req.tenantId, e.category_id) : null;
  const decision = canDecideExpense({
    actorId: req.userId, actorIsAdmin: scope.isAdmin, submitterId: e.submitted_by, managerId: project.manager_id, costApprovers: scope.costApprovers, allowSelfApproval: scope.allowSelfApproval,
    amountInProject: null, categoryLimit: category?.limit_amount ?? null, config: req.config,
  });
  if (!decision.ok) return fail(decision.status, decision.error);
  const reason = String(body.reason).trim().slice(0, 1000);
  const upd = await req.admin.from("site_expenses").update({ status: "rejected", reject_reason: reason, approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
    .eq("id", e.id).eq("tenant_id", req.tenantId).eq("status", "submitted").select(EXPENSE_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const done = ((upd.data ?? []) as Record<string, unknown>[])[0];
  if (!done) return fail(409, "Someone else decided it first. Reload");
  const user = await getAuthUser();
  await logChange(req.supabase, { tenantId: req.tenantId, objectType: "site_expenses", objectId: e.id, objectLabel: label(e), action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Returned", from: "Waiting", to: reason }] });
  await tellSubmitter(req, project, e, `Returned: ${label(e)}`, `Your expense ${e.ref ?? ""} was returned: ${reason}`, user?.email ?? null);
  return { status: 200, body: { expense: normaliseExpense(done) } };
}

export async function cancelExpense(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const l = await loadForAction(req, id);
  if (isResult(l)) return l;
  const { expense: e, scope } = l;
  const decider = isDeciderOn(scope, e.project_id);
  const may = canCancelExpense({ status: e.status, erpState: e.erp_state, actorId: req.userId, submitterId: e.submitted_by, isDecider: decider });
  if (!may.ok) return fail(409, may.error);
  const byDecider = decider && e.submitted_by !== req.userId;
  if (byDecider || typeof body.reason === "string") {
    const problem = reasonProblem(body.reason);
    if (problem && byDecider) return fail(422, problem);
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;
  const upd = await req.admin.from("site_expenses").update({ status: "cancelled", cancel_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", e.id).eq("tenant_id", req.tenantId).eq("status", e.status).select(EXPENSE_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const done = ((upd.data ?? []) as Record<string, unknown>[])[0];
  if (!done) return fail(409, "It changed while you were cancelling. Reload");
  const user = await getAuthUser();
  await logChange(req.supabase, { tenantId: req.tenantId, objectType: "site_expenses", objectId: e.id, objectLabel: label(e), action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Cancelled", from: e.status, to: reason ?? "cancelled" }] });
  return { status: 200, body: { expense: normaliseExpense(done) } };
}

/**
 * PATCH: the submitter corrects an expense that was returned and sends it again (the money fields, never the project or the money state); a
 * decider or the submitter may set custom fields (cf_ keys only) at any time. Anything else in the body is ignored, so a status, a
 * tenant or an ERP field can never be written through here.
 */
export async function patchExpense(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const l = await loadForAction(req, id);
  if (isResult(l)) return l;
  const { expense: e, project, scope } = l;
  const patch: Record<string, unknown> = {};
  const mine = e.submitted_by === req.userId;
  if ("custom_data" in body) {
    if (!mine && !isDeciderOn(scope, e.project_id)) return fail(403, "You cannot change this expense");
    patch.custom_data = { ...(e.custom_data ?? {}), ...(cfOnly(body.custom_data) ?? {}) };
  }
  const wantsEdit = EXPENSE_RESUBMIT_FIELDS.some((k) => k in body);
  if (wantsEdit) {
    if (!mine) return fail(403, "Only the person who entered it can change it");
    if (e.status !== "rejected") return fail(409, "Only a returned expense can be changed. Cancel it and enter it again");
    const merged = { ...e, ...Object.fromEntries(EXPENSE_RESUBMIT_FIELDS.filter((k) => k in body).map((k) => [k, body[k]])), client_id: e.client_id, project_id: e.project_id };
    const cleaned = cleanExpenseInput(merged as unknown as Record<string, unknown>, { today: today(), projectCurrency: project.currency ?? "SAR" });
    if (!cleaned.ok) return fail(422, cleaned.error);
    const v = cleaned.value;
    if (!v.category_id || !(await categoryOf(req.admin, req.tenantId, v.category_id))) return fail(422, "Choose a category");
    if (v.line_key && !(await lineKeyBelongs(req.admin, req.tenantId, e.project_id, v.line_key))) return fail(422, "That cost line is not on this project");
    const inProject = projectAmount({ amount: v.amount, currency: v.currency, amount_project_ccy: v.amount_project_ccy }, project.currency);
    const category = await categoryOf(req.admin, req.tenantId, v.category_id);
    const flags = await computeFlags(req, { projectId: e.project_id, v, inProject, categoryLimit: category?.limit_amount ?? null, hash: e.photo_hash ?? null });
    Object.assign(patch, {
      category_id: v.category_id, line_key: v.line_key, wbs_code: v.wbs_code, expense_date: v.expense_date, amount: v.amount, currency: v.currency, amount_project_ccy: inProject, vat_amount: v.vat_amount,
      vendor_text: v.vendor_text, document_state: v.document_state, invoice_ref: v.invoice_ref, paid_by: v.paid_by, note: v.note, flags, status: "submitted", reject_reason: null,
    });
  }
  if (Object.keys(patch).length === 0) return fail(400, "Nothing to change");
  const upd = await req.admin.from("site_expenses").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", e.id).eq("tenant_id", req.tenantId).eq("status", e.status).select(EXPENSE_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const done = ((upd.data ?? []) as Record<string, unknown>[])[0];
  if (!done) return fail(409, "It changed meanwhile. Reload");
  const user = await getAuthUser();
  const changes = diffForLog("site_expenses", e as unknown as Record<string, unknown>, patch);
  if (changes.length > 0) await logChange(req.supabase, { tenantId: req.tenantId, objectType: "site_expenses", objectId: e.id, objectLabel: label(e), action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  if (patch.status === "submitted") await tellApprovers(req, project, normaliseExpense(done), "", user?.email ?? null);
  return { status: 200, body: { expense: normaliseExpense(done) } };
}

async function tellSubmitter(req: SiteCtx, project: SiteProject, e: SiteExpense, subject: string, text: string, actorEmail: string | null): Promise<void> {
  await notifyPeople(req, { projectId: project.id, projectLabel: `${project.ref ?? ""} ${project.name}`.trim(), recipients: [e.submitted_by], subject: subject.slice(0, 200), text, comment: text.slice(0, 600), actorEmail });
}

// ── The list a person may see ──────────────────────────────────────────────────────────────────────────────────────

export type ExpenseListRow = SiteExpense & { project_ref: string | null; project_name: string; project_currency: string | null; category_name: string | null; submitted_by_name: string | null; line_label: string | null };

export type ListFilter = { projectId?: string | null; status?: string | null; mine?: boolean; limit?: number };

export async function listExpenses(req: SiteCtx, scope: ViewerScope, f: ListFilter = {}): Promise<{ rows: ExpenseListRow[]; pending: boolean }> {
  const base = () => {
    let q = req.admin.from("site_expenses").select(EXPENSE_COLS).eq("tenant_id", req.tenantId);
    if (f.projectId && isUuid(f.projectId)) q = q.eq("project_id", f.projectId);
    if (f.status && ["submitted", "approved", "rejected", "cancelled"].includes(f.status)) q = q.eq("status", f.status);
    return q;
  };
  const cap = Math.min(f.limit ?? 300, 1000);
  // A cost approver reaches everything; anyone else reaches their own expenses and those of the projects they manage (two reads, merged).
  const reads = scope.isCost
    ? [f.mine ? base().eq("submitted_by", req.userId) : base()]
    : [base().eq("submitted_by", req.userId), ...(!f.mine && scope.managed.size > 0 ? [base().in("project_id", [...scope.managed])] : [])];
  const seen = new Map<string, SiteExpense>();
  for (const q of reads) {
    const { data, error } = await q.order("submitted_at", { ascending: false }).limit(cap);
    if (error) return { rows: [], pending: isMissingSchema(error) };
    for (const r of (data ?? []) as Record<string, unknown>[]) seen.set(String(r.id), normaliseExpense(r));
  }
  const all = [...seen.values()].filter((e) => canSeeExpense(scope, e)).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)).slice(0, cap);
  return { rows: await decorate(req, all), pending: false };
}

export async function decorate(req: Pick<SiteCtx, "admin" | "tenantId">, list: readonly SiteExpense[]): Promise<ExpenseListRow[]> {
  const projectIds = [...new Set(list.map((e) => e.project_id))];
  const catIds = [...new Set(list.map((e) => e.category_id).filter((x): x is string => !!x))];
  const [projects, cats, names] = await Promise.all([
    projectIds.length ? req.admin.from("contract_projects").select("id, ref, name, currency").eq("tenant_id", req.tenantId).in("id", projectIds) : Promise.resolve({ data: [] }),
    catIds.length ? req.admin.from("site_expense_categories").select("id, name").eq("tenant_id", req.tenantId).in("id", catIds) : Promise.resolve({ data: [] }),
    loadActorNames(req.admin, req.tenantId, list.map((e) => e.submitted_by)),
  ]);
  const pm = new Map(((projects.data ?? []) as { id: string; ref: string | null; name: string; currency: string | null }[]).map((p) => [p.id, p]));
  const cm = new Map(((cats.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  return list.map((e) => ({
    ...e, project_ref: pm.get(e.project_id)?.ref ?? null, project_name: pm.get(e.project_id)?.name ?? "Project", project_currency: pm.get(e.project_id)?.currency ?? null,
    category_name: e.category_id ? cm.get(e.category_id) ?? null : null, submitted_by_name: names.get(e.submitted_by) ?? null, line_label: null,
  }));
}

export { loadFiles };
