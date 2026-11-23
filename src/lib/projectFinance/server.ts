import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActorNames } from "@/lib/actorNames";
import { readAllPages } from "@/lib/pagedRead";
import { canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import type { TenantFeatures } from "@/lib/constants";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { isMissingSchema, loadMasters, normaliseProject } from "@/lib/contractProjects/server";
import type { ProjectRow, WorkPackageRow } from "@/lib/contractProjects/types";
import { canSeeFinance, canSeeProjectFinance, financeVisibleProjects, type FinanceCaller } from "./access";
import { buildProjectFinance, type EtgEntry, type FinanceInputs, type ProjectFinance } from "./model";
import { summarisePortfolio, toPortfolioRow, type ProjectFinanceDash } from "./portfolio";
import type { BillingMilestone, BuyoutPackage, CellKey } from "./rules";
import { readFinanceSettings } from "./settings";
import type { ErpKindState } from "./state";
import type { ErpKind, FinanceSettings } from "./types";

// The loaders of the cost-to-complete and profitability dashboards. Every query is tenant-scoped on the admin client and tolerates a table
// that is not there yet (migrations 0261 and 0262 are applied by hand). Cost and margin are internal: the access check is made HERE, where
// the data is made, so a caller who may not see it gets nothing and no figure travels in page props for them.

export const FORECAST_BUNDLE = "scripts/run-bundle-pf-0261-forecast-etg-2026-11-24.sql";
export const READBACK_BUNDLE = "scripts/run-bundle-pf-0262-erp-readback-tables-2026-11-24.sql";

export type FinanceAccess = { caller: FinanceCaller; settings: FinanceSettings };

/**
 * Who this person is, for cost and margin. The module flag needs Contract projects as well; the Business Role grant for project_finance is
 * read from the role's explicit grants (an unrestricted member has none, which is exactly why "granted" mode refuses them).
 */
export async function resolveFinanceAccess(args: {
  supabase: SupabaseClient; tenantId: string; userId: string; role: "admin" | "member";
  features: Partial<TenantFeatures> | null | undefined; config: unknown;
}): Promise<FinanceAccess> {
  const settings = readFinanceSettings(args.config as Parameters<typeof readFinanceSettings>[0]);
  const moduleOn = args.features?.project_dashboards === true && args.features?.contract_projects === true;
  if (!moduleOn) {
    return { caller: { moduleOn: false, visibility: settings.visibility, role: args.role, canOpenProjects: false, unrestricted: false, hasGrant: false }, settings };
  }
  const perms = await resolvePermissions(args.supabase, args.tenantId, args.userId, args.role);
  return {
    caller: {
      moduleOn, visibility: settings.visibility, role: args.role, canOpenProjects: canViewWorkcenter(perms, "contract_projects"),
      unrestricted: perms.unrestricted, hasGrant: perms.grants.get("project_finance")?.canView === true,
    },
    settings,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Rows of one batched read, or [] when the table is not there yet. Any other error is thrown: a half-read figure is worse than none. */
async function rowsOf(run: (lo: number, hi: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<{ rows: Row[]; missing: boolean }> {
  const { data, error } = await readAllPages(run);
  if (error) {
    if (isMissingSchema(error)) return { rows: [], missing: true };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as Row[], missing: false };
}

const chunks = <T,>(xs: readonly T[], n = 100): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const num = (v: unknown): number => Number(v ?? 0) || 0;
const cellOf = (r: Row): CellKey => `${(r.wbs_code as string) ?? ""}|${(r.resource_code as string) ?? ""}`;

/**
 * The seam for approved site expenses the ERP has not posted yet (docs/design/pcbs-site-receipt-expenses.md, "Recorded cost"). That module is
 * built apart from this one, so until it supplies a reader nothing is added: the answer is null, which `buildProjectFinance` reads as "no
 * recorded cost", never as a zero it would then show.
 */
export async function loadRecordedCost(_admin: SupabaseClient, _tenantId: string, _projectIds: readonly string[]): Promise<Map<string, ReadonlyMap<CellKey, number>>> {
  return new Map();
}

export type LoadedFinance = {
  inputs: Map<string, FinanceInputs>;
  /** Migration 0261 / 0262 are not applied yet (informational: the figures still read as Not connected). */
  etgMissing: boolean;
  readbackMissing: boolean;
  buyoutPackages: Map<string, (BuyoutPackage & { id: string; name: string })[]>;
};

/** Everything the figures of these projects need, in a few batched reads, all with `.eq("tenant_id", tenantId)`. */
export async function loadFinanceInputs(
  admin: SupabaseClient, tenantId: string, projects: readonly ProjectRow[],
  opts: { features: Partial<TenantFeatures> | null | undefined; settings: FinanceSettings; withPackages?: boolean; now?: Date },
): Promise<LoadedFinance> {
  const now = opts.now ?? new Date();
  const ids = projects.map((p) => p.id);
  const out: LoadedFinance = { inputs: new Map(), etgMissing: false, readbackMissing: false, buyoutPackages: new Map() };
  if (ids.length === 0) return out;

  const batched = async (table: string, cols: string) => {
    const all: Row[] = []; let missing = false;
    for (const part of chunks(ids)) {
      const res = await rowsOf((lo, hi) => (admin.from(table).select(cols).eq("tenant_id", tenantId).in("project_id", part).order("id", { ascending: true }).range(lo, hi) as never));
      all.push(...res.rows); missing ||= res.missing;
    }
    return { rows: all, missing };
  };

  const revisions = await batched("project_budget_revisions", "id, project_id, rev_no, status, total, justification_code, approved_at");
  const approvedIds = revisions.rows.filter((r) => r.status === "approved").map((r) => r.id as string);
  const lineRows: Row[] = [];
  for (const part of chunks(approvedIds, 50)) {
    const read = (cols: string) => rowsOf((lo, hi) => admin.from("project_budget_lines").select(cols).eq("tenant_id", tenantId).in("revision_id", part).order("id", { ascending: true }).range(lo, hi) as never);
    let res = await read("revision_id, line_key, resource_code, amount, allocated, client_amount");
    if (res.missing) res = await read("revision_id, line_key, resource_code, amount");
    lineRows.push(...res.rows);
  }

  const [variations, milestones, buyoutPk, buyoutLines, states, etgRows] = await Promise.all([
    batched("contract_project_variations", "project_id, status, amount, cost_amount"),
    batched("contract_project_milestones", "id, project_id, title, due_date, basis, percent, fixed_amount, status, invoice_id, sort_order"),
    batched("project_buyout_packages", "id, project_id, name, status, committed_amount"),
    batched("project_buyout_package_lines", "package_id, project_id, line_key"),
    batched("project_erp_state", "project_id, kind, linked, last_ok_at, last_status, row_count"),
    batched("project_forecast_etg", "project_id, wbs_code, resource_code, amount, note, entered_by, entered_at"),
  ]);
  out.etgMissing = etgRows.missing;
  out.readbackMissing = states.missing;

  // Facts only for the kinds that feed a figure and only for projects whose state says a pull landed: nothing is read for the rest.
  const linkedIds = [...new Set(states.rows.filter((s) => s.linked === true && s.last_ok_at).map((s) => s.project_id as string))];
  const facts: Row[] = [];
  for (const part of chunks(linkedIds)) {
    const res = await rowsOf((lo, hi) => admin.from("project_erp_facts").select("project_id, kind, wbs_code, resource_code, milestone_id, amount").eq("tenant_id", tenantId).in("project_id", part).in("kind", ["cost_actual", "cost_committed", "billed"]).order("id", { ascending: true }).range(lo, hi) as never);
    facts.push(...res.rows);
  }

  // Invoice statuses, only where BPMSquare's own Invoices module is on (the plan's status then comes from the invoice).
  const invoicesOn = opts.features?.invoices === true;
  const invoiceStatus = new Map<string, string | null>();
  if (invoicesOn) {
    const invIds = [...new Set(milestones.rows.map((m) => m.invoice_id as string | null).filter((x): x is string => !!x))];
    for (const part of chunks(invIds)) {
      const { data } = await admin.from("invoices").select("id, status").eq("tenant_id", tenantId).in("id", part);
      for (const r of (data ?? []) as { id: string; status: string | null }[]) invoiceStatus.set(r.id, r.status);
    }
  }

  const recorded = await loadRecordedCost(admin, tenantId, ids);
  const by = <T extends Row>(rows: readonly T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.project_id as string, [...(m.get(r.project_id as string) ?? []), r]); return m; };
  const revBy = by(revisions.rows), varBy = by(variations.rows), msBy = by(milestones.rows), pkBy = by(buyoutPk.rows), plBy = by(buyoutLines.rows), stBy = by(states.rows), etgBy = by(etgRows.rows), factBy = by(facts);
  const linesByRev = new Map<string, Row[]>();
  for (const l of lineRows) linesByRev.set(l.revision_id as string, [...(linesByRev.get(l.revision_id as string) ?? []), l]);

  const actors = await loadActorNames(admin, tenantId, etgRows.rows.map((r) => (r.entered_by as string | null) ?? null));

  for (const project of projects) {
    const revs = (revBy.get(project.id) ?? []).map((r) => ({ id: r.id as string, rev_no: num(r.rev_no), status: r.status as string, total: num(r.total), justification_code: (r.justification_code as string | null) ?? null, approved_at: (r.approved_at as string | null) ?? null }));
    const approved = revs.find((r) => r.status === "approved") ?? null;
    const lines = approved ? (linesByRev.get(approved.id) ?? []).map((l) => ({
      line_key: l.line_key as string, resource_code: (l.resource_code as string | null) ?? null, amount: num(l.amount), allocated: l.allocated === false ? false : true,
      client_amount: l.client_amount == null ? null : num(l.client_amount),
    })) : null;
    const amountOfKey = new Map((lines ?? []).map((l) => [l.line_key, l.allocated === false ? 0 : l.amount]));
    const pkLines = plBy.get(project.id) ?? [];
    const packagesOf = (pkBy.get(project.id) ?? []).map((p) => ({
      id: p.id as string, name: (p.name as string) ?? "", status: p.status as string, committed: p.committed_amount == null ? null : num(p.committed_amount),
      budget: Math.round(pkLines.filter((x) => x.package_id === p.id).reduce((s, x) => s + (amountOfKey.get(x.line_key as string) ?? 0), 0) * 100) / 100,
    }));
    out.buyoutPackages.set(project.id, packagesOf);

    const stateRows = stBy.get(project.id) ?? [];
    const kinds: Partial<Record<ErpKind, ErpKindState>> = {};
    for (const s of stateRows) kinds[s.kind as ErpKind] = { kind: s.kind as ErpKind, linked: s.linked === true, last_ok_at: (s.last_ok_at as string | null) ?? null, last_status: (s.last_status as "ok" | "failed" | null) ?? null, row_count: num(s.row_count) };
    const factRows = factBy.get(project.id) ?? [];
    const cellSums = (kind: string) => { const m = new Map<CellKey, number>(); for (const f of factRows.filter((x) => x.kind === kind)) m.set(cellOf(f), Math.round((((m.get(cellOf(f)) ?? 0) + num(f.amount))) * 100) / 100); return m; };

    // The WBS only where it is drawn or where posted cost needs its cells.
    let packages: (Pick<WorkPackageRow, "id" | "code" | "line_keys" | "line_parts"> & { name?: string })[] = [];
    if (opts.withPackages || kinds.cost_actual?.last_ok_at || kinds.cost_committed?.last_ok_at) packages = (await loadPackages(admin, tenantId, project.id)).packages;

    const ms: (BillingMilestone & { id: string })[] = (msBy.get(project.id) ?? []).sort((a, b) => num(a.sort_order) - num(b.sort_order)).map((m) => ({
      id: m.id as string, title: (m.title as string) ?? "", due_date: (m.due_date as string | null) ?? null, basis: m.basis === "fixed" ? "fixed" : "percent",
      percent: m.percent == null ? null : num(m.percent), fixed_amount: m.fixed_amount == null ? null : num(m.fixed_amount),
      status: m.status as BillingMilestone["status"], invoice_id: (m.invoice_id as string | null) ?? null, invoice_status: m.invoice_id ? invoiceStatus.get(m.invoice_id as string) ?? null : null,
    }));
    const etg: EtgEntry[] = (etgBy.get(project.id) ?? []).map((e) => ({
      wbs_code: (e.wbs_code as string) ?? "", resource_code: (e.resource_code as string) ?? "", amount: num(e.amount), note: (e.note as string | null) ?? null,
      entered_by: (e.entered_by as string | null) ?? null, entered_by_name: e.entered_by ? actors.get(e.entered_by as string) ?? null : null, entered_at: (e.entered_at as string | null) ?? null,
    }));

    out.inputs.set(project.id, {
      project: { id: project.id, ref: project.ref, name: project.name, status: project.status, currency: project.currency, contract_value: project.contract_value, manager_id: project.manager_id, erp_system: project.erp_system, erp_id: project.erp_id },
      revisions: revs, approvedLines: lines, packages, variations: (varBy.get(project.id) ?? []).map((v) => ({ status: v.status as string, amount: num(v.amount), cost_amount: num(v.cost_amount) })),
      milestones: ms, invoicesOn, buyout: packagesOf,
      erp: { states: kinds, actual: cellSums("cost_actual"), committed: cellSums("cost_committed"), billedMilestones: new Set(factRows.filter((f) => f.kind === "billed" && f.milestone_id).map((f) => f.milestone_id as string)) },
      recorded: recorded.get(project.id) ?? null, etg, settings: opts.settings, now,
    });
  }
  return out;
}

// ── One project ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProjectFinanceDetail = {
  finance: ProjectFinance;
  /** The names behind the codes on the forecast table: resource types and WBS items. */
  labels: { resource: Record<string, string>; wbs: Record<string, string> };
  buyoutPackages: (BuyoutPackage & { id: string; name: string })[];
  settings: FinanceSettings;
  /** The estimate to go cannot be saved yet: migration 0261 is not applied. */
  etgMissing: boolean;
};

/** The finance of one project for this caller, or null when they may not see it (no figure is read or returned then). */
export async function getProjectFinance(args: {
  admin: SupabaseClient; tenantId: string; userId: string; access: FinanceAccess; features: Partial<TenantFeatures> | null | undefined; project: ProjectRow;
}): Promise<ProjectFinanceDetail | null> {
  if (!canSeeProjectFinance(args.access.caller, args.project, args.userId)) return null;
  const loaded = await loadFinanceInputs(args.admin, args.tenantId, [args.project], { features: args.features, settings: args.access.settings, withPackages: true });
  const input = loaded.inputs.get(args.project.id);
  if (!input) return null;
  const resources = await loadMasters(args.admin, args.tenantId, "resource");
  const labels = { resource: Object.fromEntries(resources.map((r) => [r.code, r.name])), wbs: Object.fromEntries(input.packages.map((p) => [p.code, p.name ?? p.code])) };
  return { finance: buildProjectFinance(input), labels, buyoutPackages: loaded.buyoutPackages.get(args.project.id) ?? [], settings: args.access.settings, etgMissing: loaded.etgMissing };
}

// ── The portfolio ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The portfolio for this caller: the projects they may see finance for. Null when the module is off or they may see none of it. */
export async function getPortfolioFinance(args: {
  admin: SupabaseClient; tenantId: string; userId: string; access: FinanceAccess; features: Partial<TenantFeatures> | null | undefined; includeClosed?: boolean;
}): Promise<ProjectFinanceDash | { status: "pending" } | null> {
  const { caller, settings } = args.access;
  if (!caller.moduleOn || !caller.canOpenProjects) return null;
  const { data, error } = await readAllPages((lo, hi) => args.admin.from("contract_projects").select("*").eq("tenant_id", args.tenantId).order("updated_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));
  if (error) return isMissingSchema(error) ? { status: "pending" } : null;
  const all = ((data ?? []) as Row[]).map(normaliseProject);
  const visible = financeVisibleProjects(caller, all, args.userId).filter((p) => args.includeClosed || p.status !== "closed");
  if (visible.length === 0 && !canSeeFinance(caller)) return null;
  const loaded = await loadFinanceInputs(args.admin, args.tenantId, visible, { features: args.features, settings });
  const rows = visible.map((p) => toPortfolioRow(buildProjectFinance(loaded.inputs.get(p.id) as FinanceInputs)));
  return { status: "ok", summary: summarisePortfolio(rows, { onlyActive: !args.includeClosed }), rows, floor: settings.marginFloor, isAdmin: caller.role === "admin", settings: { dropPoints: settings.dropPoints, cashDays: settings.cashDays, latePct: settings.latePct } };
}
