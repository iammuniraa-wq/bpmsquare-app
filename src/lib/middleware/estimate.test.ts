import { describe, it, expect } from "vitest";
import { shapeEstimate, estimateSummaryText, costBreakdown, type EstimateInfo } from "./estimate";
import { parseRules } from "./rules";
import { buildBomRows, buildWbsRows, type ExportLineInput } from "@/lib/estimator/exports";
import type { OutLine } from "./fence";

const est: EstimateInfo = {
  name: "Villa precast package", ref: "EST-0007", params: { floors: 2, area_m2: 180, finish: "exposed aggregate", has_basement: false },
  notes: "Risk: crane access narrow\nsecond line",
  totals: { cost_total: 80000, margin_pct: 20, margin_amount: 16000, price: 96000, by_component: { materials: 50000, labour: 20000, transport: 5000, erection: 5000 } },
};
const exportLines: ExportLineInput[] = [
  { code: "L1", sku: "PNL-120", description: "Wall panel 120", uom: "pcs", qty: 40, waste_pct: 5, unit_cost: 1000, cost_total: 42000, group: "Walls", group_key: "walls", component: "materials", sort_order: 1 },
  { code: "L2", sku: null, description: "Casting labour", uom: "h", qty: 200, unit_cost: 100, cost_total: 20000, group: "Walls", group_key: "walls", component: "labour", sort_order: 2 },
  { code: "L3", sku: "SLB-200", description: "Slab 200", uom: "pcs", qty: 10, unit_cost: 800, cost_total: 8000, group: "Slabs", group_key: "slabs", component: "materials", sort_order: 3 },
];
const quoteLines: OutLine[] = [
  { sl_no: "1", description: "Precast walls", uom: null, qty: 1, rate: 70000, discount_pct: 0, amount: 70000 },
  { sl_no: "2", description: "Slabs", uom: null, qty: 1, rate: 26000, discount_pct: 0, amount: 26000 },
];
const sel = (over: Record<string, boolean> = {}) => ({ ...parseRules({}).estimate, ...over });
const run = (target: "quote" | "project", selection = sel(), profileKey = "dynamics365") =>
  shapeEstimate({ target, selection, estimate: est, exportLines, quoteLines, quoteSubtotal: 96000, profileKey });

describe("estimate -> Quote target (Dynamics Sales): prices only", () => {
  it("sends the summary and the customer-price lines", () => {
    const r = run("quote");
    expect(r.lines).toEqual(quoteLines);
    expect(r.description.join("\n")).toContain("EST-0007 · Villa precast package: Floors 2, Area m2 180, Finish exposed aggregate, Has basement no");
    expect(r.description.join("\n")).toContain("Note: Risk: crane access narrow");
    expect(r.included).toEqual(["Estimate summary", "Quote lines at customer prices"]);
  });

  it("refuses BOM, WBS and internal costs even when they are ticked, and says why", () => {
    const r = run("quote", sel({ bom: true, wbs: true, internal_costs: true }));
    expect(r.tasks).toBeNull();
    expect(r.bom).toBeNull();
    expect(r.costs).toBeNull();
    // bom and wbs are on by default and just do not apply here; the deliberate opt-in is reported
    expect(r.refused.map((x) => x.part)).toEqual(["internal_costs"]);
    expect(r.refused[0].hint).toMatch(/carries prices only/);
    // no cost figure leaks into the customer-facing text
    expect(r.description.join("\n")).not.toMatch(/Internal costs|Materials 50000/);
  });

  it("with quote lines unticked, one line carries the total", () => {
    const r = run("quote", sel({ quote_lines: false }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amount).toBe(96000);
  });
});

describe("estimate -> Project target (F&O, Business Central): tasks and BOM", () => {
  it("includes WBS tasks and BOM lines built by the estimator's own builders", () => {
    const r = run("project");
    expect(r.lines).toEqual([]);
    expect(r.tasks).not.toBeNull();
    expect(r.bom).not.toBeNull();
    // the same rows the estimator's builders produce, under the Dynamics profile's headers
    expect(r.tasks!.map((t) => t.WBSId)).toEqual(buildWbsRows(exportLines).map((t) => t.code));
    expect(r.bom!.map((b) => b.ItemNumber)).toEqual(buildBomRows(exportLines).map((b) => b.item_number));
    expect(r.bom![0].Quantity).toBe(42);
  });

  it("internal costs are OFF by default: no cost column reaches a BOM or WBS row", () => {
    const r = run("project");
    for (const row of [...r.tasks!, ...r.bom!]) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["CostPrice"]));
      expect(Object.keys(row)).not.toContain("LineAmount");
      expect(Object.keys(row)).not.toContain("PlannedCost");
    }
    expect(r.costs).toBeNull();
    expect(r.description.join("\n")).not.toMatch(/Internal costs/);
  });

  it("only when explicitly ticked do the cost columns and the breakdown go", () => {
    const r = run("project", sel({ internal_costs: true }));
    expect(Object.keys(r.bom![0])).toEqual(expect.arrayContaining(["CostPrice", "LineAmount"]));
    expect(Object.keys(r.tasks![0])).toContain("PlannedCost");
    expect(r.costs).toEqual(costBreakdown(est));
    expect(r.description.join("\n")).toContain("Internal costs: Materials 50000.00");
    expect(r.included).toContain("Internal cost breakdown");
  });

  it("each of BOM and WBS can be switched off on its own", () => {
    expect(run("project", sel({ bom: false })).bom).toBeNull();
    expect(run("project", sel({ wbs: false })).tasks).toBeNull();
    expect(run("project", sel({ summary: false })).description).toEqual([]);
  });

  it("an unknown profile falls back to the generic columns", () => {
    const r = run("project", sel(), "nonsense");
    expect(Object.keys(r.bom![0])).toContain("item_number");
  });
});

describe("estimate text helpers", () => {
  it("summary falls back to the name when there are no parameters", () => {
    expect(estimateSummaryText({ ...est, params: null, notes: null })).toEqual(["EST-0007 · Villa precast package"]);
  });

  it("cost breakdown lists the components, the total and the margin", () => {
    const rows = costBreakdown(est)!;
    expect(rows.map((r) => r.label)).toEqual(["Materials", "Labour", "Transport", "Erection", "Cost total", "Margin (20%)"]);
    expect(costBreakdown({ ...est, totals: null })).toBeNull();
  });
});
