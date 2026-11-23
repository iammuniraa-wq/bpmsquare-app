import type { MarginCoverage } from "@/lib/contractProjects/budget";
import type { WorkPackageRow } from "@/lib/contractProjects/types";
import { milestoneTotals } from "@/lib/contractProjects/milestones";
import { variationTotals } from "@/lib/contractProjects/variations";
import { lightsOf } from "./lights";
import {
  baselineMargin, behindOnBilling, budgetCells, buyoutAwards, costForecast, costVariance, coverageOfLines, forecastMargin, marginAtRisk, marginBridge, plannedMarginOf, scheduledToDate,
  type BehindOnBilling, type BillingMilestone, type BridgeStep, type BudgetLineForCells, type BuyoutAwards, type BuyoutPackage, type CellKey, type CostForecast, type CostVariance,
  type MarginFigure, type PlannedMargin,
} from "./rules";
import { connectionState, reading, worstState, type ErpKindState } from "./state";
import type { ConnState, ErpKind, FinanceSettings, Lights, Num, Reading } from "./types";

// One project's finance, built from what the loader read. PURE: the loader does the I/O, this decides every figure (rules.ts), every state
// (state.ts) and every light (lights.ts), so a test feeds it inputs and reads the answer a person would see.

export type EtgEntry = { wbs_code: string; resource_code: string; amount: number; note: string | null; entered_by: string | null; entered_by_name?: string | null; entered_at: string | null };

export type FinanceInputs = {
  project: { id: string; ref: string | null; name: string; status: string; currency: string | null; contract_value: number; manager_id: string | null; erp_system: string | null; erp_id: string | null };
  revisions: { rev_no: number; status: string; total: number; justification_code: string | null; approved_at: string | null }[];
  /** The lines of the approved revision; null while there is none (the baseline is not approved). */
  approvedLines: (BudgetLineForCells & { client_amount: number | null })[] | null;
  packages: readonly (Pick<WorkPackageRow, "id" | "code" | "line_keys" | "line_parts"> & { name?: string })[];
  variations: { status: string; amount: number; cost_amount: number }[];
  milestones: (BillingMilestone & { id?: string })[];
  /** BPMSquare's own Invoices module is on, so a milestone's invoice status is known from it. */
  invoicesOn: boolean;
  buyout: BuyoutPackage[];
  erp: {
    states: Partial<Record<ErpKind, ErpKindState>>;
    /** Posted and committed cost per cell, when the read-back has landed; empty maps otherwise. */
    actual: ReadonlyMap<CellKey, number>;
    committed: ReadonlyMap<CellKey, number>;
    /** Milestones the ERP reports as invoiced (by milestone id). */
    billedMilestones: ReadonlySet<string>;
  };
  /** Approved site expenses the ERP has not posted yet, per cell (the site-expenses design). Null until that module supplies it: nothing is added. */
  recorded: ReadonlyMap<CellKey, number> | null;
  etg: EtgEntry[];
  settings: FinanceSettings;
  now: Date;
};

export type ProjectFinance = {
  id: string; ref: string | null; name: string; status: string; currency: string | null; manager_id: string | null;
  contractValue: number;
  originalContractValue: number;
  /** Variations waiting for approval: shown beside the revenue step, never counted. */
  pendingVariations: { count: number; amount: number };
  baselineApproved: boolean;
  /** B: the approved revision's total. Null until a baseline is approved. */
  budget: Num;
  baselineTotal: Num;
  baseline: MarginFigure | null;
  planned: PlannedMargin | null;
  coverage: MarginCoverage | null;
  buyout: BuyoutAwards;
  /** Posted and committed, in the states they were read in. */
  actual: Reading;
  committed: Reading;
  /** Recorded on site (approved site expenses not yet posted): shown alone, as partial, while posted cost is Not connected. */
  recordedOnSite: Num;
  cost: CostForecast;
  /** The worst state of the facts behind the forecast. */
  costState: ConnState;
  costAsOf: string | null;
  costConnected: boolean;
  variance: CostVariance | null;
  forecast: MarginFigure | null;
  atRisk: Num;
  bridge: BridgeStep[];
  billing: {
    known: boolean;
    scheduledToDate: number;
    scheduled: number;
    /** What the issued invoices add up to and what was paid; null while billing is not known (never 0). */
    invoiced: Num;
    paid: Num;
    behind: BehindOnBilling | null;
  };
  lights: Lights;
  etg: EtgEntry[];
  /** Why this project is left out of portfolio totals, or null. */
  excluded: "baseline_not_approved" | null;
};

const sum = (xs: readonly number[]) => Math.round(xs.reduce((s, v) => s + v, 0) * 100) / 100;

function mergeMaps(a: ReadonlyMap<CellKey, number>, b: ReadonlyMap<CellKey, number> | null): Map<CellKey, number> {
  const out = new Map(a);
  if (b) for (const [k, v] of b) out.set(k, Math.round(((out.get(k) ?? 0) + v) * 100) / 100);
  return out;
}

export function buildProjectFinance(i: FinanceInputs): ProjectFinance {
  const { project: p, settings } = i;
  const approved = i.revisions.find((r) => r.status === "approved") ?? null;
  const revision0 = i.revisions.find((r) => r.rev_no === 0) ?? null;
  // Revision 0 is the baseline once it has been approved (it is superseded when the next revision is approved).
  const baselineApproved = !!approved && !!revision0 && (revision0.status === "approved" || revision0.status === "superseded" || revision0.approved_at !== null);
  const budget = baselineApproved && approved ? approved.total : null;
  const baselineTotal = baselineApproved && revision0 ? revision0.total : null;
  const vt = variationTotals(i.variations as never, p.contract_value);
  const coverage = baselineApproved && i.approvedLines ? coverageOfLines(i.approvedLines) : null;

  const baseline = baselineMargin({ contractValue: p.contract_value, approvedVariations: vt.approved, baselineTotal });
  const planned = plannedMarginOf(p.contract_value, budget, coverage);
  const buyout = buyoutAwards(i.buyout);

  // The cost facts and their states. A fact that has not landed is Not connected: null, never 0.
  const now = i.now;
  const aState = connectionState(i.erp.states.cost_actual, now, settings.freshnessDays);
  const oState = connectionState(i.erp.states.cost_committed, now, settings.freshnessDays);
  const postedCells = aState.state === "not_connected" ? null : i.erp.actual;
  const actualMap = postedCells ? mergeMaps(postedCells, i.recorded) : null;
  const committedMap = oState.state === "not_connected" ? null : i.erp.committed;
  const cells = baselineApproved && i.approvedLines ? budgetCells(i.approvedLines, i.packages) : [];
  const typed = new Map<CellKey, number>(i.etg.map((e) => [`${e.wbs_code}|${e.resource_code}`, e.amount]));
  const cost = costForecast({ cells, actual: actualMap, committed: committedMap, typed });
  const recordedOnSite = i.recorded ? sum([...i.recorded.values()]) : null;

  const costState = worstState([aState.state, oState.state]);
  const costConnected = costState !== "not_connected" && cost.eac !== null;
  const eac = baselineApproved ? cost.eac : null;
  const forecast = forecastMargin(p.contract_value, eac);
  const atRisk = marginAtRisk(budget, eac);

  const billedKnown = connectionState(i.erp.states.billed, now, settings.freshnessDays).state !== "not_connected";
  const billingKnown = i.invoicesOn || billedKnown;
  const milestones = i.invoicesOn ? i.milestones : billedKnown
    ? i.milestones.map((m) => (m.id && i.erp.billedMilestones.has(m.id) ? { ...m, status: "invoiced" as const, invoice_id: m.invoice_id ?? "erp", invoice_status: "sent" } : m))
    : i.milestones;
  const behind = behindOnBilling(milestones, p.contract_value, now, billingKnown);
  const mt = milestoneTotals(milestones, p.contract_value);

  const lights = lightsOf({ forecastPct: forecast?.pct ?? null, plannedPct: planned?.complete ? planned.pct : null, behind, settings });

  return {
    id: p.id, ref: p.ref, name: p.name, status: p.status, currency: p.currency, manager_id: p.manager_id,
    contractValue: p.contract_value, originalContractValue: vt.original, pendingVariations: { count: vt.pendingCount, amount: vt.pending },
    baselineApproved, budget, baselineTotal, baseline, planned, coverage, buyout,
    actual: reading(aState.state, aState.asOf, cost.actual), committed: reading(oState.state, oState.asOf, cost.committed), recordedOnSite,
    cost, costState, costAsOf: aState.asOf ?? oState.asOf, costConnected, variance: baselineApproved ? costVariance(budget, eac) : null, forecast, atRisk,
    bridge: marginBridge({ contractValue: p.contract_value, approvedVariations: vt.approved, approvedVariationCost: vt.approvedCost, baselineTotal, budget, buyoutSaving: buyout.saving, eac }),
    billing: {
      known: billingKnown, scheduledToDate: scheduledToDate(milestones, p.contract_value, now), scheduled: mt.scheduled,
      invoiced: billingKnown ? mt.invoiced : null, paid: i.invoicesOn ? mt.paid : null, behind,
    },
    lights, etg: i.etg, excluded: baselineApproved ? null : "baseline_not_approved",
  };
}
