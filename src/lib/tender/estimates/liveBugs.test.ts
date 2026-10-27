import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/estimator/compute";
import { computePricedFromCatalogue, starterCatalogue, unitCostsFromCatalogue } from "@/lib/estimator/starterCatalogue";
import { PIPES_STARTERS } from "@/lib/estimator/starterTemplatesPipes";
import { carriedUnitCosts, inputsChanged } from "@/components/estimator/workspace/shown";
import {
  costPerUnit, measuredQuantity, outputCost, prefillParams, quantityCheck, quantityFieldLabel, quantityNote, quantityView, rateFromCost,
  type EstLine, type QtyInputDef,
} from "./rules";

// Bugs found clicking through the live demo (deal OPP-0014, 2026-10-27): the cost a BOQ row takes from an estimate, and the
// quantity warning on a pipeline estimate.

const line = (n: number, code: string, cost: number): EstLine => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`, code, description: code, uom: "cost", qty: 1, waste_pct: 0, unit_cost: cost, cost_total: cost,
  component: "materials", wbs_code: `${n}.1`, product_id: null, custom_data: null, updated_at: "2026-10-27T00:00:00Z",
});

describe("bug 1: the cost a BOQ row takes from an estimate", () => {
  // EST-0017 as the server saved it for HDPE DN600, 420 m: four groups and the overhead line (10 percent of the rest).
  const saved = [line(1, "exc", 5261.76), line(2, "bed", 61000.01), line(3, "pipe", 526141), line(4, "lay", 81825), line(5, "ovh", 67422.78)];

  it("is the sum of the saved cost lines, overhead included, before margin and VAT: 741,650.55", () => {
    expect(outputCost({ kind: "total" }, saved)?.cost).toBe(741650.55);
  });

  it("is that cost divided by the BOQ quantity: 1,765.83 per m for 420 m, which is 741,648.60 at the row", () => {
    const out = outputCost({ kind: "total" }, saved)!;
    expect(costPerUnit({ basis: "total", out, boqQty: 420, sharePct: 100 })).toEqual({ ok: true, perUnit: 1765.8346 });
    expect(rateFromCost(1765.8346, 0)).toBe(1765.83);
    expect(Math.round(1765.83 * 420 * 100) / 100).toBe(741648.6);
  });

  it("adds the row markup on top, and VAT or the estimate's margin play no part", () => {
    expect(rateFromCost(1765.8346, 15)).toBe(2030.71);
    const out = outputCost({ kind: "total" }, saved)!;
    // 411,482 and its 18 percent VAT are what the Price panel showed for the steel DN300 unit costs; neither is the saved cost.
    expect(out.cost).not.toBe(411482);
    expect(out.cost).not.toBe(Math.round(411482 * 1.18));
  });

  it("the Price panel was the wrong number: a saved estimate's unit costs priced a different pipe", () => {
    const t = PIPES_STARTERS[0];
    const body = { geometry: t.geometry, inputs: t.inputs, rates: t.rates, rules: t.rules };
    const items = starterCatalogue();
    const before = computePricedFromCatalogue(body, { length_m: 420 }, items);
    const hdpe = { pipe_material: "hdpe", pipe_dn: "dn600", length_m: 420 };
    const fresh = computePricedFromCatalogue(body, hdpe, items);
    const stale = computeEstimate(body, hdpe, { unit_costs: unitCostsFromCatalogue(before, items) });
    if (!stale.ok) throw new Error("did not compute");
    expect(before.summary.cost_total).toBe(281798.37);
    expect(fresh.summary.cost_total).toBe(594287.2);
    expect(stale.summary.cost_total).toBeLessThan(fresh.summary.cost_total * 0.8);
  });

  it("the live preview carries the saved unit costs only while the inputs are the saved ones", () => {
    const savedEst = { storedParams: { pipe_material: "steel", pipe_dn: "dn300", length_m: 420 }, unitCosts: { pipe: 340 } };
    expect(carriedUnitCosts(savedEst, { pipe_material: "steel", pipe_dn: "dn300", length_m: 420 })).toBe(savedEst.unitCosts);
    expect(carriedUnitCosts(savedEst, { pipe_material: "hdpe", pipe_dn: "dn300", length_m: 420 })).toBeUndefined();
    expect(carriedUnitCosts(savedEst, { pipe_material: "steel", pipe_dn: "dn600", length_m: 420 })).toBeUndefined();
    expect(carriedUnitCosts(savedEst, { length_m: 420 })).toBe(savedEst.unitCosts);
    expect(carriedUnitCosts(undefined, { length_m: 420 })).toBeUndefined();
    expect(inputsChanged(savedEst.storedParams, { ...savedEst.storedParams, length_m: 421 })).toBe(true);
  });
});

describe("bug 4: which input carries the quantity of a pipeline", () => {
  const pipes = PIPES_STARTERS[0].inputs as QtyInputDef[];

  it("reads the pipeline length even though the trench depth is also in metres", () => {
    expect(measuredQuantity(pipes, { length_m: 420 }, "m")).toBe(420);
    expect(measuredQuantity(pipes, { length_m: 420, pipe_material: "hdpe", pipe_dn: "dn600" }, "m")).toBe(420);
    expect(quantityCheck({ inputs: pipes, params: { length_m: 420 }, boqUnit: "m", boqQty: 420 })).toMatchObject({ status: "matches", measured: 420 });
    expect(quantityCheck({ inputs: pipes, params: { length_m: 233 }, boqUnit: "m", boqQty: 420 })).toMatchObject({ status: "mismatch", measured: 233 });
  });

  it("names the field, so the warning says where to type the number, and there is no warning once it matches", () => {
    expect(quantityFieldLabel(pipes, "m")).toBe("Pipeline length (m)");
    const unknown = { status: "unknown" as const, measured: null, boq_qty: 420, uom: "m" };
    expect(quantityNote(unknown, false, "Pipeline length (m)")).toBe("The quantity was not filled in automatically. Set Pipeline length (m) to 420, then confirm.");
    const matching = quantityView({ status: "matches", measured: 420, boq_qty: 420, uom: "m" }, false, "2.1 HDPE pipe", "Pipeline length (m)");
    expect(matching).toMatchObject({ needs_confirm: false, note: null, field: "Pipeline length (m)" });
    const off = quantityView({ status: "mismatch", measured: 233, boq_qty: 420, uom: "m" }, false, "2.1 HDPE pipe", "Pipeline length (m)");
    expect(off.note).toBe("This estimate is for 233 m, the BOQ line is 420 m. Set Pipeline length (m) to 420, then confirm.");
  });

  it("still cannot tell between two ordinary inputs in metres, and the label is null then", () => {
    const two: QtyInputDef[] = [{ key: "wall_length", type: "number", unit: "m" }, { key: "depth", type: "number", unit: "m" }];
    expect(measuredQuantity(two, {}, "m")).toBeNull();
    expect(quantityFieldLabel(two, "m")).toBeNull();
  });

  it("fills the pipeline length, not the depth, even when the quantity fits both ranges", () => {
    expect(prefillParams(pipes, "m", 5)).toEqual({ length_m: 5 });
    expect(prefillParams(pipes, "m", 420)).toEqual({ length_m: 420 });
  });
});
