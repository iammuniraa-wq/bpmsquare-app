import { lineMemberships } from "@/lib/contractProjects/allocation";
import { coverageOf, plannedMargin, round2, type MarginCoverage } from "@/lib/contractProjects/budget";
import { milestoneAmount, effectiveStatus, hasDraftInvoice, type MilestoneRow } from "@/lib/contractProjects/milestones";
import type { WorkPackageRow } from "@/lib/contractProjects/types";
import { partsOf } from "@/lib/wbs/tree";
import type { Num } from "./types";

// Every number of the cost-to-complete and profitability dashboards: ONE formula per question (design section 4). PURE. A missing input
// gives a missing output, never 0 (null in, null out): that is the whole point of "Not connected".
//
// Notation: CV contract value now (revised); CV0 = CV less approved variations; B budget of the approved revision; B0 revision 0 total;
// A actual; O open commitments; ETG estimate to go; EAC = A + O + ETG.

const sum = (xs: readonly number[]): number => round2(xs.reduce((s, v) => s + v, 0));
const pct1 = (n: number): number => Math.round(n * 10) / 10;

/** A figure over a base as a percent to one place, or null when there is no base to compare with. */
export function ratioPct(part: Num, base: Num): Num {
  if (part === null || base === null || !(base > 0)) return null;
  return pct1((part / base) * 100);
}

export type MarginFigure = { amount: number; pct: Num };
/** Margin as money and as a percent of the contract value. Null while either side is missing or there is no contract value. */
export function marginOf(contractValue: Num, cost: Num): MarginFigure | null {
  if (contractValue === null || cost === null || !(contractValue > 0)) return null;
  return { amount: round2(contractValue - cost), pct: ratioPct(contractValue - cost, contractValue) };
}

// ── The planned half: real from day one ────────────────────────────────────────────────────────────────────────────────

/** Baseline margin: (CV0 - B0) / CV0, from the first approved budget and the contract value before any approved variation. */
export function baselineMargin(args: { contractValue: number; approvedVariations: number; baselineTotal: Num }): MarginFigure | null {
  return marginOf(round2(args.contractValue - args.approvedVariations), args.baselineTotal);
}

export type PlannedMargin = MarginFigure & { complete: boolean; allocated: number; of: number };
/**
 * Planned margin: (CV - B) / CV under the coverage rule. While some lines still wait for a cost it is the margin of the allocated lines
 * only (what the client pays for them less their cost) and says so; when that cannot be worked out it is null ("Not complete").
 */
export function plannedMarginOf(contractValue: number, budget: Num, coverage: MarginCoverage | null): PlannedMargin | null {
  if (budget === null || (coverage && coverage.allocated === 0)) return null;
  if (!coverage || coverage.complete) {
    const m = plannedMargin(contractValue, budget);
    return { amount: m.amount, pct: m.pct, complete: true, allocated: coverage?.allocated ?? 0, of: coverage?.of ?? 0 };
  }
  return coverage.pct === null || coverage.amount === null ? null : { amount: coverage.amount, pct: coverage.pct, complete: false, allocated: coverage.allocated, of: coverage.of };
}

/** The coverage of an approved revision's lines (a line with no cost yet waits). */
export const coverageOfLines = (lines: readonly { client_amount: number | null; amount: number; allocated?: boolean }[]): MarginCoverage =>
  coverageOf(lines.map((l) => ({ client: l.client_amount, cost: l.allocated === false ? null : Number(l.amount) || 0 })));

export type BuyoutPackage = { status: string; budget: number; committed: Num };
export type BuyoutAwards = { awarded: number; saving: number; packages: number };
/** Awarded in Buy-out: the sum of awarded totals, and the saving the same packages made against their budget. Never called "Committed". */
export function buyoutAwards(packages: readonly BuyoutPackage[]): BuyoutAwards {
  const won = packages.filter((p) => (p.status === "awarded" || p.status === "handed_over") && p.committed !== null);
  return { awarded: sum(won.map((p) => p.committed as number)), saving: sum(won.map((p) => p.budget - (p.committed as number))), packages: won.length };
}

// ── Cost cells: WBS item x resource type ──────────────────────────────────────────────────────────────────────────────

export type CellKey = string;
/** F&O posts per WBS item and category, so the forecast is worked per cell. A project without a WBS has one cell per resource type. */
export const cellKey = (wbsCode: string | null | undefined, resourceCode: string | null | undefined): CellKey => `${wbsCode ?? ""}|${resourceCode ?? ""}`;
export const splitKey = (k: CellKey): { wbs_code: string; resource_code: string } => {
  const i = k.indexOf("|");
  return { wbs_code: k.slice(0, i), resource_code: k.slice(i + 1) };
};

export type BudgetLineForCells = { line_key: string; resource_code: string | null; amount: number; allocated?: boolean };
export type BudgetCell = { key: CellKey; wbs_code: string; resource_code: string; budget: number };

/**
 * The approved budget laid out per cell. A line sits whole in one WBS item or is split across items by percent (the same memberships the
 * WBS tab uses); a line in no item sits in the cell with no WBS code. A line nobody allocated a cost to adds nothing.
 */
export function budgetCells(lines: readonly BudgetLineForCells[], packages: readonly Pick<WorkPackageRow, "id" | "code" | "line_keys" | "line_parts">[]): BudgetCell[] {
  const codeOf = new Map(packages.map((p) => [p.id, p.code]));
  const memberships = lineMemberships(packages);
  const out = new Map<CellKey, BudgetCell>();
  const add = (wbs: string, resource: string, amount: number) => {
    const key = cellKey(wbs, resource);
    const cell = out.get(key) ?? { key, wbs_code: wbs, resource_code: resource, budget: 0 };
    cell.budget = round2(cell.budget + amount);
    out.set(key, cell);
  };
  for (const l of lines) {
    const amount = l.allocated === false ? 0 : Number(l.amount) || 0;
    const resource = l.resource_code ?? "";
    const m = memberships.get(l.line_key);
    const parts = m ? partsOf(m) : [];
    if (parts.length === 0) { add("", resource, amount); continue; }
    let placed = 0;
    for (const p of parts) {
      const share = round2((amount * p.share_pct) / 100);
      placed = round2(placed + share);
      add(codeOf.get(p.wbs_item_id) ?? "", resource, share);
    }
    // A split that does not add to 100 leaves the rest in the cell with no WBS code, so the cells always add up to the budget.
    if (placed < amount) add("", resource, round2(amount - placed));
  }
  return [...out.values()].sort((a, b) => a.wbs_code.localeCompare(b.wbs_code, undefined, { numeric: true }) || a.resource_code.localeCompare(b.resource_code, undefined, { numeric: true }));
}

// ── The forecast ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type CellFacts = { actual: number; committed: number };
export type CellForecast = {
  key: CellKey; wbs_code: string; resource_code: string; budget: number;
  actual: Num; committed: Num;
  /** The manager's typed estimate to go; null when none was typed. */
  typed: Num;
  etg: Num;
  /** typed: the manager's number; default: max(budget - actual - committed, 0), "assumes the budget holds"; none: not enough facts. */
  etgSource: "typed" | "default" | "none";
  /** Already past its budget with no estimate typed: flagged. */
  overBudget: boolean;
  /** Posted or committed cost that belongs to no cell the budget knows. */
  unmapped: boolean;
};

export type CostForecast = {
  cells: CellForecast[];
  actual: Num; committed: Num; etg: Num;
  /** Actual + committed + estimate to go. */
  eac: Num;
  /** Open commitments + estimate to go. */
  costToComplete: Num;
  /** The share of the forecast that is an estimate and not a fact: ETG / EAC. */
  estimatePct: Num;
  /** The share that is already spent or committed: (A + O) / EAC. */
  firmPct: Num;
  /** The part of the estimate that is only "the budget holds". */
  assumedEtg: Num;
  /** Sum of what the manager typed, whether or not the facts are connected. */
  typedEtg: number;
};

/**
 * The forecast per cell and in total. `actual` / `committed` are the posted and committed facts per cell; null means that kind is Not
 * connected, and every figure that needs it is null. Facts for a cell the budget does not have make an Unmapped cell: shown, never dropped.
 */
export function costForecast(input: {
  cells: readonly BudgetCell[];
  actual: ReadonlyMap<CellKey, number> | null;
  committed: ReadonlyMap<CellKey, number> | null;
  typed: ReadonlyMap<CellKey, number>;
}): CostForecast {
  const keys = new Map<CellKey, BudgetCell>(input.cells.map((c) => [c.key, c]));
  const unmappedKeys = new Set<CellKey>();
  for (const m of [input.actual, input.committed]) if (m) for (const k of m.keys()) if (!keys.has(k)) { unmappedKeys.add(k); keys.set(k, { key: k, ...splitKey(k), budget: 0 }); }
  const cells: CellForecast[] = [...keys.values()].map((c) => {
    const actual = input.actual ? round2(input.actual.get(c.key) ?? 0) : null;
    const committed = input.committed ? round2(input.committed.get(c.key) ?? 0) : null;
    const typed = input.typed.has(c.key) ? (input.typed.get(c.key) as number) : null;
    const known = actual !== null && committed !== null;
    const rest = known ? round2(c.budget - (actual as number) - (committed as number)) : null;
    const etg = typed !== null ? typed : rest !== null ? Math.max(rest, 0) : null;
    return {
      key: c.key, wbs_code: c.wbs_code, resource_code: c.resource_code, budget: c.budget, actual, committed, typed, etg,
      etgSource: typed !== null ? "typed" : rest !== null ? "default" : "none",
      overBudget: typed === null && rest !== null && rest < 0, unmapped: unmappedKeys.has(c.key),
    };
  });
  const a = input.actual ? sum(cells.map((c) => c.actual as number)) : null;
  const o = input.committed ? sum(cells.map((c) => c.committed as number)) : null;
  const allEtg = cells.length > 0 && cells.every((c) => c.etg !== null);
  // With no cells at all there is nothing to estimate: the estimate is a real 0 only once both facts are known.
  const etg = a !== null && o !== null && (allEtg || cells.length === 0) ? sum(cells.map((c) => c.etg as number)) : null;
  const eac = a !== null && o !== null && etg !== null ? round2(a + o + etg) : null;
  return {
    cells, actual: a, committed: o, etg, eac,
    costToComplete: o !== null && etg !== null ? round2(o + etg) : null,
    estimatePct: etg !== null && eac !== null && eac > 0 ? pct1((etg / eac) * 100) : null,
    firmPct: a !== null && o !== null && eac !== null && eac > 0 ? pct1(((a + o) / eac) * 100) : null,
    assumedEtg: etg === null ? null : sum(cells.filter((c) => c.etgSource === "default").map((c) => c.etg as number)),
    typedEtg: sum(cells.filter((c) => c.typed !== null).map((c) => c.typed as number)),
  };
}

export type CostVariance = { amount: number; pct: Num };
/** Cost variance: B - EAC, negative when the forecast is over the budget; the percent is of B. */
export function costVariance(budget: Num, eac: Num): CostVariance | null {
  if (budget === null || eac === null) return null;
  return { amount: round2(budget - eac), pct: ratioPct(budget - eac, budget) };
}
/** Forecast margin: (CV - EAC) / CV. */
export const forecastMargin = (contractValue: Num, eac: Num): MarginFigure | null => marginOf(contractValue, eac);
/** Margin at risk: max(0, EAC - B), in money. */
export const marginAtRisk = (budget: Num, eac: Num): Num => (budget === null || eac === null ? null : round2(Math.max(0, eac - budget)));

// ── The margin bridge ─────────────────────────────────────────────────────────────────────────────────────────────────

export type BridgeStepId = "baseline" | "variation_revenue" | "variation_cost" | "other_revisions" | "buyout_saving" | "after_buyout" | "execution" | "forecast";
export type BridgeStep = {
  id: BridgeStepId;
  label: string;
  amount: Num;
  /** start / total are drawn from zero; delta steps float. */
  kind: "start" | "delta" | "total";
  /** The step needs the ERP cost read-back: while it is Not connected the bar is hatched and says "Needs ERP cost". */
  needsErp: boolean;
};

/**
 * Baseline margin + (CV - CV0) - variation cost - other revisions + buy-out saving - execution = forecast margin.
 * Variation cost is the cost on approved variations; other revisions are what the budget moved by apart from them; the buy-out saving is
 * sum(budget - awarded); execution is what is left, EAC - B + saving. The steps up to Buy-out are real without the ERP.
 */
export function marginBridge(args: {
  contractValue: number; approvedVariations: number; approvedVariationCost: number;
  baselineTotal: Num; budget: Num; buyoutSaving: number; eac: Num;
}): BridgeStep[] {
  const cv0 = round2(args.contractValue - args.approvedVariations);
  const base = args.baselineTotal === null ? null : round2(cv0 - args.baselineTotal);
  const other = args.baselineTotal === null || args.budget === null ? null : round2(args.budget - args.baselineTotal - args.approvedVariationCost);
  const afterBuyout = args.budget === null ? null : round2(args.contractValue - args.budget + args.buyoutSaving);
  const execution = args.eac === null || args.budget === null ? null : round2(args.eac - args.budget + args.buyoutSaving);
  return [
    { id: "baseline", label: "Baseline margin", amount: base, kind: "start", needsErp: false },
    { id: "variation_revenue", label: "Client changes (revenue)", amount: round2(args.contractValue - cv0), kind: "delta", needsErp: false },
    { id: "variation_cost", label: "Client changes (cost)", amount: round2(-args.approvedVariationCost), kind: "delta", needsErp: false },
    { id: "other_revisions", label: "Other budget changes", amount: other === null ? null : round2(-other), kind: "delta", needsErp: false },
    { id: "buyout_saving", label: "Buy-out saving", amount: args.budget === null ? null : round2(args.buyoutSaving), kind: "delta", needsErp: false },
    { id: "after_buyout", label: "After buy-out", amount: afterBuyout, kind: "total", needsErp: false },
    { id: "execution", label: "Execution", amount: execution === null ? null : round2(-execution), kind: "delta", needsErp: true },
    { id: "forecast", label: "Forecast margin", amount: args.eac === null ? null : round2(args.contractValue - args.eac), kind: "total", needsErp: true },
  ];
}

// ── Client billing ────────────────────────────────────────────────────────────────────────────────────────────────────

export type BillingMilestone = Pick<MilestoneRow, "basis" | "percent" | "fixed_amount" | "status" | "invoice_id" | "due_date" | "title"> & { invoice_status?: string | null };

const todayOf = (now: Date): string => now.toISOString().slice(0, 10);
const daysBetween = (fromIso: string, to: string): number => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

/** Scheduled to date: the sum of the milestones due on or before today. Real from the plan alone. */
export function scheduledToDate(milestones: readonly BillingMilestone[], contractValue: number, now: Date): number {
  const today = todayOf(now);
  return sum(milestones.filter((m) => m.due_date && m.due_date <= today).map((m) => milestoneAmount(m, contractValue)));
}

export type BehindOnBilling = { count: number; amount: number; oldestDays: number; milestones: { title: string; due_date: string; amount: number; daysBehind: number }[] };
/**
 * Behind on billing: milestones due on or before today with no issued invoice (a draft invoice is not billed yet). `billingKnown` is false
 * while nothing tells whether a milestone was invoiced (no BPMSquare invoices, no ERP billing read-back): then there is no answer, not zero.
 */
export function behindOnBilling(milestones: readonly BillingMilestone[], contractValue: number, now: Date, billingKnown: boolean): BehindOnBilling | null {
  if (!billingKnown) return null;
  const today = todayOf(now);
  const late = milestones.filter((m) => {
    if (!m.due_date || m.due_date > today) return false;
    const st = effectiveStatus(m, m.invoice_status);
    return hasDraftInvoice(m, m.invoice_status) || !(st === "invoiced" || st === "paid");
  }).map((m) => ({ title: m.title, due_date: m.due_date as string, amount: milestoneAmount(m, contractValue), daysBehind: daysBetween(m.due_date as string, today) }));
  late.sort((a, b) => b.daysBehind - a.daysBehind);
  return { count: late.length, amount: sum(late.map((m) => m.amount)), oldestDays: late[0]?.daysBehind ?? 0, milestones: late };
}
