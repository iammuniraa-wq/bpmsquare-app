import { countLevels } from "./lights";
import type { ProjectFinance } from "./model";
import { ratioPct, type BridgeStepId } from "./rules";
import type { Light, LightLevel, Num } from "./types";

// The portfolio over active projects (design sections 4 and 7): the four tiles, the lights donut and the five worst. PURE. Excluded from
// every total: a project with no approved baseline, a project whose cost is not connected (from the forecast tiles), and other
// currencies (a total across currencies is blank with "mixed currencies", as summariseProjects).

/** The few fields the dashboard and Reports carry per project: never the cells, the bridge or the typed estimates. */
export type PortfolioRow = {
  id: string; ref: string | null; name: string; status: string; currency: string | null;
  contractValue: number; budget: Num;
  plannedPct: Num; plannedComplete: boolean; baselinePct: Num; forecastPct: Num;
  eac: Num; costToComplete: Num; atRisk: Num; actual: Num; committed: Num; awarded: number; buyoutSaving: number;
  scheduled: number; scheduledToDate: number; invoiced: Num; paid: Num; behindAmount: Num; behindCount: Num; billingKnown: boolean;
  costConnected: boolean; costAsOf: string | null; baselineApproved: boolean;
  lights: { margin: Light; cash: Light; delivery: Light };
  /** The margin bridge of the project, one amount per step (null = not known): Reports adds them up. */
  bridge: Record<BridgeStepId, Num>;
};

/** What the dashboard and Reports carry: the summary and one row per project the caller may see. `pending` = Contract projects need a database update. */
export type ProjectFinanceDash = {
  status: "ok"; summary: PortfolioSummary; rows: PortfolioRow[]; floor: number | null;
  /** The caller is a workspace admin: the next step under a Not connected figure is a link for them, plain words for everyone else. */
  isAdmin: boolean;
  settings: { dropPoints: number; cashDays: number; latePct: number };
};
/** `AnalyticsData.projectFinance`: null = the module is off or this person may not see cost and margin (nothing was read). */
export type ProjectFinanceAnalytics = ProjectFinanceDash | { status: "pending" } | null;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function toPortfolioRow(f: ProjectFinance): PortfolioRow {
  return {
    id: f.id, ref: f.ref, name: f.name, status: f.status, currency: f.currency, contractValue: f.contractValue, budget: f.budget,
    bridge: Object.fromEntries(f.bridge.map((b) => [b.id, b.amount])) as Record<BridgeStepId, Num>,
    plannedPct: f.planned?.pct ?? null, plannedComplete: f.planned?.complete ?? false, baselinePct: f.baseline?.pct ?? null, forecastPct: f.forecast?.pct ?? null,
    eac: f.cost.eac, costToComplete: f.cost.costToComplete, atRisk: f.atRisk, actual: f.actual.value, committed: f.committed.value,
    awarded: f.buyout.awarded, buyoutSaving: f.buyout.saving,
    scheduled: f.billing.scheduled, scheduledToDate: f.billing.scheduledToDate, invoiced: f.billing.invoiced, paid: f.billing.paid, behindAmount: f.billing.behind ? f.billing.behind.amount : null, behindCount: f.billing.behind ? f.billing.behind.count : null,
    billingKnown: f.billing.known, costConnected: f.costConnected, costAsOf: f.costAsOf, baselineApproved: f.baselineApproved, lights: f.lights,
  };
}

export type PortfolioFigure<T = number> = { value: T | null; of: number; total: number };
export type PortfolioSummary = {
  /** The active projects the totals speak for, those left out for lack of a baseline, and the one currency ("" = mixed, null = none). */
  counted: number;
  noBaseline: number;
  currency: string | "" | null;
  marginAtRisk: PortfolioFigure;
  forecastMargin: PortfolioFigure & { plannedPct: Num };
  costToComplete: PortfolioFigure;
  billingBehind: PortfolioFigure & { count: number };
  /** The cash picture: the billing plan always, invoiced and received only where they are known (null otherwise, never 0). */
  cash: { scheduled: number | null; scheduledToDate: number | null; invoiced: Num; received: Num; ofInvoiced: number };
  /** Projects at each level of the margin light. */
  marginLevels: Record<LightLevel, number>;
  /** "forecast": sorted by margin at risk (needs a connected cost); "plan": the lowest planned margins, while nothing is connected. */
  worst: { basis: "forecast" | "plan" | "none"; rows: PortfolioRow[] };
};

export function summarisePortfolio(all: readonly PortfolioRow[], opts: { onlyActive?: boolean } = {}): PortfolioSummary {
  const active = opts.onlyActive === false ? [...all] : all.filter((r) => r.status === "active");
  const based = active.filter((r) => r.baselineApproved);
  const currencies = new Set(based.map((r) => r.currency ?? ""));
  const currency = based.length === 0 ? null : currencies.size === 1 ? [...currencies][0] : "";
  const mixed = currency === "";
  const none = <T,>(of = 0): PortfolioFigure<T> => ({ value: null, of, total: based.length });

  const conn = based.filter((r) => r.costConnected && r.eac !== null);
  const sumOf = (rows: readonly PortfolioRow[], pick: (r: PortfolioRow) => Num): number => r2(rows.reduce((s, r) => s + (pick(r) ?? 0), 0));

  const marginAtRisk: PortfolioFigure = mixed || conn.length === 0 ? none(conn.length) : { value: sumOf(conn, (r) => r.atRisk), of: conn.length, total: based.length };
  const costToComplete: PortfolioFigure = mixed || conn.length === 0 ? none(conn.length) : { value: sumOf(conn, (r) => r.costToComplete), of: conn.length, total: based.length };
  const cv = sumOf(conn, (r) => r.contractValue);
  const forecastPct = mixed || conn.length === 0 ? null : ratioPct(cv - sumOf(conn, (r) => r.eac), cv);
  const planRows = based.filter((r) => r.plannedComplete && r.budget !== null);
  const planCv = sumOf(planRows, (r) => r.contractValue);
  const plannedPct = mixed || planRows.length === 0 ? null : ratioPct(planCv - sumOf(planRows, (r) => r.budget), planCv);
  const billing = based.filter((r) => r.billingKnown && r.behindAmount !== null);

  const worstForecast = [...conn].sort((a, b) => (b.atRisk ?? 0) - (a.atRisk ?? 0)).filter((r) => (r.atRisk ?? 0) > 0).slice(0, 5);
  const planRanked = [...based].filter((r) => r.plannedPct !== null).sort((a, b) => (a.plannedPct as number) - (b.plannedPct as number)).slice(0, 5);

  return {
    counted: based.length, noBaseline: active.length - based.length, currency,
    marginAtRisk,
    forecastMargin: { value: forecastPct, of: conn.length, total: based.length, plannedPct },
    costToComplete,
    billingBehind: mixed || billing.length === 0 ? { ...none(billing.length), count: 0 } : { value: sumOf(billing, (r) => r.behindAmount), of: billing.length, total: based.length, count: billing.reduce((s, r) => s + (r.behindCount ?? 0), 0) },
    cash: {
      scheduled: mixed || based.length === 0 ? null : sumOf(based, (r) => r.scheduled),
      scheduledToDate: mixed || based.length === 0 ? null : sumOf(based, (r) => r.scheduledToDate),
      invoiced: mixed || billing.length === 0 ? null : sumOf(billing, (r) => r.invoiced),
      received: mixed || billing.filter((r) => r.paid !== null).length === 0 ? null : sumOf(billing, (r) => r.paid),
      ofInvoiced: billing.length,
    },
    marginLevels: countLevels(based.map((r) => r.lights.margin)),
    worst: conn.length > 0 ? { basis: "forecast", rows: worstForecast } : planRanked.length > 0 ? { basis: "plan", rows: planRanked } : { basis: "none", rows: [] },
  };
}

const BRIDGE_ORDER: BridgeStepId[] = ["baseline", "variation_revenue", "variation_cost", "other_revisions", "buyout_saving", "after_buyout", "execution", "forecast"];
/**
 * The bridge of the whole portfolio: each step added up over the counted projects of one currency. A step that is unknown for any project
 * (the ERP cost is not connected) is unknown for the portfolio: a partial sum would read as a total.
 */
export function portfolioBridge(rows: readonly PortfolioRow[]): { id: BridgeStepId; amount: Num }[] | null {
  const based = rows.filter((r) => r.status === "active" && r.baselineApproved);
  if (based.length === 0 || new Set(based.map((r) => r.currency ?? "")).size > 1) return null;
  return BRIDGE_ORDER.map((id) => ({ id, amount: based.some((r) => r.bridge[id] === null) ? null : r2(based.reduce((t, r) => t + (r.bridge[id] as number), 0)) }));
}
