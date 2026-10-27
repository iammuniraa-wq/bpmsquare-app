import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { einvoicingOn } from "@/lib/einvoicing/gate";
import { accountInTenant } from "@/lib/tender/server";
import { isMissingSchema, UUID_RE, type Failure, type ProjectCtx } from "./server";
import type { ProjectRow } from "./types";
import { money } from "./format";
import { resolveMilestoneTax, taxNote, type MilestoneTax } from "./milestoneTax";
import {
  INVOICE_MILESTONE_KEY, INVOICE_PROJECT_KEY, MILESTONE_LIMITS, amountEditable, effectiveStatus, invoiceBody, invoiceProblem, isRemovable, milestoneAmount, milestoneTotals,
  statusChangeProblem, type MilestoneInput, type MilestoneRow, type MilestoneStatus, type MilestoneTotals,
} from "./milestones";

// Server side of the invoicing milestones (migration 0232). Every query is tenant-scoped on the admin client and every one tolerates the
// migration being pending. An invoice is made through the existing invoices route (refs, VAT categories for e-invoicing, change history),
// never by a second implementation of it.

export const AFTER_AWARD_BUNDLE = "scripts/run-bundle-41-after-award-2026-10-27.sql";
export const needsMilestoneUpdate = (): Failure => ({
  status: 503, error: "Invoicing needs a database update (migration 0232). Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: AFTER_AWARD_BUNDLE },
});

const COLS = "id, project_id, title, due_date, basis, percent, fixed_amount, status, invoice_id, sort_order, note, created_by, created_at, updated_at";

export const normaliseMilestone = (r: Record<string, unknown>): MilestoneRow => ({
  ...(r as unknown as MilestoneRow), percent: r.percent == null ? null : Number(r.percent), fixed_amount: r.fixed_amount == null ? null : Number(r.fixed_amount), sort_order: Number(r.sort_order ?? 0),
});

export type MilestoneView = MilestoneRow & {
  /** What it bills now, from the revised contract value. */
  amount: number;
  /** The status as it reads now (a paid invoice makes it paid; a cancelled one makes it ready again). */
  display_status: MilestoneStatus;
  invoice_ref: string | null;
  invoice_status: string | null;
};

export type MilestonesData = {
  milestones: MilestoneView[];
  totals: MilestoneTotals;
  currency: string | null;
  pending: boolean;
  canEdit: boolean;
  /** The invoices module is on for this workspace (otherwise "Create invoice" is not offered). */
  invoicesOn: boolean;
  hasCustomer: boolean;
  /** Which tax comes on top of a milestone amount (the amounts shown are before it). */
  tax: MilestoneTax;
};

export async function loadMilestones(admin: SupabaseClient, tenantId: string, projectId: string): Promise<{ rows: MilestoneRow[]; pending: boolean }> {
  const { data, error } = await admin.from("contract_project_milestones").select(COLS).eq("tenant_id", tenantId).eq("project_id", projectId)
    .order("sort_order", { ascending: true }).order("created_at", { ascending: true }).limit(MILESTONE_LIMITS.maxPerProject);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normaliseMilestone), pending: false };
}

export async function loadMilestone(admin: SupabaseClient, tenantId: string, projectId: string, id: string): Promise<MilestoneRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await admin.from("contract_project_milestones").select(COLS).eq("id", id).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
  return error || !data ? null : normaliseMilestone(data as Record<string, unknown>);
}

async function invoicesOf(admin: SupabaseClient, tenantId: string, ids: readonly (string | null)[]): Promise<Map<string, { ref: string | null; status: string | null }>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { ref: string | null; status: string | null }>();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data } = await admin.from("invoices").select("id, ref, status").eq("tenant_id", tenantId).in("id", wanted.slice(i, i + 100));
    for (const r of (data ?? []) as { id: string; ref: string | null; status: string | null }[]) out.set(r.id, { ref: r.ref, status: r.status });
  }
  return out;
}

/** The tax that comes on top of an invoice amount in this workspace: the same sources the invoices object uses (e-invoice VAT, else the workspace tax setting). */
export async function workspaceMilestoneTax(): Promise<MilestoneTax> {
  const tenant = await getTenant();
  return resolveMilestoneTax({ einvoicing: einvoicingOn(tenant?.features, tenant?.config), tax: tenant?.config?.tax });
}

export async function buildMilestonesData(req: ProjectCtx, project: ProjectRow): Promise<MilestonesData> {
  const { admin, supabase, tenantId } = req;
  const invoicesOn = await tenantHasFeature(supabase, tenantId, "invoices");
  const { rows, pending } = await loadMilestones(admin, tenantId, project.id);
  const base = { currency: project.currency, canEdit: req.canEdit, invoicesOn, hasCustomer: !!project.account_id, tax: await workspaceMilestoneTax() };
  if (pending) return { milestones: [], totals: milestoneTotals([], project.contract_value), pending: true, ...base };
  const inv = await invoicesOf(admin, tenantId, rows.map((r) => r.invoice_id));
  const withInvoice = rows.map((r) => ({ ...r, invoice_status: r.invoice_id ? inv.get(r.invoice_id)?.status ?? null : null }));
  return {
    milestones: withInvoice.map((r) => ({
      ...r, amount: milestoneAmount(r, project.contract_value), display_status: effectiveStatus(r, r.invoice_status),
      invoice_ref: r.invoice_id ? inv.get(r.invoice_id)?.ref ?? null : null,
    })),
    totals: milestoneTotals(withInvoice, project.contract_value), pending: false, ...base,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
const labelOf = (p: ProjectRow) => `${p.ref ?? ""} ${p.name}`.trim();

async function logMilestone(req: ProjectCtx, project: ProjectRow, changes: { field: string; from: unknown; to: unknown }[]) {
  const user = await getAuthUser();
  await logChange(req.supabase, { tenantId: req.tenantId, objectType: "contract_projects", objectId: project.id, objectLabel: labelOf(project), action: "update", actorId: user?.id, actorEmail: user?.email, changes });
}

export async function createMilestone(req: ProjectCtx, project: ProjectRow, input: Partial<MilestoneInput>): Promise<Result<{ milestone: MilestoneRow }>> {
  const { admin, tenantId, userId } = req;
  if (project.status === "closed") return { ok: false, status: 409, error: "This project is closed" };
  const existing = await loadMilestones(admin, tenantId, project.id);
  if (existing.pending) return { ok: false, ...needsMilestoneUpdate() };
  if (existing.rows.length >= MILESTONE_LIMITS.maxPerProject) return { ok: false, status: 409, error: `A project holds up to ${MILESTONE_LIMITS.maxPerProject} milestones` };
  const sort = existing.rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 10;
  const made = await admin.from("contract_project_milestones").insert({
    tenant_id: tenantId, project_id: project.id, title: input.title, due_date: input.due_date ?? null, basis: input.basis ?? "percent", percent: input.percent ?? null,
    fixed_amount: input.fixed_amount ?? null, status: "planned", invoice_id: null, sort_order: sort, note: input.note ?? null, created_by: userId,
  }).select(COLS).single();
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return { ok: false, ...needsMilestoneUpdate() };
    return { ok: false, status: 500, error: made.error?.message ?? "Could not save the milestone" };
  }
  const milestone = normaliseMilestone(made.data as Record<string, unknown>);
  await logMilestone(req, project, [{ field: "Invoicing milestone added", from: null, to: `${milestone.title}, ${milestone.basis === "percent" ? `${milestone.percent}%` : milestone.fixed_amount}` }]);
  return { ok: true, milestone };
}

/** An edit. The amount can change only until an invoice exists; a status change is only the allowed hand-made ones (planned, ready, paid). */
export async function editMilestone(req: ProjectCtx, project: ProjectRow, current: MilestoneRow, input: Partial<MilestoneInput> & { status?: MilestoneStatus }): Promise<Result<{ milestone: MilestoneRow }>> {
  const { admin, tenantId } = req;
  const touchesAmount = "basis" in input || "percent" in input || "fixed_amount" in input;
  if (touchesAmount && !amountEditable(current.status)) return { ok: false, status: 409, error: "The amount cannot change once an invoice has been made" };
  const merged = { basis: input.basis ?? current.basis, percent: "percent" in input ? input.percent ?? null : current.percent, fixed_amount: "fixed_amount" in input ? input.fixed_amount ?? null : current.fixed_amount };
  if (merged.basis === "percent" && merged.percent === null) return { ok: false, status: 422, error: "The percent must be between 0 and 100" };
  if (merged.basis === "fixed" && merged.fixed_amount === null) return { ok: false, status: 422, error: "The amount must be a number of 0 or more" };
  if (input.status) {
    const problem = statusChangeProblem(current.status, input.status);
    if (problem) return { ok: false, status: 409, error: problem };
  }
  const { status: wantedStatus, ...fields } = input;
  const patch: Record<string, unknown> = { ...fields, ...(touchesAmount ? { percent: merged.basis === "percent" ? merged.percent : null, fixed_amount: merged.basis === "fixed" ? merged.fixed_amount : null } : {}), updated_at: new Date().toISOString() };
  if (wantedStatus && wantedStatus !== current.status) patch.status = wantedStatus;
  const saved = await admin.from("contract_project_milestones").update(patch).eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", current.status).select(COLS);
  if (saved.error) return { ok: false, status: 500, error: saved.error.message };
  const row = (saved.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, status: 409, error: "This milestone changed while you were editing. Reload and try again" };
  const next = normaliseMilestone(row);
  const changes = (["title", "due_date", "basis", "percent", "fixed_amount", "status", "note"] as const)
    .filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => ({ field: `Milestone "${current.title}" ${k.replace("_", " ")}`, from: current[k] ?? null, to: next[k] ?? null }));
  if (changes.length > 0) await logMilestone(req, project, changes);
  return { ok: true, milestone: next };
}

export async function removeMilestone(req: ProjectCtx, project: ProjectRow, current: MilestoneRow): Promise<Result<object>> {
  const { admin, tenantId } = req;
  if (!isRemovable(current)) return { ok: false, status: 409, error: "A milestone with an invoice cannot be removed" };
  const gone = await admin.from("contract_project_milestones").delete().eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", project.id).is("invoice_id", null).in("status", ["planned", "ready"]).select("id");
  if (gone.error) return { ok: false, status: 500, error: gone.error.message };
  if ((gone.data ?? []).length === 0) return { ok: false, status: 409, error: "This milestone changed. Reload and try again" };
  await logMilestone(req, project, [{ field: "Invoicing milestone removed", from: current.title, to: null }]);
  return { ok: true };
}

/**
 * Create the draft invoice for a milestone. The milestone is CLAIMED first (planned or ready becomes invoiced, with a compare-and-set), so a
 * double click or two people at once cannot make two invoices; the invoice is then made by the existing invoices route, the milestone is
 * linked to it, the invoice is linked back (custom_data), and a failure in between puts the milestone back.
 */
export async function createMilestoneInvoice(req: ProjectCtx, project: ProjectRow, current: MilestoneRow): Promise<Result<{ invoice_id: string; invoice_ref: string | null; amount: number }>> {
  const { admin, supabase, tenantId } = req;
  if (!(await tenantHasFeature(supabase, tenantId, "invoices"))) return { ok: false, status: 403, error: "Invoices is not enabled for this workspace" };
  const amount = milestoneAmount(current, project.contract_value);
  const invoiceStatus = current.invoice_id ? (await invoicesOf(admin, tenantId, [current.invoice_id])).get(current.invoice_id)?.status ?? null : null;
  const problem = invoiceProblem({ milestone: current, invoiceStatus, amount, accountId: project.account_id, projectClosed: project.status === "closed" });
  if (problem) return { ok: false, status: 409, error: problem };
  // The customer is checked against THIS workspace before it goes anywhere near an invoice.
  if (!project.account_id || !(await accountInTenant(admin, tenantId, project.account_id))) return { ok: false, status: 404, error: "Customer not found" };

  const fromStatus = effectiveStatus(current, invoiceStatus);
  const claimQuery = admin.from("contract_project_milestones").update({ status: "invoiced", invoice_id: null, updated_at: new Date().toISOString() })
    .eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", current.status);
  const claimed = await (current.invoice_id ? claimQuery.eq("invoice_id", current.invoice_id) : claimQuery.is("invoice_id", null)).select("id");
  if (claimed.error) return { ok: false, status: 500, error: claimed.error.message };
  if ((claimed.data ?? []).length === 0) return { ok: false, status: 409, error: "This milestone was just invoiced. Reload" };
  const release = () => admin.from("contract_project_milestones").update({ status: fromStatus === "planned" ? "planned" : "ready", invoice_id: null }).eq("id", current.id).eq("tenant_id", tenantId);

  let invoice: { id: string; ref: string | null } | null = null;
  let failure: Failure | null = null;
  try {
    const { POST } = await import("@/app/api/invoices/route");
    const res = await POST(new NextRequest(new URL("/api/invoices", "http://internal.invalid"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(invoiceBody({
        accountId: project.account_id, projectRef: project.ref, projectName: project.name, milestone: current, amount,
        taxNote: taxNote(await workspaceMilestoneTax(), amount, (n) => money(n, project.currency, 2)),
      })),
    }));
    const j = (await res.json().catch(() => ({}))) as { id?: string; ref?: string; error?: string };
    if (res.ok && j.id) invoice = { id: j.id, ref: j.ref ?? null };
    else failure = { status: res.status >= 400 ? res.status : 500, error: j.error ?? "The invoice could not be created" };
  } catch (e) {
    failure = { status: 500, error: (e as Error).message };
  }
  if (!invoice) { await release(); return { ok: false, ...(failure as Failure) }; }

  const linked = await admin.from("contract_project_milestones").update({ invoice_id: invoice.id, status: "invoiced", updated_at: new Date().toISOString() }).eq("id", current.id).eq("tenant_id", tenantId).select("id");
  if (linked.error || (linked.data ?? []).length === 0) {
    return { ok: false, status: 500, error: `The invoice ${invoice.ref ?? ""} was created but could not be linked to the milestone. Open it from Invoices`.replace("  ", " ") };
  }
  // The way back: the invoice remembers the project and the milestone. A failure here is not worth undoing the invoice for (its notes say the same).
  const existing = await admin.from("invoices").select("custom_data").eq("id", invoice.id).eq("tenant_id", tenantId).maybeSingle();
  const custom = ((existing.data as { custom_data?: Record<string, unknown> | null } | null)?.custom_data ?? {}) as Record<string, unknown>;
  await admin.from("invoices").update({ custom_data: { ...custom, [INVOICE_PROJECT_KEY]: project.id, [INVOICE_MILESTONE_KEY]: current.id } }).eq("id", invoice.id).eq("tenant_id", tenantId);

  await logMilestone(req, project, [{ field: `Milestone "${current.title}" invoiced`, from: null, to: `${invoice.ref ?? "invoice"} · ${amount}` }]);
  return { ok: true, invoice_id: invoice.id, invoice_ref: invoice.ref, amount };
}
