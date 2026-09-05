import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { getWfmConfig } from "@/lib/wfm/server";
import { loadProjectSessions } from "@/lib/wfm/projectHoursServer";
import { UNASSIGNED } from "@/lib/wfm/projectHours";
import { depthOf, descendantsOf, type TreeNodeLike } from "@/lib/wfm/projectTree";
import { buildBillingLines, periodsOverlap, round2, type BillingLine, type BillableSession } from "@/lib/wfm/billing";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";
import { diffForLog, logChange } from "@/lib/changeLog";

type Admin = ReturnType<typeof createAdminSupabase>;

export type BillingGranularity = "project" | "sub_project";

export type BilledPeriod = {
  id: string;
  project_id: string;
  project_name: string;
  invoice_id: string;
  invoice_ref: string;
  invoice_status: string;
  period_from: string;
  period_to: string;
  granularity: BillingGranularity;
  minutes: number;
  amount: number;
  created_at: string;
};

export type BillingPreview = {
  project: { id: string; ref: string | null; name: string; level: number; account_id: string | null; account_name: string | null };
  from: string;
  to: string;
  granularity: BillingGranularity;
  lines: BillingLine[];
  minutes: number;
  hours: number;
  subtotal: number;
  /** Internal -- stripped by the v1 route. Null when no cost rate is set. */
  cost: number | null;
  margin_pct: number | null;
  tax: { label: string; rate: number; inclusive: boolean; amount: number };
  total: number;
  due_date: string;
  /** Hours in the same window on no project at all -- a warning, since they
   *  may belong here and can still be attributed on the roster. */
  unassigned_minutes: number;
  /** Invoices (not cancelled) whose period overlaps this one, on this project
   *  or anything above or beneath it. Any = refuse, unless it is a top-up. */
  conflicts: BilledPeriod[];
  /** When exactly one non-cancelled invoice already covers this same period
   *  for this project and more hours have landed since (a correction
   *  approved afterwards), the difference can be billed on its own. */
  top_up: { invoice_id: string; invoice_ref: string; billed_minutes: number; billed_amount: number; delta_minutes: number; delta_amount: number } | null;
  /** Everything ever billed on this project's tree, newest first. */
  billed: BilledPeriod[];
  /** Why an invoice can't be raised right now. Empty = go. */
  blockers: string[];
  pending_migration?: true;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

export function validatePeriod(from: unknown, to: unknown): string | null {
  if (typeof from !== "string" || !DATE_RE.test(from) || typeof to !== "string" || !DATE_RE.test(to)) {
    return "from and to (YYYY-MM-DD) are required";
  }
  if (to < from) return "to must be on or after from";
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) {
    return `Pick a window of ${MAX_DAYS} days or fewer`;
  }
  return null;
}

type ProjectRow = { id: string; ref: string | null; name: string; parent_id: string | null; account_id: string | null; bill_rate: number | null; status: string };

function ancestorsOf(byId: Map<string, ProjectRow>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return out;
}

/** Billed periods for a set of projects, joined to the invoice they made. */
async function billedPeriods(admin: Admin, tenantId: string, projectIds: string[], byId: Map<string, ProjectRow>): Promise<BilledPeriod[] | { pending_migration: true }> {
  if (projectIds.length === 0) return [];
  const { data, error } = await admin
    .from("wfm_project_invoices")
    .select("id, project_id, invoice_id, period_from, period_to, granularity, minutes, amount, created_at, invoices!inner(ref, status)")
    .eq("tenant_id", tenantId)
    .in("project_id", projectIds)
    .order("period_from", { ascending: false });
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return { pending_migration: true };
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => {
    const inv = (Array.isArray(r.invoices) ? r.invoices[0] : r.invoices) as { ref: string; status: string } | null;
    return {
      id: r.id as string,
      project_id: r.project_id as string,
      project_name: byId.get(r.project_id as string)?.name ?? "",
      invoice_id: r.invoice_id as string,
      invoice_ref: inv?.ref ?? "",
      invoice_status: inv?.status ?? "",
      period_from: r.period_from as string,
      period_to: r.period_to as string,
      granularity: (r.granularity as BillingGranularity) ?? "project",
      minutes: Number(r.minutes) || 0,
      amount: Number(r.amount) || 0,
      created_at: r.created_at as string,
    };
  });
}

/**
 * What an invoice for this project and period would contain. Never writes.
 *
 * The same sessions the hours report counts, priced by the rate ladder, then
 * folded into lines at the chosen granularity. Everything that would stop
 * the invoice (no account, no rate, overlap) is a named blocker rather than
 * an exception, so the screen can say exactly what to fix.
 */
export async function projectBillingPreview(
  admin: Admin,
  tenantId: string,
  projectId: string,
  from: string,
  to: string,
  granularity: BillingGranularity
): Promise<BillingPreview | { error: string; status: number }> {
  const [{ data: allRows, error: projErr }, config, { data: tenantRow }] = await Promise.all([
    admin.from("wfm_projects").select("id, ref, name, parent_id, account_id, bill_rate, status").eq("tenant_id", tenantId),
    getWfmConfig(admin, tenantId),
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
  ]);
  if (projErr) {
    if (projErr.code === "42703") return { error: "Billing needs migration 0108 (wfm_projects.bill_rate) applied first", status: 503 };
    return { error: projErr.message, status: 500 };
  }
  const rows = (allRows ?? []) as ProjectRow[];
  const byId = new Map(rows.map((p) => [p.id, p]));
  const project = byId.get(projectId);
  if (!project) return { error: "Not found", status: 404 };

  const tree: TreeNodeLike[] = rows.map((p) => ({ id: p.id, parent_id: p.parent_id }));
  const nodes = new Map(tree.map((t) => [t.id, t]));
  const subtree = [projectId, ...descendantsOf(tree, projectId)];
  const subtreeSet = new Set(subtree);
  const ancestors = ancestorsOf(byId, projectId);

  let accountName: string | null = null;
  if (project.account_id) {
    const { data: acct } = await admin.from("accounts").select("name").eq("id", project.account_id).eq("tenant_id", tenantId).maybeSingle();
    accountName = (acct?.name as string | undefined) ?? null;
  }

  const costing = config.costing;
  const typeLabel = (code: string) => config.employment_types.find((t) => t.code === code)?.label ?? code;
  const tax = (tenantRow?.config as TenantConfig | null)?.tax ?? { label: "GST", rate: 18, inclusive: false };

  // Sessions for everyone in the window; only those stamped inside this
  // subtree are billable. The rest are counted only to warn about unassigned.
  const loaded = await loadProjectSessions(admin, tenantId, from, to, null);
  const level = depthOf(nodes, projectId) ?? 0;
  const base: BillingPreview = {
    project: { id: project.id, ref: project.ref, name: project.name, level, account_id: project.account_id, account_name: accountName },
    from, to, granularity, lines: [], minutes: 0, hours: 0, subtotal: 0, cost: null, margin_pct: null,
    tax: { label: tax.label, rate: tax.rate, inclusive: tax.inclusive, amount: 0 }, total: 0,
    due_date: new Date(Date.now() + costing.due_days * 86_400_000).toISOString().slice(0, 10),
    unassigned_minutes: 0, conflicts: [], top_up: null, billed: [], blockers: [],
  };
  if ("pending_migration" in loaded) return { ...base, pending_migration: true, blockers: ["Project costing migration is pending"] };

  const employeeIds = [...new Set(loaded.sessions.map((s) => s.employee_id))];
  const { data: emps } = employeeIds.length
    ? await admin.from("employees").select("id, employment_type").eq("tenant_id", tenantId).in("id", employeeIds)
    : { data: [] as { id: string; employment_type: string | null }[] };
  const typeOf = new Map((emps ?? []).map((e) => [e.id as string, (e.employment_type as string | null) ?? null]));

  const sessions: BillableSession[] = [];
  let unassigned = 0;
  // Tree order, so lines come out parent-first and siblings in ref order.
  const order = new Map(subtree.map((id, i) => [id, i]));
  for (const emp of loaded.sessions) {
    for (const s of emp.sessions) {
      const minutes = config.deduct_breaks ? s.net_minutes : s.gross_minutes;
      const key = s.project_id ?? UNASSIGNED;
      if (key === UNASSIGNED) { unassigned += minutes; continue; }
      if (!subtreeSet.has(key)) continue;
      sessions.push({ project_id: key, employee_id: emp.employee_id, employment_type: typeOf.get(emp.employee_id) ?? null, minutes });
    }
  }
  sessions.sort((a, b) => (order.get(a.project_id) ?? 0) - (order.get(b.project_id) ?? 0));

  // Under "sub_project", hours group by their Level-(level+1) ancestor within
  // this tree -- the project's direct children -- and the project's own
  // hours stay on the project.
  const groupOf = (pid: string): { id: string; label: string } => {
    if (granularity === "project" || pid === projectId) return { id: projectId, label: project.name };
    let cur = pid;
    while (cur) {
      const parent = byId.get(cur)?.parent_id ?? null;
      if (parent === projectId) break;
      if (!parent) break;
      cur = parent;
    }
    const g = byId.get(cur) ?? project;
    return { id: g.id, label: `${project.name} — ${g.name}` };
  };
  const chainFor = (pid: string): (number | null)[] =>
    [pid, ...ancestorsOf(byId, pid)].map((id) => byId.get(id)?.bill_rate ?? null);

  const lines = buildBillingLines({ sessions, groupOf, chainFor, costing, typeLabel });
  const minutes = lines.reduce((s, l) => s + l.minutes, 0);
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const costTotal = round2(lines.reduce((s, l) => s + l.cost, 0));
  const hasCost = costing.default_cost_rate > 0 || Object.values(costing.rates_by_employment_type).some((r) => (r.cost ?? 0) > 0);
  const taxAmount = tax.inclusive ? 0 : round2(subtotal * (tax.rate / 100));

  const billedRaw = await billedPeriods(admin, tenantId, [...subtree, ...ancestors], byId);
  if ("pending_migration" in billedRaw) {
    return { ...base, pending_migration: true, blockers: ["Billing needs migration 0108 applied first"] };
  }
  const billed = billedRaw.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const conflicts = billed.filter((b) => b.invoice_status !== "cancelled" && periodsOverlap(from, to, b.period_from, b.period_to));

  let topUp: BillingPreview["top_up"] = null;
  if (conflicts.length === 1) {
    const c = conflicts[0];
    const sameScope = c.project_id === projectId && c.period_from === from && c.period_to === to;
    const deltaMinutes = minutes - c.minutes;
    const deltaAmount = round2(subtotal - c.amount);
    if (sameScope && deltaMinutes > 0 && deltaAmount > 0) {
      topUp = { invoice_id: c.invoice_id, invoice_ref: c.invoice_ref, billed_minutes: c.minutes, billed_amount: c.amount, delta_minutes: deltaMinutes, delta_amount: deltaAmount };
    }
  }

  const blockers: string[] = [];
  if (!project.account_id) blockers.push("Link this project to an account first — an invoice needs a customer.");
  if (lines.length === 0) blockers.push("No hours on this project in that period.");
  if (lines.some((l) => l.rate <= 0)) blockers.push("No bill rate applies — set one on the project, or in Settings → Workforce → Project billing.");
  if (conflicts.length > 0 && !topUp) {
    blockers.push(`Already invoiced for an overlapping period: ${conflicts.map((c) => `${c.invoice_ref} (${c.period_from} to ${c.period_to})`).join(", ")}.`);
  }

  return {
    ...base,
    lines, minutes, hours: round2(minutes / 60), subtotal,
    cost: hasCost ? costTotal : null,
    margin_pct: hasCost && subtotal > 0 ? round2(((subtotal - costTotal) / subtotal) * 100) : null,
    tax: { ...base.tax, amount: taxAmount },
    total: round2(subtotal + taxAmount),
    unassigned_minutes: unassigned,
    conflicts, top_up: topUp, billed, blockers,
  };
}

/**
 * Raise a draft invoice from a preview. Refuses on any blocker, so the API
 * and the screen can never disagree about what is billable. A top-up bills
 * only the difference since the earlier invoice, as one line.
 */
export async function createProjectInvoice(
  admin: Admin,
  tenantId: string,
  args: { projectId: string; from: string; to: string; granularity: BillingGranularity; topUp?: boolean; actorId?: string | null; actorEmail?: string | null }
): Promise<{ id: string; ref: string; total: number } | { error: string; status: number }> {
  const preview = await projectBillingPreview(admin, tenantId, args.projectId, args.from, args.to, args.granularity);
  if ("error" in preview) return preview;

  const isTopUp = !!args.topUp;
  if (isTopUp && !preview.top_up) return { error: "Nothing to top up for that period.", status: 409 };
  if (preview.blockers.length > 0) return { error: preview.blockers[0], status: 409 };
  // A period with a top-up available has no overlap blocker (the delta is
  // billable), but a FULL invoice for it would be the double bill the guard
  // exists to stop.
  if (!isTopUp && preview.conflicts.length > 0) {
    return { error: `Already invoiced on ${preview.conflicts[0].invoice_ref}. Bill the difference as a top-up instead.`, status: 409 };
  }
  if (!preview.project.account_id) return { error: "Link this project to an account first.", status: 409 };

  const periodLabel = `${args.from} to ${args.to}`;
  const lineRows = isTopUp
    ? [{
        sl_no: "1",
        description: `${preview.project.name} — additional hours since ${preview.top_up!.invoice_ref} (${periodLabel})`,
        uom: "Hrs", qty: round2(preview.top_up!.delta_minutes / 60),
        rate: round2(preview.top_up!.delta_amount / (preview.top_up!.delta_minutes / 60)),
        amount: preview.top_up!.delta_amount,
      }]
    : preview.lines.map((l, i) => ({
        sl_no: String(i + 1),
        description: `${l.description} (${periodLabel})`,
        uom: "Hrs", qty: l.hours, rate: l.rate, amount: l.amount,
      }));
  const total = round2(lineRows.reduce((s, l) => s + l.amount, 0));
  const minutes = isTopUp ? preview.top_up!.delta_minutes : preview.minutes;

  const notes = `Hours worked on ${[preview.project.ref, preview.project.name].filter(Boolean).join(" ")}, ${periodLabel}.${
    isTopUp ? ` Top-up to ${preview.top_up!.invoice_ref}.` : ""}`;

  let invoice: { id: string; ref: string } | null = null;
  let invErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const ref = await generateNextInvoiceRef(admin, tenantId);
    const result = await admin
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        account_id: preview.project.account_id,
        contact_id: null, entity_id: null, quote_id: null, case_id: null, contract_id: null, work_order_id: null,
        ref, status: "draft", total,
        due_date: preview.due_date,
        discount_type: "pct", discount_pct: 0, discount_fixed: 0,
        notes, terms: null,
        created_by: args.actorId ?? null,
      })
      .select("id, ref")
      .single();
    if (!result.error) invoice = result.data;
    else if (result.error.code === "23505") { invErr = result.error; continue; }
    else { invErr = result.error; break; }
  }
  if (!invoice) return { error: invErr?.message ?? "Failed to create invoice", status: 500 };

  const { error: linesErr } = await admin
    .from("invoice_lines")
    .insert(lineRows.map((l) => ({ ...l, tenant_id: tenantId, invoice_id: invoice!.id })));
  if (linesErr) return { error: linesErr.message, status: 500 };

  // The period claim. If this fails the invoice still exists -- better a
  // draft someone can see and delete than a silent loss -- but say so.
  const { error: linkErr } = await admin.from("wfm_project_invoices").insert({
    tenant_id: tenantId, project_id: args.projectId, invoice_id: invoice.id,
    period_from: args.from, period_to: args.to, granularity: args.granularity,
    minutes, amount: total, created_by: args.actorId ?? null,
  });
  if (linkErr) return { error: `Invoice ${invoice.ref} was created but the billed period could not be recorded: ${linkErr.message}`, status: 500 };

  await logChange(admin, {
    tenantId, objectType: "invoices", objectId: invoice.id, objectLabel: invoice.ref,
    action: "create", actorId: args.actorId ?? undefined, actorEmail: args.actorEmail ?? undefined,
    changes: diffForLog("invoices", {}, { account_id: preview.project.account_id, total, project_id: args.projectId, period: periodLabel }),
  });

  return { id: invoice.id, ref: invoice.ref, total };
}

/** Everything billed on a project's tree -- for the project page list and
 *  the v1 endpoint. Cheap: one read. */
export async function projectBilledPeriods(admin: Admin, tenantId: string, projectId: string): Promise<BilledPeriod[] | { pending_migration: true }> {
  const { data: allRows } = await admin.from("wfm_projects").select("id, ref, name, parent_id, account_id, status").eq("tenant_id", tenantId);
  const rows = ((allRows ?? []) as Omit<ProjectRow, "bill_rate">[]).map((p) => ({ ...p, bill_rate: null }));
  const byId = new Map(rows.map((p) => [p.id, p]));
  const tree: TreeNodeLike[] = rows.map((p) => ({ id: p.id, parent_id: p.parent_id }));
  const ids = [projectId, ...descendantsOf(tree, projectId), ...ancestorsOf(byId, projectId)];
  const out = await billedPeriods(admin, tenantId, ids, byId);
  if ("pending_migration" in out) return out;
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Customer-facing shape of a preview: no cost, no margin. */
export function publicPreview(p: BillingPreview) {
  const { cost, margin_pct, ...rest } = p;
  void cost; void margin_pct;
  return { ...rest, lines: rest.lines.map(({ cost: _c, ...l }) => { void _c; return l; }) };
}
