import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActorNames } from "@/lib/actorNames";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { tenantToday } from "@/lib/tenantClock";
import { rfqConfig } from "@/lib/rfq/types";
import { allowedSuppliersForAccount } from "@/lib/supplierGroups/server";
import { currentRevision, loadLines, loadProject, loadRevisions, needsUpdate, openProjectRequest, type Failure, type ProjectCtx } from "../server";
import type { BudgetLine, ProjectRow } from "../types";
import {
  BUYOUT_BUNDLE, againstBudget, buyoutTiles, effectiveStatus, handoverState, lineQty, linesLocked, lowestValidTotal, roundMoney, roundQuotes,
  type BudgetLineRow, type BuyoutSummary, type PackageDetail, type PackageKind, type PackageLineView, type PackageRow, type PackageStatus, type RoundView,
} from "./rules";
import { isMissingSchema } from "@/lib/tender/server";

import { readAllPages } from "@/lib/pagedRead";
// Server side of the Buy-out tab (migration 0234, docs/design/contract-buyout.md). Every query is tenant-scoped on the service-role client, every
// id from a request is verified against the workspace AND the project before it is used, and every read tolerates the migration being pending
// (a missing table or column reads as `pending`, never as a crash). The cost side only: nothing here is ever printed for a customer or exposed
// through the v1 API, MCP, Data Workbench or Talk to data.

export { isMissingSchema };
export type { Failure };

export const needsBuyoutUpdate = (): Failure => ({
  status: 503, error: "Buy-out needs a database update (migration 0234). Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: BUYOUT_BUNDLE },
});

export type BuyoutCtx = ProjectCtx & {
  project: ProjectRow;
  /** The RFQ module is on for the workspace and the caller may edit RFQs: a round can be sent. */
  rfqEdit: boolean;
};

/**
 * The door of every /api/contract-projects/[id]/buyout* route. The contract-projects gate first (the platform-admin flags, the workcenter,
 * the edit grant for a write), then a project of THIS workspace that was made from a TENDER deal. Anything else is the same 404, so a standard
 * project cannot tell buy-out exists. `rfq: true` is for the routes that raise an RFQ round: they also need the RFQ module and the RFQ edit grant.
 */
export async function openBuyoutRequest(projectId: string, opts: { write?: boolean; rfq?: boolean } = {}): Promise<{ ok: true; req: BuyoutCtx } | ({ ok: false } & Failure)> {
  const gate = await openProjectRequest({ write: opts.write });
  if (!gate.ok) return gate;
  const base = gate.req;
  const found = await loadProject(base.admin, base.tenantId, projectId);
  if (found.kind === "pending") return { ok: false, ...needsUpdate() };
  if (found.kind !== "ok") return { ok: false, status: 404, error: "Not found" };
  const project = found.project;
  if (!project.source_opportunity_id) return { ok: false, status: 404, error: "Not found" };
  const tender = await base.admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", base.tenantId).eq("opportunity_id", project.source_opportunity_id).maybeSingle();
  if (tender.error || !tender.data) return { ok: false, status: 404, error: "Not found" };

  let rfqEdit = false;
  if (await tenantHasFeature(base.supabase, base.tenantId, "rfq")) {
    const perms = await resolvePermissions(base.supabase, base.tenantId, base.userId, base.role);
    rfqEdit = canEditWorkcenter(perms, "rfqs");
  }
  if (opts.rfq && !rfqEdit) return { ok: false, status: 403, error: "Sending a request for quotes needs the RFQ module and permission to edit RFQs" };
  return { ok: true, req: { ...base, project, rfqEdit } };
}

/** The door plus one package of THIS project (a package of another project or workspace is the same 404 as one that does not exist). */
export async function openPackageRequest(projectId: string, packageId: string, opts: { write?: boolean; rfq?: boolean } = {}): Promise<{ ok: true; req: BuyoutCtx; pkg: PackageDbRow } | ({ ok: false } & Failure)> {
  const gate = await openBuyoutRequest(projectId, opts);
  if (!gate.ok) return gate;
  const found = await loadPackageRow(gate.req.admin, gate.req.tenantId, gate.req.project.id, packageId);
  if (found.pending) return { ok: false, ...needsBuyoutUpdate() };
  if (!found.row) return { ok: false, status: 404, error: "Not found" };
  return { ok: true, req: gate.req, pkg: found.row };
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PackageDbRow = {
  id: string; project_id: string; ref: string | null; name: string; kind: PackageKind; status: PackageStatus;
  current_rfq_id: string | null; awarded_rfq_id: string | null; awarded_supplier_id: string | null;
  committed_amount: number | null; currency: string | null; award_reason: string | null; awarded_by: string | null; awarded_at: string | null;
  handover_sent_at: string | null; handover_sent_by: string | null; erp_ref: string | null; note: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export const PACKAGE_COLS = "id, project_id, ref, name, kind, status, current_rfq_id, awarded_rfq_id, awarded_supplier_id, committed_amount, currency, award_reason, awarded_by, awarded_at, handover_sent_at, handover_sent_by, erp_ref, note, created_by, created_at, updated_at";

export type PackageLineDb = { id: string; package_id: string; budget_line_id: string | null; line_key: string; sort_order: number };

const normalisePackage = (r: Record<string, unknown>): PackageDbRow => ({
  ...(r as unknown as PackageDbRow), committed_amount: r.committed_amount == null ? null : Number(r.committed_amount),
});

export async function loadPackageRows(admin: SupabaseClient, tenantId: string, projectId: string): Promise<{ rows: PackageDbRow[]; pending: boolean }> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("project_buyout_packages").select(PACKAGE_COLS).eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normalisePackage), pending: false };
}

export async function loadPackageRow(admin: SupabaseClient, tenantId: string, projectId: string, id: string): Promise<{ row: PackageDbRow | null; pending: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { row: null, pending: false };
  const { data, error } = await admin.from("project_buyout_packages").select(PACKAGE_COLS).eq("id", id).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
  if (error) return { row: null, pending: isMissingSchema(error) };
  return { row: data ? normalisePackage(data as Record<string, unknown>) : null, pending: false };
}

export async function loadPackageLines(admin: SupabaseClient, tenantId: string, projectId: string): Promise<PackageLineDb[]> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("project_buyout_package_lines").select("id, package_id, budget_line_id, line_key, sort_order").eq("tenant_id", tenantId).eq("project_id", projectId).order("sort_order", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  if (error) return [];
  return ((data ?? []) as PackageLineDb[]).map((l) => ({ ...l, sort_order: Number(l.sort_order ?? 0) }));
}

// ── The budget a package is made from ────────────────────────────────────────────────────────────────────────────────────

export type Baseline = {
  /** The approved revision: the budget packages are made from. Null while the baseline is not approved. */
  approved: { id: string; rev_no: number } | null;
  lines: BudgetLine[];
  /** Revision 0, the baseline the winning bid's cost started: "cost in bid". */
  bidLines: BudgetLine[];
};

export async function loadBaseline(admin: SupabaseClient, tenantId: string, projectId: string): Promise<Baseline> {
  const { rows: revisions } = await loadRevisions(admin, tenantId, projectId);
  const approved = revisions.find((r) => r.status === "approved") ?? null;
  const first = revisions.find((r) => r.rev_no === 0) ?? null;
  const lines = approved ? await loadLines(admin, tenantId, approved.id) : [];
  const bidLines = first ? (approved && first.id === approved.id ? lines : await loadLines(admin, tenantId, first.id)) : [];
  return { approved: approved ? { id: approved.id, rev_no: approved.rev_no } : null, lines, bidLines };
}

export function budgetLineRow(l: BudgetLine): BudgetLineRow {
  return {
    id: l.id, line_key: l.line_key, line_no: l.line_no, wbs: l.wbs, description: l.description, qty: l.qty, unit: l.unit,
    resource_code: l.resource_code, cost_code: l.cost_code, amount: l.amount,
  };
}

// ── The rounds ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoundData = {
  head: { id: string; ref: string | null; status: string; package_id: string; respond_by: string | null; created_at: string; requested_by: string | null };
  lines: { id: string; sl_no: number; qty: number | null; status: string; package_line_id: string | null; description: string; uom: string | null; awarded_unit_cost: number | null }[];
  suppliers: { id: string; supplier_id: string; status: string; replied_at: string | null }[];
  responses: { id: string; rfq_supplier_id: string; rfq_line_id: string; status: "quoted" | "no_quote" | "alternative"; unit_price: number | null; fx_rate: number | null; currency: string | null; lead_time_days: number | null; moq: number | null; valid_until: string | null; note: string | null; submitted_at: string }[];
};

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** Every round (RFQ) of the given packages, oldest first, with its lines, recipients and answers. A missing column (0234 pending) reads as no rounds. */
export async function loadRounds(admin: SupabaseClient, tenantId: string, packageIds: readonly string[]): Promise<Map<string, RoundData[]>> {
  const out = new Map<string, RoundData[]>();
  if (packageIds.length === 0) return out;
  const heads: RoundData["head"][] = [];
  for (const part of chunks(packageIds, 100)) {
    const { data, error } = await readAllPages((lo, hi) => admin.from("rfqs").select("id, ref, status, package_id, respond_by, created_at, requested_by").eq("tenant_id", tenantId).in("package_id", part).order("created_at", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
    if (error) return out;
    heads.push(...((data ?? []) as RoundData["head"][]));
  }
  if (heads.length === 0) return out;
  const ids = heads.map((h) => h.id);
  const lines: (RoundData["lines"][number] & { rfq_id: string })[] = [];
  const sups: (RoundData["suppliers"][number] & { rfq_id: string })[] = [];
  for (const part of chunks(ids, 100)) {
    const [l, s] = await Promise.all([
      readAllPages((lo, hi) => admin.from("rfq_lines").select("id, rfq_id, sl_no, qty, status, package_line_id, description, uom, awarded_unit_cost").eq("tenant_id", tenantId).in("rfq_id", part).order("id", { ascending: true }).range(lo, hi)),
      readAllPages((lo, hi) => admin.from("rfq_suppliers").select("id, rfq_id, supplier_id, status, replied_at").eq("tenant_id", tenantId).in("rfq_id", part).order("id", { ascending: true }).range(lo, hi)),
    ]);
    lines.push(...((l.data ?? []) as Record<string, unknown>[]).map((x) => ({ ...(x as unknown as RoundData["lines"][number] & { rfq_id: string }), qty: num(x.qty), awarded_unit_cost: num(x.awarded_unit_cost), sl_no: Number(x.sl_no ?? 0) })));
    sups.push(...((s.data ?? []) as unknown as (RoundData["suppliers"][number] & { rfq_id: string })[]));
  }
  const live = sups.filter((s) => s.status !== "cancelled");
  const resp: (RoundData["responses"][number])[] = [];
  for (const part of chunks(live.map((s) => s.id), 100)) {
    const { data } = await readAllPages((lo, hi) => admin.from("rfq_responses").select("id, rfq_supplier_id, rfq_line_id, status, unit_price, fx_rate, currency, lead_time_days, moq, valid_until, note, submitted_at")
      .eq("tenant_id", tenantId).in("rfq_supplier_id", part).order("id", { ascending: true }).range(lo, hi));
    resp.push(...((data ?? []) as Record<string, unknown>[]).map((x) => ({ ...(x as unknown as RoundData["responses"][number]), unit_price: num(x.unit_price), fx_rate: num(x.fx_rate), moq: num(x.moq), lead_time_days: num(x.lead_time_days) })));
  }
  for (const h of heads) {
    const mySups = sups.filter((s) => s.rfq_id === h.id);
    const supIds = new Set(mySups.map((s) => s.id));
    const round: RoundData = {
      head: h,
      lines: lines.filter((l) => l.rfq_id === h.id),
      suppliers: mySups,
      responses: resp.filter((r) => supIds.has(r.rfq_supplier_id)),
    };
    out.set(h.package_id, [...(out.get(h.package_id) ?? []), round]);
  }
  return out;
}

// ── The world a screen is drawn from ───────────────────────────────────────────────────────────────────────────────────

export type World = {
  req: BuyoutCtx;
  packages: PackageDbRow[];
  pkgLines: PackageLineDb[];
  baseline: Baseline;
  rounds: Map<string, RoundData[]>;
  supplierNames: Map<string, string>;
  actorNames: Map<string, string>;
  today: string;
  staleDays: number;
};

/** Everything the summary and the detail read, in one go. Rounds are loaded only for `roundsFor` (all packages when omitted). */
export async function loadWorld(req: BuyoutCtx, opts: { roundsFor?: readonly string[] } = {}): Promise<World | { pending: true }> {
  const { admin, tenantId, project } = req;
  const { rows: packages, pending } = await loadPackageRows(admin, tenantId, project.id);
  if (pending) return { pending: true };
  const [pkgLines, baseline, today, tenantRow] = await Promise.all([
    loadPackageLines(admin, tenantId, project.id),
    loadBaseline(admin, tenantId, project.id),
    tenantToday(tenantId),
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
  ]);
  const rounds = await loadRounds(admin, tenantId, opts.roundsFor ?? packages.map((p) => p.id));
  const cfg = rfqConfig(((tenantRow.data?.config ?? {}) as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq);
  const supplierIds = new Set<string>();
  for (const list of rounds.values()) for (const r of list) for (const s of r.suppliers) supplierIds.add(s.supplier_id);
  for (const p of packages) if (p.awarded_supplier_id) supplierIds.add(p.awarded_supplier_id);
  const supplierNames = new Map<string, string>();
  for (const part of chunks([...supplierIds], 100)) {
    const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", part);
    for (const s of (data ?? []) as { id: string; name: string }[]) supplierNames.set(s.id, s.name);
  }
  const actorIds: (string | null)[] = [];
  for (const p of packages) actorIds.push(p.awarded_by, p.handover_sent_by);
  for (const list of rounds.values()) for (const r of list) actorIds.push(r.head.requested_by);
  const actorNames = await loadActorNames(admin, tenantId, actorIds);
  return { req, packages, pkgLines, baseline, rounds, supplierNames, actorNames, today, staleDays: cfg.price_valid_days };
}

type RoundWork = { view: RoundView; data: RoundData };

function workRounds(w: World, pkg: PackageDbRow): RoundWork[] {
  const list = w.rounds.get(pkg.id) ?? [];
  const current = pkg.current_rfq_id ?? list[list.length - 1]?.head.id ?? null;
  return list.map((d, i) => {
    const quotes = roundQuotes({
      lines: d.lines.map((l) => ({ id: l.id, qty: l.qty, status: l.status })),
      suppliers: d.suppliers.map((s) => ({ id: s.id, supplier_id: s.supplier_id, name: w.supplierNames.get(s.supplier_id) ?? "Supplier", status: s.status, replied_at: s.replied_at })),
      responses: d.responses.map((r) => ({ ...r })),
      today: w.today, staleDays: w.staleDays,
      awarded: pkg.status === "awarded" || pkg.status === "handed_over" ? (pkg.awarded_rfq_id === d.head.id && pkg.awarded_supplier_id ? { supplier_id: pkg.awarded_supplier_id } : null) : null,
    });
    const asked = d.suppliers.filter((s) => s.status !== "cancelled" && s.status !== "pending");
    return {
      data: d,
      view: {
        rfq_id: d.head.id, ref: d.head.ref, round: i + 1, created_at: d.head.created_at,
        created_by: d.head.requested_by ? w.actorNames.get(d.head.requested_by) ?? null : null,
        status: d.head.status, respond_by: d.head.respond_by, is_current: d.head.id === current,
        suppliers_total: asked.length, suppliers_replied: asked.filter((s) => s.status === "replied" || s.status === "declined").length,
        quotes,
      },
    };
  });
}

/** The current round of a package: the one it points at, else the newest. */
export function currentRound(rounds: readonly RoundWork[]): RoundWork | null {
  return rounds.find((r) => r.view.is_current) ?? rounds[rounds.length - 1] ?? null;
}

export function packageRowFor(w: World, pkg: PackageDbRow, work: RoundWork[] = workRounds(w, pkg)): PackageRow {
  const approvedByKey = new Map(w.baseline.lines.map((l) => [l.line_key, l]));
  const bidByKey = new Map(w.baseline.bidLines.map((l) => [l.line_key, l]));
  const mine = w.pkgLines.filter((l) => l.package_id === pkg.id);
  const budget = roundMoney(mine.reduce((s, l) => s + (approvedByKey.get(l.line_key)?.amount ?? 0), 0));
  const bid_cost = roundMoney(mine.reduce((s, l) => s + (bidByKey.get(l.line_key)?.amount ?? 0), 0));
  const cur = currentRound(work);
  const best_quote = cur ? lowestValidTotal(cur.view.quotes) : null;
  const status = effectiveStatus({ stored: pkg.status, rounds: work.length, best_quote });
  const committed = pkg.status === "awarded" || pkg.status === "handed_over" ? pkg.committed_amount : null;
  return {
    id: pkg.id, ref: pkg.ref, name: pkg.name, kind: pkg.kind, status, line_count: mine.length, budget, bid_cost,
    best_quote, committed, against_budget: againstBudget(budget, committed, best_quote),
    current_round: cur ? cur.view.round : null, rounds: work.length,
    handover: handoverState({ status, handover_sent_at: pkg.handover_sent_at }),
    note: pkg.note, awarded_supplier_id: pkg.awarded_supplier_id,
    awarded_supplier_name: pkg.awarded_supplier_id ? w.supplierNames.get(pkg.awarded_supplier_id) ?? null : null,
  };
}

export async function buildSummary(req: BuyoutCtx): Promise<(BuyoutSummary & { pending: false }) | { pending: true }> {
  const w = await loadWorld(req);
  if ("pending" in w) return { pending: true };
  const rows = w.packages.map((p) => packageRowFor(w, p));
  const taken = new Set(w.pkgLines.map((l) => l.line_key));
  const unassigned = w.baseline.lines.filter((l) => !l.reserve && !taken.has(l.line_key)).sort((a, b) => a.line_no - b.line_no).map(budgetLineRow);
  const projectBudget = w.baseline.lines.filter((l) => !l.reserve).reduce((s, l) => s + l.amount, 0);
  const restriction = await allowedSuppliersForAccount(req.tenantId, req.project.account_id, req.admin);
  const committed_by_line: Record<string, number> = {};
  for (const p of w.packages) {
    if ((p.status !== "awarded" && p.status !== "handed_over") || !p.awarded_rfq_id) continue;
    const round = (w.rounds.get(p.id) ?? []).find((r) => r.head.id === p.awarded_rfq_id);
    for (const l of round?.lines ?? []) {
      const key = l.package_line_id ? w.pkgLines.find((x) => x.id === l.package_line_id)?.line_key : undefined;
      if (!key || l.status !== "awarded" || l.awarded_unit_cost === null) continue;
      committed_by_line[key] = roundMoney(l.awarded_unit_cost * lineQty(l.qty));
    }
  }
  return {
    pending: false,
    baseline: w.baseline.approved ? { revision_id: w.baseline.approved.id, rev_no: w.baseline.approved.rev_no } : null,
    group: restriction.group, restricted: restriction.restricted, currency: req.project.currency,
    tiles: buyoutTiles(rows, projectBudget),
    packages: rows, unassigned_lines: unassigned, committed_by_line, can_edit: req.canEdit, can_send_rounds: req.canEdit && req.rfqEdit,
  };
}

export async function buildDetail(req: BuyoutCtx, packageId: string): Promise<PackageDetail | { pending: true } | null> {
  const w = await loadWorld(req, { roundsFor: [packageId] });
  if ("pending" in w) return { pending: true };
  const pkg = w.packages.find((p) => p.id === packageId);
  if (!pkg) return null;
  const work = workRounds(w, pkg);
  const row = packageRowFor(w, pkg, work);
  const approvedByKey = new Map(w.baseline.lines.map((l) => [l.line_key, l]));
  const bidByKey = new Map(w.baseline.bidLines.map((l) => [l.line_key, l]));
  const lines: PackageLineView[] = w.pkgLines.filter((l) => l.package_id === pkg.id).sort((a, b) => a.sort_order - b.sort_order).map((l) => {
    const b = approvedByKey.get(l.line_key) ?? bidByKey.get(l.line_key);
    return {
      id: l.id, line_key: l.line_key, item_no: b?.wbs ?? null, description: b?.description ?? "Line no longer in the budget", qty: b?.qty ?? 0, uom: b?.unit ?? null,
      cost_code: b?.cost_code ?? null, cost_in_bid: bidByKey.get(l.line_key)?.amount ?? 0, budget: approvedByKey.get(l.line_key)?.amount ?? 0,
    };
  });
  const rounds = [...work].reverse().map((r) => r.view);
  const bars = { budget: row.budget, bid_cost: row.bid_cost, best_quote: row.best_quote, committed: row.committed };
  const handover = {
    ...handoverState({ status: row.status, handover_sent_at: pkg.handover_sent_at }),
    sent_by_name: pkg.handover_sent_by ? w.actorNames.get(pkg.handover_sent_by) ?? null : null, erp_ref: pkg.erp_ref,
  };
  return {
    package: {
      ...row, currency: pkg.currency ?? req.project.currency, current_rfq_id: pkg.current_rfq_id, awarded_rfq_id: pkg.awarded_rfq_id, award_reason: pkg.award_reason,
      awarded_by_name: pkg.awarded_by ? w.actorNames.get(pkg.awarded_by) ?? null : null, awarded_at: pkg.awarded_at, erp_ref: pkg.erp_ref, created_at: pkg.created_at,
    },
    lines, rounds,
    budget_bars: { ...bars, max: Math.max(1, bars.budget, bars.bid_cost, bars.best_quote ?? 0, bars.committed ?? 0) },
    handover, can_edit: req.canEdit, can_send_rounds: req.canEdit && req.rfqEdit,
    lines_locked: linesLocked({ status: row.status, rounds: work.length }),
  };
}

/** The same screen data as the summary row, for one package after a write. */
export async function packageRowAfter(req: BuyoutCtx, packageId: string): Promise<PackageRow | null> {
  const w = await loadWorld(req, { roundsFor: [packageId] });
  if ("pending" in w) return null;
  const pkg = w.packages.find((p) => p.id === packageId);
  return pkg ? packageRowFor(w, pkg) : null;
}

export { workRounds };
export type { RoundWork };
