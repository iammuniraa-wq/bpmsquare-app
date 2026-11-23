import { describe, expect, it } from "vitest";
import { buildProjectFinance, type FinanceInputs } from "./model";
import { portfolioBridge, summarisePortfolio, toPortfolioRow, type PortfolioRow } from "./portfolio";
import type { ErpKindState } from "./state";
import type { FinanceSettings } from "./types";

const NOW = new Date("2026-11-24T06:00:00Z");
const settings: FinanceSettings = { visibility: "everyone", dropPoints: 5, cashDays: 30, latePct: 15, freshnessDays: 3, marginFloor: 10 };
const state = (kind: ErpKindState["kind"], over: Partial<ErpKindState> = {}): ErpKindState => ({ kind, linked: true, last_ok_at: "2026-11-23T06:00:00Z", last_status: "ok", row_count: 5, ...over });

function inputs(over: Partial<FinanceInputs> = {}): FinanceInputs {
  return {
    project: { id: "p1", ref: "CPR-0001", name: "Riyadh Block A", status: "active", currency: "SAR", contract_value: 1_000_000, manager_id: "u1", erp_system: "dynamics365", erp_id: "PRJ-1" },
    revisions: [
      { rev_no: 0, status: "superseded", total: 720_000, justification_code: null, approved_at: "2026-09-01T00:00:00Z" },
      { rev_no: 1, status: "approved", total: 800_000, justification_code: "client_variation", approved_at: "2026-10-01T00:00:00Z" },
    ],
    approvedLines: [
      { line_key: "a", resource_code: "11", amount: 500_000, client_amount: 600_000 },
      { line_key: "b", resource_code: "41", amount: 300_000, client_amount: 400_000 },
    ],
    packages: [],
    variations: [{ status: "approved", amount: 100_000, cost_amount: 60_000 }, { status: "submitted", amount: 25_000, cost_amount: 10_000 }, { status: "draft", amount: 9, cost_amount: 9 }],
    milestones: [
      { id: "m1", title: "Advance", due_date: "2026-10-01", basis: "percent", percent: 20, fixed_amount: null, status: "planned", invoice_id: null },
      { id: "m2", title: "Foundations", due_date: "2026-11-01", basis: "percent", percent: 30, fixed_amount: null, status: "planned", invoice_id: null },
    ],
    invoicesOn: false,
    buyout: [{ status: "awarded", budget: 300_000, committed: 280_000 }],
    erp: { states: {}, actual: new Map(), committed: new Map(), billedMilestones: new Set() },
    recorded: null, etg: [], settings, now: NOW, ...over,
  };
}

describe("buildProjectFinance without the ERP: the planned half is real, the rest is Not connected", () => {
  const f = buildProjectFinance(inputs());
  it("the planned half", () => {
    expect(f.baselineApproved).toBe(true);
    expect(f.budget).toBe(800_000);
    expect(f.originalContractValue).toBe(900_000);
    expect(f.baseline).toEqual({ amount: 180_000, pct: 20 });
    expect(f.planned).toMatchObject({ amount: 200_000, pct: 20, complete: true });
    expect(f.buyout).toEqual({ awarded: 280_000, saving: 20_000, packages: 1 });
    expect(f.pendingVariations).toEqual({ count: 1, amount: 25_000 });
  });
  it("every figure that needs the ERP is null with the words Not connected, never zero", () => {
    expect(f.actual).toEqual({ state: "not_connected", value: null, asOf: null });
    expect(f.committed.value).toBeNull();
    expect(f.cost.eac).toBeNull();
    expect(f.cost.costToComplete).toBeNull();
    expect(f.forecast).toBeNull();
    expect(f.atRisk).toBeNull();
    expect(f.variance).toBeNull();
    expect(f.costConnected).toBe(false);
    expect(f.costState).toBe("not_connected");
  });
  it("the bridge is real up to Buy-out and unknown after", () => {
    expect(f.bridge.map((b) => [b.id, b.amount])).toEqual([
      ["baseline", 180_000], ["variation_revenue", 100_000], ["variation_cost", -60_000], ["other_revisions", -20_000], ["buyout_saving", 20_000], ["after_buyout", 220_000], ["execution", null], ["forecast", null],
    ]);
  });
  it("billing: the plan is real, invoiced and behind are not known without invoices or an ERP billing read-back", () => {
    expect(f.billing.scheduledToDate).toBe(500_000);
    expect(f.billing.scheduled).toBe(500_000);
    expect(f.billing.known).toBe(false);
    expect(f.billing.behind).toBeNull();
    expect(f.billing.invoiced).toBeNull();
    expect(f.billing.paid).toBeNull();
  });
  it("the lights: nothing to measure says Not connected in words", () => {
    expect(f.lights.margin.level).toBe("not_connected");
    expect(f.lights.cash.level).toBe("not_connected");
    expect(f.lights.delivery.level).toBe("not_connected");
  });
  it("a typed estimate is kept and shown even though the forecast is not connected", () => {
    const g = buildProjectFinance(inputs({ etg: [{ wbs_code: "", resource_code: "11", amount: 40_000, note: null, entered_by: "u1", entered_at: "2026-11-20T00:00:00Z" }] }));
    expect(g.cost.typedEtg).toBe(40_000);
    expect(g.cost.eac).toBeNull();
  });
  it("a plan below the floor is a real finding even without a forecast", () => {
    const g = buildProjectFinance(inputs({ project: { ...inputs().project, contract_value: 850_000 } }));
    expect(g.planned?.pct).toBeLessThan(10);
    expect(g.lights.margin).toMatchObject({ level: "plan_watch", word: "Plan below floor" });
  });
});

describe("a project whose baseline is not approved is left out, not zeroed", () => {
  const f = buildProjectFinance(inputs({ revisions: [{ rev_no: 0, status: "draft", total: 720_000, justification_code: null, approved_at: null }], approvedLines: null }));
  it("has no budget, no margins, no bridge numbers and says why", () => {
    expect(f.baselineApproved).toBe(false);
    expect(f.excluded).toBe("baseline_not_approved");
    expect(f.budget).toBeNull();
    expect(f.baseline).toBeNull();
    expect(f.planned).toBeNull();
    expect(f.cost.cells).toEqual([]);
    expect(f.bridge.find((b) => b.id === "baseline")!.amount).toBeNull();
  });
});

describe("billing known from BPMSquare invoices or from the ERP", () => {
  it("with the invoices module on, an issued invoice counts and a draft does not; behind and the cash light follow", () => {
    const f = buildProjectFinance(inputs({
      invoicesOn: true,
      milestones: [
        { id: "m1", title: "Advance", due_date: "2026-10-01", basis: "percent", percent: 20, fixed_amount: null, status: "invoiced", invoice_id: "i1", invoice_status: "paid" },
        { id: "m2", title: "Foundations", due_date: "2026-09-20", basis: "percent", percent: 30, fixed_amount: null, status: "invoiced", invoice_id: "i2", invoice_status: "draft" },
      ],
    }));
    expect(f.billing).toMatchObject({ known: true, scheduledToDate: 500_000, invoiced: 200_000, paid: 200_000 });
    expect(f.billing.behind).toMatchObject({ count: 1, amount: 300_000, oldestDays: 65 });
    expect(f.lights.cash.level).toBe("risk");
  });
  it("with an ERP billing read-back, milestones the ERP reports as invoiced are billed", () => {
    const f = buildProjectFinance(inputs({ erp: { states: { billed: state("billed") }, actual: new Map(), committed: new Map(), billedMilestones: new Set(["m1"]) } }));
    expect(f.billing.known).toBe(true);
    expect(f.billing.behind).toMatchObject({ count: 1, amount: 300_000 });
    expect(f.billing.paid).toBeNull();
  });
});

describe("with the cost read back (a later pull)", () => {
  const erp = {
    states: { cost_actual: state("cost_actual"), cost_committed: state("cost_committed") },
    actual: new Map([["|11", 250_000], ["|41", 100_000]]),
    committed: new Map([["|11", 200_000], ["|41", 200_000]]),
    billedMilestones: new Set<string>(),
  };
  it("forecast, cost to complete, variance and margin at risk follow the formulas, and the lights move", () => {
    const f = buildProjectFinance(inputs({ erp, etg: [{ wbs_code: "", resource_code: "11", amount: 100_000, note: null, entered_by: null, entered_at: null }] }));
    // cell 11: A 250 + O 200 + typed 100 = 550; cell 41: A 100 + O 200 + default max(300-100-200, 0) = 300 -> EAC 850
    expect(f.cost).toMatchObject({ actual: 350_000, committed: 400_000, etg: 100_000, eac: 850_000, costToComplete: 500_000 });
    expect(f.costConnected).toBe(true);
    expect(f.variance).toEqual({ amount: -50_000, pct: -6.2 });
    expect(f.forecast).toEqual({ amount: 150_000, pct: 15 });
    expect(f.atRisk).toBe(50_000);
    expect(f.bridge.find((b) => b.id === "forecast")!.amount).toBe(150_000);
    expect(f.bridge.find((b) => b.id === "execution")!.amount).toBe(-70_000);
    expect(f.lights.margin.level).toBe("risk");
    expect(f.actual).toMatchObject({ state: "live", value: 350_000 });
  });
  it("recorded site expenses (when that module supplies them) add to the posted actual per cell, shown without double counting", () => {
    const f = buildProjectFinance(inputs({ erp, recorded: new Map([["|11", 5_000]]) }));
    expect(f.cost.actual).toBe(355_000);
    expect(f.recordedOnSite).toBe(5_000);
  });
  it("a linked project with a pull that held nothing is a real zero, 'nothing posted yet'", () => {
    const f = buildProjectFinance(inputs({ erp: { ...erp, states: { cost_actual: state("cost_actual", { row_count: 0 }), cost_committed: state("cost_committed", { row_count: 0 }) }, actual: new Map(), committed: new Map() } }));
    expect(f.costState).toBe("nothing_posted");
    expect(f.cost.actual).toBe(0);
    expect(f.actual).toMatchObject({ state: "nothing_posted", value: 0 });
    expect(f.cost.eac).toBe(800_000);
  });
  it("a stale pull still shows its number, flagged stale", () => {
    const f = buildProjectFinance(inputs({ erp: { ...erp, states: { cost_actual: state("cost_actual", { last_ok_at: "2026-11-10T00:00:00Z" }), cost_committed: state("cost_committed") } } }));
    expect(f.costState).toBe("stale");
    expect(f.cost.eac).not.toBeNull();
  });
  it("cost with only one of the two kinds landed is still Not connected for the forecast", () => {
    const f = buildProjectFinance(inputs({ erp: { ...erp, states: { cost_actual: state("cost_actual") } } }));
    expect(f.cost.committed).toBeNull();
    expect(f.cost.eac).toBeNull();
    expect(f.costConnected).toBe(false);
  });
});

describe("the portfolio", () => {
  const row = (over: Partial<PortfolioRow> = {}): PortfolioRow => ({
    ...toPortfolioRow(buildProjectFinance(inputs())), ...over,
  });
  const connected = (id: string, eac: number, atRisk: number | null, over: Partial<PortfolioRow> = {}) => row({ id, costConnected: true, eac, atRisk, costToComplete: 100, ...over });

  it("with nothing connected the money tiles say Not connected, and the worst list falls back to the lowest planned margin", () => {
    const sm = summarisePortfolio([row({ id: "a", plannedPct: 12 }), row({ id: "b", plannedPct: 4 }), row({ id: "c", status: "draft" })]);
    expect(sm.counted).toBe(2);
    expect(sm.marginAtRisk.value).toBeNull();
    expect(sm.forecastMargin.value).toBeNull();
    expect(sm.forecastMargin.plannedPct).toBe(20);
    expect(sm.costToComplete.value).toBeNull();
    expect(sm.billingBehind.value).toBeNull();
    expect(sm.worst.basis).toBe("plan");
    expect(sm.worst.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("totals only the connected projects and says how many ('5 of 6')", () => {
    const sm = summarisePortfolio([connected("a", 850_000, 50_000), connected("b", 700_000, 0), row({ id: "c" })]);
    expect(sm.marginAtRisk).toEqual({ value: 50_000, of: 2, total: 3 });
    expect(sm.costToComplete).toEqual({ value: 200, of: 2, total: 3 });
    expect(sm.forecastMargin.value).toBe(22.5);
    expect(sm.worst.basis).toBe("forecast");
    expect(sm.worst.rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("leaves out a project with no approved baseline and counts it", () => {
    const sm = summarisePortfolio([row({ id: "a" }), row({ id: "z", baselineApproved: false, costConnected: true, eac: 1, atRisk: 99 })]);
    expect(sm.counted).toBe(1);
    expect(sm.noBaseline).toBe(1);
    expect(sm.marginAtRisk.value).toBeNull();
  });
  it("blanks every total across currencies, with the currency empty", () => {
    const sm = summarisePortfolio([connected("a", 850_000, 50_000, { currency: "SAR" }), connected("b", 700_000, 0, { currency: "AED" })]);
    expect(sm.currency).toBe("");
    expect(sm.marginAtRisk.value).toBeNull();
    expect(sm.forecastMargin.value).toBeNull();
    expect(sm.cash.scheduled).toBeNull();
    expect(portfolioBridge([connected("a", 1, 0, { currency: "SAR" }), connected("b", 1, 0, { currency: "AED" })])).toBeNull();
  });
  it("behind on billing totals the projects whose billing is known; the cash card shows the plan always, invoiced only where known", () => {
    const known = row({ id: "a", billingKnown: true, behindAmount: 300, behindCount: 2, invoiced: 200, paid: 100 });
    const unknown = row({ id: "b" });
    const sm = summarisePortfolio([known, unknown]);
    expect(sm.billingBehind).toMatchObject({ value: 300, of: 1, total: 2, count: 2 });
    expect(sm.cash).toMatchObject({ scheduled: 1_000_000, scheduledToDate: 1_000_000, invoiced: 200, received: 100, ofInvoiced: 1 });
    expect(summarisePortfolio([unknown]).cash).toMatchObject({ invoiced: null, received: null });
  });
  it("the portfolio bridge adds each step over the projects and stays unknown where any project cannot tell", () => {
    const b = portfolioBridge([row({ id: "a" }), row({ id: "b" })])!;
    expect(b.find((x) => x.id === "baseline")!.amount).toBe(360_000);
    expect(b.find((x) => x.id === "after_buyout")!.amount).toBe(440_000);
    expect(b.find((x) => x.id === "execution")!.amount).toBeNull();
    expect(b.find((x) => x.id === "forecast")!.amount).toBeNull();
  });
  it("counts the margin lights for the donut", () => {
    const sm = summarisePortfolio([row({ id: "a" }), row({ id: "b" })]);
    expect(sm.marginLevels.not_connected).toBe(2);
  });
});
