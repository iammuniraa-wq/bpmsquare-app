import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { mapTenderToBudget, type BoqInfo, type DealLine } from "@/lib/contractProjects/fromTender";
import { buildSnapshot } from "@/lib/tender/bids/rules";
import { PRICE_SOURCE_LABEL } from "@/lib/tender/boq/price";
import { ESTIMATE_TIPS } from "./tips";
import { budgetPartsForBoqLine } from "./budgetParts";
import { proposeByMatch, proposeSpread, reshare, sharesWithin } from "./allocate";
import { missingRfqLines, missingReasonText } from "./rfqLines";
import {
  allocationSummary, bidIsLocked, buildUpName, cleanShare, costMetaOf, costPerUnit, isLinkStale, listOutputs, lineCostAsOf, missingCosts, outputCost,
  overAllocated, parseOutput, prefillParams, rateFromCost, resourceForComponent, RESOURCE_FOR_COMPONENT, splitShares, sumPerUnit, type EstLine,
  canonUnit, isRateBuildUp, measuredQuantity, needsQuantityConfirm, quantityCheck, quantityConfirmCopy, quantityNote, quantityView,
} from "./rules";
import { TILES_FLOOR_STARTER } from "@/lib/estimator/starterTemplatesTiles";
import { STARTER_TEMPLATES } from "@/lib/estimator/starterTemplates";
import { CIVIL_STARTERS } from "@/lib/estimator/starterTemplatesCivil";
import { PIPES_STARTERS } from "@/lib/estimator/starterTemplatesPipes";
import { PRECAST_ELEMENTS_STARTERS } from "@/lib/estimator/starterTemplatesPrecast";

// Estimates inside the tender flow (GCC tender deals, slice 3c-1): the rules, in plain numbers.

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";

const line = (o: Partial<EstLine> & { id: string }): EstLine => ({
  code: null, description: "Line", uom: "m", qty: 1, waste_pct: 0, unit_cost: 10, cost_total: 10, component: "materials", wbs_code: null, product_id: null,
  custom_data: null, updated_at: "2026-10-20T00:00:00Z", ...o,
});
// A pipe run: 120 m of pipe with 5% waste at 31 (= 3,906), a crew (600) and haulage (500). Total 5,006.
const pipe = line({ id: L1, code: "pipe_110", description: "HDPE pipe 110mm", qty: 120, waste_pct: 5, unit_cost: 31, cost_total: 3906, wbs_code: "1.1", custom_data: { group: "Supply" } });
const crew = line({ id: L2, code: "lay_crew", description: "Laying crew", uom: "day", qty: 10, unit_cost: 60, cost_total: 600, component: "labour", wbs_code: "2.1", custom_data: { group: "Installation" } });
const haul = line({ id: L3, code: "haulage", description: "Haulage to site", uom: "trip", qty: 5, unit_cost: 100, cost_total: 500, component: "transport", wbs_code: "2.2", custom_data: { group: "Installation" } });
const lines = [pipe, crew, haul];

describe("outputs", () => {
  it("reads and writes the three kinds, and refuses anything else", () => {
    expect(parseOutput("total")).toEqual({ kind: "total" });
    expect(parseOutput(`line:${L1}`)).toEqual({ kind: "line", id: L1 });
    expect(parseOutput("wbs:2.1")).toEqual({ kind: "wbs", code: "2.1" });
    for (const bad of ["", "line:nope", "wbs:", "wbs:a b", "wbs:../x", "TOTAL", null, 5, undefined]) expect(parseOutput(bad), String(bad)).toBeNull();
  });

  it("the whole estimate is the sum of its lines, a line is itself, a WBS group is the lines under its number", () => {
    expect(outputCost({ kind: "total" }, lines)).toMatchObject({ cost: 5006, lines: 3, qty: null });
    expect(outputCost({ kind: "line", id: L1 }, lines)).toMatchObject({ cost: 3906, qty: 120, unit: "m", label: "HDPE pipe 110mm" });
    expect(outputCost({ kind: "wbs", code: "2" }, lines)).toMatchObject({ cost: 1100, lines: 2 });
    expect(outputCost({ kind: "wbs", code: "2.2" }, lines)).toMatchObject({ cost: 500, lines: 1 });
  });

  it("a WBS code is a whole number: 2 is not 20, and an output that is gone reads as null", () => {
    const odd = [...lines, line({ id: "44444444-4444-4444-8444-444444444444", wbs_code: "20.1", cost_total: 99 })];
    expect(outputCost({ kind: "wbs", code: "2" }, odd)!.cost).toBe(1100);
    expect(outputCost({ kind: "wbs", code: "9" }, lines)).toBeNull();
    expect(outputCost({ kind: "line", id: "55555555-5555-4555-8555-555555555555" }, lines)).toBeNull();
  });

  it("counts lines that have a quantity but no cost, and the list offers the whole estimate, each group and each line", () => {
    const open = [...lines, line({ id: "66666666-6666-4666-8666-666666666666", qty: 3, unit_cost: null, cost_total: null, wbs_code: "1.2" })];
    expect(outputCost({ kind: "total" }, open)!.unpriced).toBe(1);
    const keys = listOutputs(lines).map((o) => o.key);
    expect(keys.slice(0, 3)).toEqual(["total", "wbs:1", "wbs:2"]);
    expect(keys).toContain(`line:${L2}`);
    expect(listOutputs(lines).find((o) => o.key === "wbs:2")!.label).toBe("2 · Installation");
  });
});

describe("cost per BOQ unit", () => {
  const total = outputCost({ kind: "total" }, lines)!;
  const pipeOut = outputCost({ kind: "line", id: L1 }, lines)!;

  it("a total basis spreads the cost times the share over the BOQ quantity", () => {
    expect(costPerUnit({ basis: "total", out: total, boqQty: 120, sharePct: 100 })).toEqual({ ok: true, perUnit: 41.7167 });
    expect(costPerUnit({ basis: "total", out: total, boqQty: 120, sharePct: 50 })).toEqual({ ok: true, perUnit: 20.8583 });
    expect(costPerUnit({ basis: "total", out: total, boqQty: 1, sharePct: 100 })).toEqual({ ok: true, perUnit: 5006 });
  });

  it("a per-unit basis is the estimate line's own cost per unit (waste included) times the share", () => {
    expect(costPerUnit({ basis: "per_unit", out: pipeOut, boqQty: 999, sharePct: 100 })).toEqual({ ok: true, perUnit: 32.55 });
    expect(costPerUnit({ basis: "per_unit", out: pipeOut, boqQty: 999, sharePct: 50 })).toEqual({ ok: true, perUnit: 16.275 });
  });

  it("refuses what cannot give a cost: no quantity to spread over, a per-unit basis on more than one line, no cost, a bad share", () => {
    expect(costPerUnit({ basis: "total", out: total, boqQty: 0, sharePct: 100 }).ok).toBe(false);
    expect(costPerUnit({ basis: "per_unit", out: total, boqQty: 10, sharePct: 100 }).ok).toBe(false);
    const free = outputCost({ kind: "line", id: L1 }, [line({ id: L1, cost_total: null, unit_cost: null, qty: 4 })])!;
    expect(costPerUnit({ basis: "total", out: free, boqQty: 10, sharePct: 100 })).toMatchObject({ ok: false, reason: "That output has no cost yet" });
    for (const s of [0, -5, 101, Number.NaN]) expect(costPerUnit({ basis: "total", out: total, boqQty: 10, sharePct: s }).ok, String(s)).toBe(false);
  });

  it("several links on one line add up, and the rate is the cost plus the markup", () => {
    expect(sumPerUnit([20.8583, 12.1])).toBe(32.9583);
    expect(rateFromCost(40, 10)).toBe(44);
    expect(rateFromCost(40, 0)).toBe(40);
    expect(rateFromCost(40, null)).toBe(40);
    expect(cleanShare("37.5")).toBe(37.5);
    expect(cleanShare(0)).toBeNull();
  });

  it("build-up: the estimate built for the BOQ quantity gives total / quantity", () => {
    const built = outputCost({ kind: "total" }, [line({ id: L1, qty: 120, cost_total: 6000 })])!;
    expect(costPerUnit({ basis: "total", out: built, boqQty: 120, sharePct: 100 })).toEqual({ ok: true, perUnit: 50 });
  });
});

describe("shares and the unallocated remainder", () => {
  const cents = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) * 100);

  it("always add up to exactly 100", () => {
    for (const w of [[1, 1, 1], [3, 7], [1, 2, 3, 4, 5, 6, 7], [0.1, 0.2, 0.3], [5], [100, 0.01]]) expect(cents(splitShares(w)), JSON.stringify(w)).toBe(10000);
    expect(splitShares([1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(splitShares([3, 1])).toEqual([75, 25]);
  });

  it("no weights at all share equally; a weight of zero or less gets nothing", () => {
    expect(splitShares([0, 0, 0, 0])).toEqual([25, 25, 25, 25]);
    expect(splitShares([5, 0, -3])).toEqual([100, 0, 0]);
    expect(splitShares([])).toEqual([]);
  });

  it("within a free part the shares add up to at most what is free", () => {
    for (const free of [100, 60, 33.33, 0.5]) {
      const s = sharesWithin([1, 1, 1], free);
      expect(cents(s)).toBeLessThanOrEqual(Math.round(free * 100));
    }
    expect(sharesWithin([1, 1], 60)).toEqual([30, 30]);
  });

  it("the allocation summary shows what is left over and flags an output given out above 100 percent", () => {
    const outs = [{ key: "total", label: "Whole estimate", cost: 1000 }];
    const part = allocationSummary(outs, [
      { boq_line_id: "a", output: "total", basis: "total", share_pct: 60 }, { boq_line_id: "b", output: "total", basis: "total", share_pct: 30 },
    ]);
    expect(part).toMatchObject({ total_cost: 1000, allocated_cost: 900, unallocated_cost: 100, over: [] });
    expect(part.outputs[0]).toMatchObject({ allocated_pct: 90, unallocated_pct: 10, over: false });
    const full = allocationSummary(outs, [{ boq_line_id: "a", output: "total", basis: "total", share_pct: 100 }]);
    expect(full.unallocated_cost).toBe(0);
    const over = allocationSummary(outs, [{ boq_line_id: "a", output: "total", basis: "total", share_pct: 70 }, { boq_line_id: "b", output: "total", basis: "total", share_pct: 40 }]);
    expect(over.over).toEqual(["total"]);
    expect(over.unallocated_cost).toBe(0);
  });

  it("a per-unit link borrows a rate and takes nothing out of the pool", () => {
    const s = allocationSummary([{ key: "total", label: "t", cost: 500 }], [{ boq_line_id: "a", output: "total", basis: "per_unit", share_pct: 100 }]);
    expect(s.unallocated_cost).toBe(500);
  });

  it("over-allocation is decided on hundredths, so 33.33 + 33.33 + 33.34 is allowed and one more cent is not", () => {
    const mk = (n: number): { boq_line_id: string; output: string; basis: "total"; share_pct: number } => ({ boq_line_id: `b${n}`, output: "o", basis: "total", share_pct: n });
    expect(overAllocated([mk(33.33), mk(33.33)], [mk(33.34)])).toEqual([]);
    expect(overAllocated([mk(33.33), mk(33.33)], [mk(33.35)])).toEqual(["o"]);
    expect(overAllocated([], [{ ...mk(100), basis: "total" }, { boq_line_id: "z", output: "o", basis: "per_unit", share_pct: 100 }])).toEqual([]);
  });

  it("when a whole-estimate allocation is in use the unallocated cost is that of the whole, not the lines inside it counted again", () => {
    const outs = listOutputs(lines).map((o) => ({ key: o.key, label: o.label, cost: o.cost }));
    const s = allocationSummary(outs, [{ boq_line_id: "a", output: "total", basis: "total", share_pct: 80 }]);
    expect(s.total_cost).toBe(5006);
    expect(s.unallocated_cost).toBe(1001.2);
  });
});

describe("estimate changed, re-price", () => {
  const link = { applied_at: "2026-10-20T10:00:00.000Z", estimate_updated_at: "2026-10-20T09:59:00.000Z" };
  it("stale only when the estimate was saved after the figures were applied", () => {
    expect(isLinkStale(link, "2026-10-20T09:59:00.000Z")).toBe(false);
    expect(isLinkStale(link, "2026-10-20T09:59:00.001Z")).toBe(true);
    expect(isLinkStale(link, "2026-10-21T00:00:00Z")).toBe(true);
  });
  it("a build-up that was never applied is waiting, not stale; a link with no stamp cannot be shown current", () => {
    expect(isLinkStale({ applied_at: null, estimate_updated_at: null }, "2026-10-21T00:00:00Z")).toBe(false);
    expect(isLinkStale({ applied_at: "2026-10-20T10:00:00Z", estimate_updated_at: null }, "2026-10-21T00:00:00Z")).toBe(true);
    expect(isLinkStale(link, null)).toBe(false);
  });
  it("the bid is locked from Submitted on, open while it is being built", () => {
    for (const s of ["received", "bid_no_bid", "estimating"]) expect(bidIsLocked(s), s).toBe(false);
    for (const s of ["submitted", "clarifications", "awarded", "bid_lost", "no_bid"]) expect(bidIsLocked(s), s).toBe(true);
    expect(bidIsLocked(undefined)).toBe(false);
  });
});

describe("missing costs", () => {
  const TODAY = "2026-10-26";
  const meta = (asOf: string, unit = 31) => ({ override: { unit_cost: unit, cost_meta: { unit_cost: unit, as_of: asOf, source: "rfq", ref: "RFQ-0004 · Gulf Pipes" } } });

  it("lists a line with no cost, and a cost confirmed more than the validity ago (180 days is still fresh, 181 is not)", () => {
    const none = line({ id: L1, unit_cost: null, cost_total: null, qty: 4 });
    const edge = line({ id: L2, unit_cost: 31, custom_data: meta("2026-04-29") }); // exactly 180 days before 2026-10-26
    const old = line({ id: L3, unit_cost: 31, custom_data: meta("2026-04-28") }); // 181 days
    const out = missingCosts([none, edge, old], TODAY, 180);
    expect(out.map((m) => [m.line_id, m.reason])).toEqual([[L1, "no_cost"], [L3, "stale"]]);
    expect(out[1]).toMatchObject({ age_days: 181, as_of: "2026-04-28" });
  });

  it("uses the workspace's validity, not a fixed 180", () => {
    const l = line({ id: L2, unit_cost: 31, custom_data: meta("2026-08-01") });
    expect(missingCosts([l], TODAY, 180)).toEqual([]);
    expect(missingCosts([l], TODAY, 60).map((m) => m.reason)).toEqual(["stale"]);
  });

  it("a product line is as old as the product's cost date; a line with nothing else is as old as when it was saved", () => {
    const p = line({ id: L1, product_id: "p1", updated_at: "2026-10-25T00:00:00Z" });
    expect(missingCosts([p], TODAY, 180, new Map([["p1", "2026-01-01"]])).map((m) => m.reason)).toEqual(["stale"]);
    expect(missingCosts([p], TODAY, 180, new Map([["p1", "2026-09-01"]]))).toEqual([]);
    expect(missingCosts([p], TODAY, 180)).toEqual([]);
    expect(lineCostAsOf(p, null)).toBe("2026-10-25");
  });

  it("leaves out a line with no quantity, and does not age labour or overhead (but still lists them with no cost)", () => {
    const zero = line({ id: L1, qty: 0, unit_cost: null, cost_total: null });
    const oldLabour = line({ id: L2, component: "labour", updated_at: "2025-01-01T00:00:00Z" });
    const freeLabour = line({ id: L3, component: "labour", unit_cost: null, cost_total: null, qty: 2 });
    expect(missingCosts([zero, oldLabour, freeLabour], TODAY, 180).map((m) => m.line_id)).toEqual([L3]);
  });

  it("a cost written by an award counts only while the line still has that figure", () => {
    const l = line({ id: L1, unit_cost: 31, custom_data: meta("2026-10-20") });
    expect(costMetaOf(l)).toMatchObject({ as_of: "2026-10-20", ref: "RFQ-0004 · Gulf Pipes" });
    expect(costMetaOf({ ...l, unit_cost: 35 })).toBeNull();
    expect(costMetaOf(line({ id: L2, custom_data: { cost_meta: { unit_cost: 10, as_of: "2026-10-01", source: "rfq", ref: null } } }))).toMatchObject({ as_of: "2026-10-01" });
  });

  it("the RFQ lines carry the estimate line and a plain reason, and nothing else a supplier should not see", () => {
    const rows = missingRfqLines([{ line: pipe, reason: "stale", age_days: 200 }, { line: crew, reason: "no_cost", age_days: null }]);
    expect(rows[0]).toMatchObject({ source_line_id: L1, description: "HDPE pipe 110mm", uom: "m", qty: 120, include: true, hint: "cost 200 days old" });
    expect(rows[1].hint).toBe("no cost yet");
    expect(JSON.stringify(rows)).not.toMatch(/3906|unit_cost|cost_total|"rate"/);
    expect(missingReasonText({ reason: "no_cost", age_days: null })).toBe("no cost yet");
  });
});

describe("resource types for the budget", () => {
  it("maps every cost category to a contract project resource level", () => {
    expect(RESOURCE_FOR_COMPONENT).toEqual({ materials: "11", moulds: "21", labour: "31", erection: "41", transport: "51", overhead: "51", other: "51" });
    expect(resourceForComponent("materials")).toBe("11");
    expect(resourceForComponent("labour")).toBe("31");
    expect(resourceForComponent(null)).toBe("51");
    expect(resourceForComponent("something new")).toBe("51");
  });
});

describe("build up this rate", () => {
  const inputs = [
    { key: "wall_length", label: "Wall length", type: "number", unit: "m", min: 1, max: 5000 },
    { key: "height", label: "Height", type: "number", unit: "m", min: 1, max: 6 },
    { key: "depth", label: "Depth", type: "number", unit: "m", min: 1, max: 500 },
    { key: "finish", label: "Finish", type: "select" },
  ];
  it("fills the one number input whose unit is the BOQ unit and whose range allows it", () => {
    expect(prefillParams([{ key: "wall_length", type: "number", unit: "m", min: 1, max: 5000 }, { key: "finish", type: "select" }], "m", 120)).toEqual({ wall_length: 120 });
  });
  it("is not sure with two inputs in the same unit, and then fills nothing rather than guess", () => {
    expect(prefillParams(inputs, "m", 120)).toEqual({});
  });
  it("falls back to an input named like a quantity, never fills a value outside the input's range, and ignores a line with no quantity", () => {
    expect(prefillParams([{ key: "quantity", type: "number", unit: "nos", min: 1, max: 100 }], "lot", 12)).toEqual({ quantity: 12 });
    expect(prefillParams([{ key: "quantity", type: "number", max: 10 }], "lot", 12)).toEqual({});
    expect(prefillParams([{ key: "quantity", type: "number" }], "lot", 0)).toEqual({});
  });
  it("names the estimate after the BOQ line", () => {
    expect(buildUpName({ item_no: "2.4", description: "HDPE pipe 110mm laid in trench" })).toBe("2.4 HDPE pipe 110mm laid in trench");
    expect(buildUpName({ item_no: null, description: "" })).toBe("Rate build-up");
  });
});

describe("allocating a whole-scope estimate", () => {
  const boq = [
    { id: "b1", item_no: "1.1", row_no: 5, description: "HDPE pipe 110mm laid in trench", uom: "m", qty: 120, cost_code: null, amount: 6000 },
    { id: "b2", item_no: "1.2", row_no: 6, description: "HDPE pipe 110mm, road crossing", uom: "m", qty: 30, cost_code: null, amount: 3000 },
    { id: "b3", item_no: "1.3", row_no: 7, description: "Mobilisation", uom: "lot", qty: 1, cost_code: null, amount: 1000 },
  ];

  it("matches each BOQ line to the estimate line that reads like it; lines that share one split its cost by amount to exactly 100", () => {
    const rows = proposeByMatch({ boq, lines, by: "amount", existing: [] });
    expect(rows.map((r) => r.boq_id)).toEqual(["b1", "b2"]);
    expect(rows.every((r) => r.output === `line:${L1}`)).toBe(true);
    expect(rows.map((r) => r.share_pct)).toEqual([66.67, 33.33]);
    expect(Math.round(rows.reduce((s, r) => s + r.share_pct, 0) * 100)).toBe(10000);
    expect(rows[0].output_cost).toBe(3906);
  });

  it("by quantity the same lines split 80 / 20", () => {
    expect(proposeByMatch({ boq, lines, by: "quantity", existing: [] }).map((r) => r.share_pct)).toEqual([80, 20]);
  });

  it("gives out only what is still free: another line already holds 40 percent of that estimate line", () => {
    const rows = proposeByMatch({ boq, lines, by: "quantity", existing: [{ boq_line_id: "other", output: `line:${L1}`, basis: "total", share_pct: 40 }] });
    expect(Math.round(rows.reduce((s, r) => s + r.share_pct, 0) * 100)).toBeLessThanOrEqual(6000);
  });

  it("a line already linked to that output is replaced, not counted twice", () => {
    const rows = proposeByMatch({ boq, lines, by: "quantity", existing: [{ boq_line_id: "b1", output: `line:${L1}`, basis: "total", share_pct: 100 }] });
    expect(rows.map((r) => r.share_pct)).toEqual([80, 20]);
  });

  it("spreads one part over the lines in proportion to amount or quantity, to exactly 100", () => {
    const whole = outputCost({ kind: "total" }, lines)!;
    const byAmount = proposeSpread({ boq, output: whole, by: "amount", existing: [] });
    expect(byAmount.map((r) => r.share_pct)).toEqual([60, 30, 10]);
    expect(byAmount.every((r) => r.band === "spread" && r.output === "total")).toBe(true);
    const byQty = proposeSpread({ boq, output: whole, by: "quantity", existing: [] });
    expect(Math.round(byQty.reduce((s, r) => s + r.share_pct, 0) * 100)).toBe(10000);
    expect(byQty[0].share_pct).toBeGreaterThan(byQty[1].share_pct);
  });

  it("ticking and unticking re-splits what is free among the ticked lines; an unticked line gets nothing", () => {
    const whole = outputCost({ kind: "total" }, lines)!;
    const rows = proposeSpread({ boq, output: whole, by: "amount", existing: [] });
    const two = reshare(rows, new Set(["b1", "b2"]), "amount", []);
    expect([two.get("b1"), two.get("b2"), two.get("b3")]).toEqual([66.67, 33.33, 0]);
    const none = reshare(rows, new Set(), "amount", []);
    expect([...none.values()].every((v) => v === 0)).toBe(true);
  });

  it("the unallocated cost is what the ticked lines leave", () => {
    const whole = outputCost({ kind: "total" }, lines)!;
    const rows = proposeSpread({ boq, output: whole, by: "amount", existing: [] });
    const re = reshare(rows, new Set(["b1"]), "amount", []);
    const s = allocationSummary([{ key: "total", label: "w", cost: whole.cost }], [{ boq_line_id: "b1", output: "total", basis: "total", share_pct: re.get("b1")! }]);
    expect(s.unallocated_cost).toBe(0);
    const part = allocationSummary([{ key: "total", label: "w", cost: whole.cost }], [{ boq_line_id: "b1", output: "total", basis: "total", share_pct: 60 }]);
    expect(part.unallocated_cost).toBe(2002.4);
  });
});

describe("the budget a tender's estimates give a contract project", () => {
  const info = (over: Partial<{ ref: string; changed: boolean }> = {}) => ({ estimate_ref: over.ref ?? "EST-0007", changed_since: over.changed ?? false });
  const est = { ref: "EST-0007", lines };
  const boqInfo = { item_no: "1.1", description: "HDPE pipe laid", unit: "m", cost_code: "33 11 00" };
  const amount = (xs: { qty: number; unit_cost: number }[]) => Math.round(xs.reduce((s, x) => s + x.qty * x.unit_cost, 0) * 100) / 100;

  it("a whole-estimate link becomes the estimate's own cost lines, by resource, with the BOQ cost code and known costs", () => {
    const p = budgetPartsForBoqLine({ boqQty: 120, boq: boqInfo, links: [{ link: { output: "total", basis: "total", share_pct: 100, ...info() }, estimate: est }] });
    expect(p.lines.map((l) => l.resource_code)).toEqual(["11", "31", "51"]);
    expect(p.lines.every((l) => l.cost_known && l.cost_code === "33 11 00" && l.wbs === "1.1")).toBe(true);
    expect(p.lines[0]).toMatchObject({ description: "1.1 · HDPE pipe 110mm", qty: 120, unit: "m", unit_cost: 32.55 });
    expect(p.amount).toBe(5006);
    expect(amount(p.lines)).toBe(5006);
  });

  it("the share scales the quantity, so the lines add up to cost times share", () => {
    const p = budgetPartsForBoqLine({ boqQty: 120, boq: boqInfo, links: [{ link: { output: "total", basis: "total", share_pct: 40, ...info() }, estimate: est }] });
    expect(p.amount).toBe(2002.4);
    expect(p.lines[0].qty).toBe(48);
  });

  it("a per-unit link is one line of the BOQ quantity at the estimate line's cost per unit", () => {
    const p = budgetPartsForBoqLine({ boqQty: 100, boq: boqInfo, links: [{ link: { output: `line:${L1}`, basis: "per_unit", share_pct: 100, ...info() }, estimate: est }] });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ resource_code: "11", qty: 100, unit_cost: 32.55 });
    expect(p.amount).toBe(3255);
  });

  it("a WBS group becomes only its lines, and an estimate line with no cost is kept but not known", () => {
    const withGap = { ref: "EST-0007", lines: [...lines, line({ id: "77777777-7777-4777-8777-777777777777", description: "Valve", qty: 2, unit_cost: null, cost_total: null, component: "other", wbs_code: "2.3", custom_data: { group: "Installation" } })] };
    const p = budgetPartsForBoqLine({ boqQty: 10, boq: boqInfo, links: [{ link: { output: "wbs:2", basis: "total", share_pct: 100, ...info() }, estimate: withGap }] });
    expect(p.lines.map((l) => l.resource_code)).toEqual(["31", "51", "51"]);
    expect(p.lines.at(-1)).toMatchObject({ cost_known: false, unit_cost: 0 });
    expect(p.lines.at(-1)!.source_ref).toContain("no cost in the estimate yet");
    expect(p.amount).toBe(1100);
  });

  it("says so when the estimate changed since, or an output is gone, or the estimate was removed", () => {
    const changed = budgetPartsForBoqLine({ boqQty: 1, boq: boqInfo, links: [{ link: { output: "total", basis: "total", share_pct: 100, ...info({ changed: true }) }, estimate: est }] });
    expect(changed.lines[0].source_ref).toContain("estimate changed since");
    const gone = budgetPartsForBoqLine({ boqQty: 1, boq: boqInfo, links: [{ link: { output: "wbs:9", basis: "total", share_pct: 100, ...info() }, estimate: est }, { link: { output: "total", basis: "total", share_pct: 100, ...info() }, estimate: null }] });
    expect(gone.lines).toEqual([]);
    expect(gone.warnings).toHaveLength(2);
  });

  describe("in the budget from a won tender", () => {
    const deal = (over: Partial<DealLine> = {}): DealLine => ({ id: "d1", sl_no: "1.1", description: "HDPE pipe laid", uom: "m", qty: 120, rate: 90, discount_pct: 0, is_selected: true, break_of: null, ...over });
    const boq = new Map<string, BoqInfo>([
      ["d1", { item_no: "1.1", cost_code: "33 11 00", unit_cost: null, price_source: "estimate", price_source_ref: "EST-0007" }],
      ["d2", { item_no: "1.2", cost_code: "33 11 00", unit_cost: null, price_source: null, price_source_ref: null }],
    ]);
    const codes = new Set(["33 11 00"]);
    const estimates = new Map([["d1", { links: [{ link: { output: "total", basis: "total" as const, share_pct: 100, ...info() }, estimate: est }] }]]);

    it("takes the estimate's lines for a BOQ line it priced and keeps the old rule for the rest", () => {
      const m = mapTenderToBudget({ lines: [deal(), deal({ id: "d2", sl_no: "1.2", description: "Valves", qty: 4, rate: 100 })], boq, costCodes: codes, defaultMarginPct: 15, estimates });
      expect(m.fromEstimate).toBe(1);
      expect(m.lines).toHaveLength(4); // three estimate lines + one standard line
      expect(m.lines.slice(0, 3).every((l) => l.cost_known)).toBe(true);
      const last = m.lines[3];
      expect(last).toMatchObject({ resource_code: "11", unit_cost: 85, cost_known: false });
      expect(m.estimated).toBe(1);
      expect(m.unmappedCodes).toEqual([]);
    });

    it("without estimates the result is exactly what it was before", () => {
      const a = mapTenderToBudget({ lines: [deal()], boq, costCodes: codes, defaultMarginPct: 15 });
      const b = mapTenderToBudget({ lines: [deal()], boq, costCodes: codes, defaultMarginPct: 15, estimates: new Map() });
      expect(b.lines).toEqual(a.lines);
      expect(a.fromEstimate).toBe(0);
      expect(a.lines).toHaveLength(1);
      expect(a.lines[0]).toMatchObject({ resource_code: "11", unit_cost: 76.5, cost_known: false });
    });

    it("falls back to the old rule when the estimate gives nothing usable, and says why", () => {
      const gone = new Map([["d1", { links: [{ link: { output: "wbs:9", basis: "total" as const, share_pct: 100, ...info() }, estimate: est }] }]]);
      const m = mapTenderToBudget({ lines: [deal()], boq, costCodes: codes, defaultMarginPct: 15, estimates: gone });
      expect(m.fromEstimate).toBe(0);
      expect(m.lines).toHaveLength(1);
      expect(m.estimateWarnings.length).toBe(1);
    });

    it("an unmapped BOQ cost code is still reported when the estimate supplies the lines", () => {
      const m = mapTenderToBudget({ lines: [deal()], boq, costCodes: new Set(["00 00 00"]), defaultMarginPct: 15, estimates });
      expect(m.unmappedCodes).toEqual(["33 11 00"]);
      expect(m.lines.every((l) => l.cost_code === null)).toBe(true);
    });
  });
});

describe("a bid version of lines priced from an estimate", () => {
  it("carries the rate, the amount and the NAME of the source, and never the cost, the estimate or the link behind it", () => {
    const dealLine = {
      id: "d1", sl_no: "1.3", description: "HDPE pipe 110mm", uom: "m", qty: 120, rate: 45.89, amount: 5506.8, discount_pct: 0, product_id: null, is_selected: true,
      // What a deal line or a joined row might carry in a careless query:
      unit_cost: 41.7167, markup_pct: 10, applied_cost: 41.7167, estimate_id: "e1", estimate_ref: "EST-0007", cost_total: 5006,
    } as unknown as Parameters<typeof buildSnapshot>[0][number];
    const s = buildSnapshot([dealLine], { priceSource: new Map([["d1", PRICE_SOURCE_LABEL.estimate]]) });
    expect(s.lines[0]).toEqual({ key: "no:1.3", item_no: "1.3", description: "HDPE pipe 110mm", unit: "m", qty: 120, rate: 45.89, amount: 5506.8, product_ref: null, price_source: "Tender estimate" });
    expect(JSON.stringify(s)).not.toMatch(/41\.7167|EST-0007|5006|applied_cost|unit_cost|markup/);
  });
});

describe("the quantity an estimate is made for (live test 2026-10-26: floor tiles, 120 m2, estimate left at its 17.5 m2 default)", () => {
  const floor = TILES_FLOOR_STARTER.inputs;

  it("spells one unit one way", () => {
    for (const u of ["m2", "M²", "sq m", "sqm", "Sq.M", "square metres"]) expect(canonUnit(u), u).toBe("m2");
    for (const u of ["m3", "m³", "cum"]) expect(canonUnit(u), u).toBe("m3");
    for (const u of ["m", "mtr", "Metres", "lm"]) expect(canonUnit(u), u).toBe("m");
    expect(canonUnit("Nos")).toBe("no");
    expect(canonUnit(null)).toBe("");
  });

  it("the Floor tiles template has no input in m2, so a floor area becomes a rectangle of exactly that area inside the ranges", () => {
    const p = prefillParams(floor, "m2", 120);
    expect(p).toEqual({ room_length_m: 12, room_width_m: 10 });
    expect(p.room_length_m * p.room_width_m).toBe(120);
    // The same through the other spellings of the unit, and with a decimal quantity.
    expect(prefillParams(floor, "m²", 120)).toEqual(p);
    const odd = prefillParams(floor, "sqm", 77.77);
    expect(Math.abs(odd.room_length_m * odd.room_width_m - 77.77) / 77.77).toBeLessThan(0.0001);
  });

  it("never invents a value outside an input's range: a small floor tries a narrower room, an impossible one fills nothing", () => {
    expect(prefillParams(floor, "m2", 2)).toEqual({ room_length_m: 0.5, room_width_m: 4 });
    expect(prefillParams(floor, "m2", 0.1)).toEqual({});
    expect(prefillParams(floor, "m2", 20000)).toEqual({});
    for (const q of [0.3, 0.5, 1, 7, 33, 120, 999, 9999, 10000, 10001]) {
      const p = prefillParams(floor, "m2", q);
      if (Object.keys(p).length === 0) continue;
      expect(p.room_length_m).toBeGreaterThanOrEqual(0.5); expect(p.room_length_m).toBeLessThanOrEqual(100);
      expect(p.room_width_m).toBeGreaterThanOrEqual(0.5); expect(p.room_width_m).toBeLessThanOrEqual(100);
    }
  });

  it("does it only for an area, only with exactly one room length and one room width in metres, and not for a room that starts L-shaped", () => {
    expect(prefillParams(floor, "m", 120)).toEqual({});
    expect(prefillParams(floor, "m3", 120)).toEqual({});
    expect(prefillParams(floor.filter((i) => i.key !== "room_width_m"), "m2", 120)).toEqual({});
    expect(prefillParams(floor.map((i) => (i.key === "cutout_length_m" ? { ...i, default: 2 } : i)), "m2", 120)).toEqual({});
    // A tile size, a skirting height or a door are never the plan of the room.
    expect(prefillParams([{ key: "tile_length_mm", label: "Tile length", type: "number", unit: "mm" }, { key: "door_width_m", label: "Door", type: "number", unit: "m" }], "m2", 120)).toEqual({});
  });

  it("an input named like a quantity is not filled with an area when it is a length", () => {
    expect(prefillParams([{ key: "length", label: "Length", type: "number", unit: "m" }], "m2", 120)).toEqual({});
    expect(prefillParams([{ key: "quantity", label: "Quantity", type: "number" }], "m2", 120)).toEqual({ quantity: 120 });
  });

  it("reads what an estimate is made for from its own inputs: the unit input, a quantity input, or the plan area less a cut-out", () => {
    expect(measuredQuantity(floor, {}, "m2")).toBe(17.5);
    expect(measuredQuantity(floor, { room_length_m: 12, room_width_m: 10 }, "m2")).toBe(120);
    expect(measuredQuantity(floor, { room_length_m: 12, room_width_m: 10, cutout_length_m: 2, cutout_width_m: 3 }, "m²")).toBe(114);
    expect(measuredQuantity([{ key: "wall_length", type: "number", unit: "m", default: 40 }], { wall_length: 120 }, "m")).toBe(120);
    expect(measuredQuantity([{ key: "wall_length", type: "number", unit: "m", default: 40 }], {}, "m")).toBe(40);
    expect(measuredQuantity([{ key: "quantity", type: "number", default: 3 }], { quantity: "7" }, "lot")).toBe(7);
  });

  it("says unknown, never a guess, when it cannot tell", () => {
    expect(measuredQuantity([{ key: "finish", type: "select" }], {}, "m2")).toBeNull();
    expect(measuredQuantity(floor, {}, "no")).toBeNull();
    expect(measuredQuantity(floor, {}, null)).toBeNull();
    expect(measuredQuantity([{ key: "a", type: "number", unit: "m" }, { key: "b", type: "number", unit: "m" }], {}, "m")).toBeNull();
    expect(measuredQuantity(floor, { room_length_m: 0 }, "m2")).toBeNull();
    expect(quantityCheck({ inputs: null, params: {}, boqUnit: "m2", boqQty: 120 })).toMatchObject({ status: "unknown", measured: null });
    expect(quantityCheck({ inputs: floor, params: {}, boqUnit: "m2", boqQty: 0 }).status).toBe("unknown");
  });

  it("matches within 1 percent and is a mismatch beyond it", () => {
    const at = (m: number) => quantityCheck({ inputs: [{ key: "qty", type: "number", unit: "m2" }], params: { qty: m }, boqUnit: "m2", boqQty: 120 }).status;
    expect(at(120)).toBe("matches");
    expect(at(121.2)).toBe("matches");
    expect(at(118.8)).toBe("matches");
    expect(at(121.3)).toBe("mismatch");
    expect(at(17.5)).toBe("mismatch");
    expect(quantityCheck({ inputs: floor, params: {}, boqUnit: "m2", boqQty: 120 })).toEqual({ status: "mismatch", measured: 17.5, boq_qty: 120, uom: "m2" });
  });

  it("only a whole estimate, all of it, drawn on by one line is a rate build-up", () => {
    const l = { output: "total", basis: "total", share_pct: 100 };
    expect(isRateBuildUp(l, 1)).toBe(true);
    expect(isRateBuildUp(l, 2)).toBe(false);
    expect(isRateBuildUp({ ...l, share_pct: 50 }, 1)).toBe(false);
    expect(isRateBuildUp({ ...l, basis: "per_unit" }, 1)).toBe(false);
    expect(isRateBuildUp({ ...l, output: "wbs:2" }, 1)).toBe(false);
  });

  it("asks a person to confirm a build-up not yet used unless its quantity is known to match; a rate already in use is not asked again", () => {
    const c = (status: "matches" | "mismatch" | "unknown") => ({ status, measured: status === "unknown" ? null : 17.5, boq_qty: 120, uom: "m2" });
    expect(needsQuantityConfirm(c("matches"), false)).toBe(false);
    expect(needsQuantityConfirm(c("unknown"), false)).toBe(true);
    expect(needsQuantityConfirm(c("mismatch"), false)).toBe(true);
    expect(needsQuantityConfirm(c("unknown"), true)).toBe(false);
    expect(needsQuantityConfirm(c("mismatch"), true)).toBe(false);
  });

  it("the words: the plain sentence for a quantity that was not filled in, both numbers for a mismatch", () => {
    const unknown = { status: "unknown" as const, measured: null, boq_qty: 120, uom: "m2" };
    const mismatch = { status: "mismatch" as const, measured: 17.5, boq_qty: 120, uom: "m2" };
    expect(quantityNote(unknown, false)).toBe("The quantity was not filled in automatically. Make this estimate for 120 m2, then confirm.");
    expect(quantityNote(unknown, true)).toBeNull();
    expect(quantityNote(mismatch, false)).toBe("This estimate is for 17.5 m2, the BOQ line is 120 m2. Make this estimate for 120 m2, then confirm.");
    expect(quantityNote(mismatch, true)).toBe("This estimate is for 17.5 m2, the BOQ line is 120 m2.");
    expect(quantityNote({ ...mismatch, status: "matches", measured: 120 }, false)).toBeNull();
    expect(quantityNote({ ...unknown, uom: null, boq_qty: 1200.5 }, false)).toBe("The quantity was not filled in automatically. Make this estimate for 1,200.5, then confirm.");
    const v = quantityView(unknown, false, "1.1 Supply and lay tiles");
    expect(v).toMatchObject({ needs_confirm: true, item: "1.1 Supply and lay tiles" });
    expect(quantityConfirmCopy([v])).toEqual({ title: "Is this estimate for 120 m2?", body: v.note, confirmLabel: "Yes, it is for 120 m2" });
    expect(quantityConfirmCopy([v, v]).title).toContain("2 estimates");
  });

  it("no starter template is ever filled outside its input ranges, whatever the unit and quantity", () => {
    const all = [...STARTER_TEMPLATES, TILES_FLOOR_STARTER, ...CIVIL_STARTERS, ...PIPES_STARTERS, ...PRECAST_ELEMENTS_STARTERS];
    for (const t of all) {
      for (const unit of ["m", "m2", "m3", "no", "lot", "kg", "ton"]) {
        for (const q of [0.5, 3, 120, 4000, 90000]) {
          const p = prefillParams(t.inputs, unit, q);
          for (const [key, value] of Object.entries(p)) {
            const def = t.inputs.find((i) => i.key === key)!;
            expect(def.type, `${t.name} ${key}`).toBe("number");
            if (def.min != null) expect(value, `${t.name} ${key}`).toBeGreaterThanOrEqual(def.min);
            if (def.max != null) expect(value, `${t.name} ${key}`).toBeLessThanOrEqual(def.max);
          }
        }
      }
    }
  });
});

describe("the words behind the i", () => {
  it("every explanation fits: two sentences, 160 characters", () => {
    for (const [key, text] of Object.entries(ESTIMATE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
