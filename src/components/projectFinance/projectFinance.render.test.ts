import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { href: string; children: unknown }) => create("a", rest, children as never),
}));

import HealthCard from "./HealthCard";
import CostBar from "./CostBar";
import MarginBridge from "./MarginBridge";
import ForecastPanel from "./ForecastPanel";
import ProjectProfitability from "./ProjectProfitability";
import { pfBlockSpec } from "./PfBlocks";
import { buildProjectFinance, type FinanceInputs } from "@/lib/projectFinance/model";
import { summarisePortfolio, toPortfolioRow, type ProjectFinanceAnalytics } from "@/lib/projectFinance/portfolio";
import type { ErpKindState } from "@/lib/projectFinance/state";
import type { FinanceSettings } from "@/lib/projectFinance/types";

// What a person sees: the planned half is real, everything that needs the ERP says "Not connected" and one next step, a real zero reads as a
// zero only after a pull that held nothing, and the explanations stay behind the i.

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const NOW = new Date("2026-11-24T06:00:00Z");
const settings: FinanceSettings = { visibility: "everyone", dropPoints: 5, cashDays: 30, latePct: 15, freshnessDays: 3, marginFloor: 10 };
const st = (kind: ErpKindState["kind"], over: Partial<ErpKindState> = {}): ErpKindState => ({ kind, linked: true, last_ok_at: "2026-11-23T06:00:00Z", last_status: "ok", row_count: 4, ...over });

function inputs(over: Partial<FinanceInputs> = {}): FinanceInputs {
  return {
    project: { id: "p1", ref: "CPR-0001", name: "Riyadh Block A", status: "active", currency: "SAR", contract_value: 1_000_000, manager_id: "u1", erp_system: null, erp_id: null },
    revisions: [{ rev_no: 0, status: "approved", total: 800_000, justification_code: null, approved_at: "2026-09-01T00:00:00Z" }],
    approvedLines: [{ line_key: "a", resource_code: "11", amount: 500_000, client_amount: 600_000 }, { line_key: "b", resource_code: "41", amount: 300_000, client_amount: 400_000 }],
    packages: [], variations: [], milestones: [{ id: "m", title: "Advance", due_date: "2026-10-01", basis: "percent", percent: 20, fixed_amount: null, status: "planned", invoice_id: null }],
    invoicesOn: false, buyout: [{ status: "awarded", budget: 300_000, committed: 280_000 }],
    erp: { states: {}, actual: new Map(), committed: new Map(), billedMilestones: new Set() }, recorded: null, etg: [], settings, now: NOW, ...over,
  };
}
const planned = buildProjectFinance(inputs());
const connected = buildProjectFinance(inputs({
  erp: { states: { cost_actual: st("cost_actual"), cost_committed: st("cost_committed") }, actual: new Map([["|11", 250_000], ["|41", 100_000]]), committed: new Map([["|11", 200_000], ["|41", 200_000]]), billedMilestones: new Set() },
  etg: [{ wbs_code: "", resource_code: "11", amount: 100_000, note: null, entered_by: null, entered_at: null }],
}));

describe("Health card", () => {
  it("planned only: three lights as words, the four numbers, Not connected where the ERP is needed, and one next step", () => {
    const out = html(createElement(HealthCard, { finance: planned, isAdmin: true, floor: 10, forecastTab: true }));
    expect(out).toContain("Margin");
    expect(out).toContain("Cash");
    expect(out).toContain("Delivery");
    expect(out).toContain("Not connected");
    expect(out).toContain("Forecast margin");
    expect(out).toContain("Plan 20%");
    expect(out).toContain("Connect the ERP cost read-back");
    expect(out).toContain("/settings/");
    expect(out).toContain("tab=forecast");
    expect(out).not.toMatch(/Cost to complete.{0,200}SAR 0/);
  });
  it("for a person who is not an admin the next step is plain words, not a link", () => {
    const out = html(createElement(HealthCard, { finance: planned, isAdmin: false, floor: 10, forecastTab: false }));
    expect(out).toContain("Needs the ERP cost read-back");
    expect(out).not.toContain("Connect the ERP cost read-back");
    expect(out).not.toContain("tab=forecast");
  });
  it("connected: the numbers, with the as-of line, and no next step for the cost", () => {
    const out = html(createElement(HealthCard, { finance: connected, isAdmin: true, floor: 10, forecastTab: true }));
    expect(out).toContain("15%");
    expect(out).toContain("SAR 500,000");
    expect(out).toContain("as of 23 Nov");
    expect(out).toContain("At risk");
  });
  it("a project whose baseline is not approved says so instead of showing zeros", () => {
    const f = buildProjectFinance(inputs({ revisions: [{ rev_no: 0, status: "draft", total: 800_000, justification_code: null, approved_at: null }], approvedLines: null }));
    const out = html(createElement(HealthCard, { finance: f, isAdmin: true, floor: 10, forecastTab: true }));
    expect(out).toContain("Baseline not approved");
    expect(out).not.toContain("Forecast margin");
  });
  it("keeps the explanations behind an i", () => {
    const out = html(createElement(HealthCard, { finance: planned, isAdmin: true, floor: 10, forecastTab: true }));
    expect(out).toContain("About Forecast margin");
    expect(out).not.toContain("Contract value less the forecast cost");
  });
});

describe("cost bar", () => {
  it("not connected: shows the awards against the budget and Not connected for the rest", () => {
    const out = html(createElement(CostBar, { finance: planned, isAdmin: true }));
    expect(out).toContain("Awarded in Buy-out SAR 280,000");
    expect(out).toContain("Budget SAR 800,000");
    expect(out).toContain("Not connected");
  });
  it("connected: actual, committed and the estimate to go with the over-budget words", () => {
    const out = html(createElement(CostBar, { finance: connected, isAdmin: true }));
    expect(out).toContain("Actual SAR 350,000");
    expect(out).toContain("Committed SAR 400,000");
    expect(out).toContain("Estimate to go SAR 100,000");
    expect(out).toContain("Over the budget by SAR 50,000");
    expect(out).toContain("spent or committed");
  });
});

describe("margin bridge", () => {
  it("draws the waterfall and the phone rows from the same steps; the steps that need the ERP say so", () => {
    const out = html(createElement(MarginBridge, { steps: planned.bridge, currency: "SAR" }));
    expect(out).toContain("Needs ERP cost");
    expect(out).toContain("Baseline margin");
    expect(out).toContain("After buy-out");
    expect(out).toContain("pf-hatch");
  });
  it("connected: no hatched step", () => {
    const out = html(createElement(MarginBridge, { steps: connected.bridge, currency: "SAR" }));
    expect(out).not.toContain("Needs ERP cost");
    expect(out).toContain("Forecast margin");
  });
});

describe("forecast table", () => {
  const props = (f: typeof planned, over: object = {}) => ({ projectId: "p1", currency: "SAR", cells: f.cost.cells, labels: { resource: { "11": "Material", "41": "Sub Contractor" }, wbs: {} }, entries: [], connected: f.costConnected, canEdit: true, etgMissing: false, ...over });
  it("not connected: budget per category, Not connected for the facts, and the typed estimate kept", () => {
    const out = html(createElement(ForecastPanel, props(planned)));
    expect(out).toContain("Material");
    expect(out).toContain("Sub Contractor");
    expect(out).toContain("SAR 500,000");
    expect(out).toContain("Not connected");
    expect(out).toContain("Update forecast");
    expect(out).toContain("What you type here is kept");
  });
  it("a view-only person gets no save bar, and a pending migration says so", () => {
    expect(html(createElement(ForecastPanel, props(planned, { canEdit: false })))).not.toContain("Update forecast");
    const out = html(createElement(ForecastPanel, props(planned, { etgMissing: true })));
    expect(out).toContain("migration 0261");
    expect(out).not.toContain("Update forecast");
  });
  it("connected: the forecast per category", () => {
    const out = html(createElement(ForecastPanel, props(connected)));
    expect(out).toContain("SAR 550,000");
    expect(out).not.toContain("Not connected");
  });
});

describe("dashboard blocks", () => {
  const dash = (rows: ReturnType<typeof toPortfolioRow>[], isAdmin = true): ProjectFinanceAnalytics => ({ status: "ok", summary: summarisePortfolio(rows), rows, floor: 10, isAdmin, settings: { dropPoints: 5, cashDays: 30, latePct: 15 } });
  const spec = (id: string, d: ProjectFinanceAnalytics) => pfBlockSpec(id as never, d);
  const body = (id: string, d: ProjectFinanceAnalytics) => html(createElement("div", null, spec(id, d)!.body as never));

  it("draws nothing for a person who may not see cost and margin", () => {
    for (const id of ["pf_margin_at_risk", "pf_forecast_margin", "pf_cost_to_complete", "pf_billing_behind", "pf_portfolio", "pf_cash"]) expect(spec(id, null), id).toBeNull();
    expect(pfBlockSpec("accounts" as never, dash([]))).toBeNull();
  });
  it("planned only: the four tiles say Not connected with the one next step, never a zero", () => {
    const d = dash([toPortfolioRow(planned)]);
    for (const id of ["pf_margin_at_risk", "pf_cost_to_complete", "pf_billing_behind"]) {
      const out = body(id, d);
      expect(out, id).toContain("Not connected");
      expect(out, id).not.toMatch(/SAR 0\b/);
    }
    expect(body("pf_forecast_margin", d)).toContain("Planned margin 20%");
    expect(body("pf_margin_at_risk", d)).toContain("Connect the ERP cost read-back");
    expect(body("pf_margin_at_risk", dash([toPortfolioRow(planned)], false))).toContain("Needs the ERP cost read-back");
  });
  it("connected: the totals say how many projects they speak for", () => {
    const d = dash([toPortfolioRow(connected), toPortfolioRow(planned)]);
    const out = body("pf_margin_at_risk", d);
    expect(out).toContain("SAR 50,000");
    expect(out).toContain("1 of 2 projects");
    expect(body("pf_forecast_margin", d)).toContain("15%");
  });
  it("the portfolio card: the lights in words and the lowest planned margins while nothing is connected", () => {
    const out = body("pf_portfolio", dash([toPortfolioRow(planned)]));
    expect(out).toContain("Not connected");
    expect(out).toContain("Lowest planned margin");
    expect(out).toContain("CPR-0001");
  });
  it("the cash card shows the plan and says Not connected for invoiced and received", () => {
    const out = body("pf_cash", dash([toPortfolioRow(planned)]));
    expect(out).toContain("Planned to bill");
    expect(out).toContain("SAR 200,000");
    expect(out).toContain("Not connected");
  });
  it("a workspace whose Contract projects need a database update gets one calm line", () => {
    expect(body("pf_portfolio", { status: "pending" })).toContain("not set up yet");
  });
});

describe("Reports table", () => {
  it("one row per project with every column, Not connected cells in words, and a CSV button", () => {
    const d = { status: "ok" as const, summary: summarisePortfolio([toPortfolioRow(planned)]), rows: [toPortfolioRow(planned)], floor: 10, isAdmin: true, settings: { dropPoints: 5, cashDays: 30, latePct: 15 } };
    const out = html(createElement(ProjectProfitability, { data: d }));
    for (const h of ["Baseline margin", "Planned margin", "Awarded in Buy-out", "Buy-out saving", "Forecast cost", "Margin at risk", "Cost to complete", "Behind on billing", "Margin light"]) expect(out, h).toContain(h);
    expect(out).toContain("Not connected");
    expect(out).toContain("Download CSV");
    expect(out).toContain("Needs ERP cost");
  });
});
