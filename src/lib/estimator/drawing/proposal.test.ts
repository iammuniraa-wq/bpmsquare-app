import { describe, expect, it } from "vitest";
import { parseDxf } from "./dxf";
import { measureByLayer } from "./measure";
import { dxfProposal } from "./proposal";
import { validateTemplate } from "@/lib/estimator/template";
import { CHAINLINK_FENCE_STARTER } from "@/lib/estimator/starterTemplates";
import { clampIntake } from "@/lib/estimator/ai";
import { DRAWING_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";
import { buildPayload, drawableCount, shrinkModel } from "./payload";
import { dxfFile, insert, line, lwpoly, rectLines } from "./testing/dxfFixtures";
import type { DrawingMapRule, TemplateInput } from "@/lib/estimator/types";

const inputs: TemplateInput[] = [
  { key: "total_length_m", label: "Fence length", type: "number", default: 500, min: 1, max: 5000, unit: "m" },
  { key: "gates_double_n", label: "Double gates", type: "number", default: 2, min: 0, max: 20 },
  { key: "closed_perimeter", label: "Goes all the way round", type: "boolean", default: true },
  { key: "area_m2", label: "Slab", type: "number", default: 10, min: 1, max: 100 },
];
const map: DrawingMapRule[] = [
  { input: "total_length_m", measure: "length_m", layers: ["FENCE"] },
  { input: "gates_double_n", measure: "count", blocks: ["GATE"] },
];
const measure = (text: string) => {
  const r = parseDxf(text);
  if (!r.ok) throw new Error(r.error);
  return measureByLayer(r.model, r.model.unit.factor);
};

describe("dxfProposal", () => {
  const drawing = dxfFile({
    units: 4, blocks: { GATE: [line("0", 0, 0, 1000, 0)] },
    entities: [...rectLines("FENCE", 100_000, 50_000), insert("GATES", "GATE", 0, 0), insert("GATES", "GATE", 5, 0)],
  });

  it("fills a number from the mapped layer, with its source, file and layer", () => {
    const p = dxfProposal(inputs, map, measure(drawing), { file: "site-plan.dxf" });
    expect(p.values).toEqual({ total_length_m: 300, gates_double_n: 2 });
    expect(p.fields.total_length_m).toEqual({ status: "found", source: "length on layer FENCE: 300 m", file: "site-plan.dxf", layer: "FENCE" });
    expect(p.fields.gates_double_n).toMatchObject({ status: "found", source: "count on layer GATES: 2", layer: "GATES" });
    expect(p.adjusted).toEqual([]);
  });

  it("does not touch an input with no rule, or a rule on an input that is not a number", () => {
    const p = dxfProposal(inputs, [...map, { input: "closed_perimeter", measure: "count", layers: ["FENCE"] }, { input: "nope", measure: "length_m", layers: ["FENCE"] }], measure(drawing), { file: "a.dxf" });
    expect(Object.keys(p.values).sort()).toEqual(["gates_double_n", "total_length_m"]);
    expect(p.fields.area_m2).toBeUndefined();
  });

  it("holds a measured number to the input's limits and says so", () => {
    const big = dxfFile({ units: 6, entities: [line("FENCE", 0, 0, 9000, 0)] });
    const p = dxfProposal(inputs, map, measure(big), { file: "big.dxf" });
    expect(p.values.total_length_m).toBe(5000);
    expect(p.adjusted).toEqual(["total_length_m"]);
    expect(p.assumptions.join(" ")).toMatch(/9000 was measured in big\.dxf.*5000 is proposed/);
    expect(p.fields.total_length_m.source).toMatch(/9000 m$/);
    // The same clamp the email reader applies.
    const email = clampIntake(inputs, { values: { total_length_m: 9000 } });
    expect(email.values.total_length_m).toBe(p.values.total_length_m);
  });

  it("leaves an input alone, with a note, when the layer is missing, the block is absent or the units are unknown", () => {
    const none = dxfProposal(inputs, map, measure(dxfFile({ units: 4, entities: [line("OTHER", 0, 0, 5000, 0)] })), { file: "x.dxf" });
    expect(none.values).toEqual({});
    expect(none.assumptions.join("\n")).toMatch(/Fence length: No layer FENCE.*x\.dxf/);
    expect(none.assumptions.join("\n")).toMatch(/Double gates:/);
    const unknown = dxfProposal(inputs, map.slice(0, 1), measure(dxfFile({ entities: [line("FENCE", 0, 0, 5000, 0)] })), { file: "y.dxf" });
    expect(unknown.values).toEqual({});
    expect(unknown.assumptions[0]).toMatch(/units/);
    const scaled = dxfProposal(inputs, [{ ...map[0], scale: 0.001 }], measure(dxfFile({ entities: [line("FENCE", 0, 0, 5000, 0)] })), { file: "y.dxf" });
    expect(scaled.values.total_length_m).toBe(5);
  });

  it("rounds lengths and areas to two places and counts to whole numbers", () => {
    const p = dxfProposal(inputs, [{ input: "area_m2", measure: "area_m2", layers: ["SLAB"] }], measure(dxfFile({ units: 6, entities: [lwpoly("SLAB", [[0, 0], [3.333, 0], [3.333, 3.333], [0, 3.333]], true)] })), { file: "s.dxf" });
    expect(p.values.area_m2).toBe(11.11);
  });
});

describe("the fence starter's layer map", () => {
  it("validates with the starter and points at real number inputs", () => {
    const v = validateTemplate({ geometry: CHAINLINK_FENCE_STARTER.geometry, inputs: CHAINLINK_FENCE_STARTER.inputs, rates: CHAINLINK_FENCE_STARTER.rates, rules: CHAINLINK_FENCE_STARTER.rules, drawing_map: CHAINLINK_FENCE_STARTER.drawing_map });
    expect(v.issues).toEqual([]);
    expect(v.template?.drawing_map).toEqual([{ input: "total_length_m", measure: "length_m", layers: ["FENCE"] }]);
  });
});

describe("the response", () => {
  const model = (() => {
    const r = parseDxf(dxfFile({ units: 6, blocks: { GATE: [line("0", 0, 0, 2, 0), line("0", 0, 0, 0, 2)] }, entities: [...rectLines("FENCE", 10, 5), insert("GATES", "GATE", 1, 1)] }));
    if (!r.ok) throw new Error(r.error);
    return r.model;
  })();

  it("carries the table, the unit, the extents and the model", () => {
    const p = buildPayload("a.dxf", model);
    expect(p.layers.rows.find((r) => r.layer === "FENCE")?.lengthM).toBeCloseTo(30, 9);
    expect(p.unit.factor).toBe(1);
    expect(p.extents).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
    expect(p.counts).toEqual({ entities: 5, drawable: 7, drawnCap: 50_000, capped: false });
    expect(p.model).not.toBeNull();
    expect(p.modelNote).toBeNull();
    expect(drawableCount(model)).toBe(7);
  });
  it("re-scales the table when the person chooses a unit", () => {
    expect(buildPayload("a.dxf", model, { factor: 0.001 }).layers.rows.find((r) => r.layer === "FENCE")?.lengthM).toBeCloseTo(0.03, 12);
  });
  it("thins the picture, never the numbers, when the drawing is big", () => {
    const pts = Array.from({ length: 4000 }, (_, i) => [i, Math.sin(i / 7) * 5] as [number, number]);
    const big = parseDxf(dxfFile({ units: 6, entities: [lwpoly("ROAD", pts), line("ROAD", 0, 0, 1, 1)] }));
    if (!big.ok) throw new Error(big.error);
    const full = buildPayload("r.dxf", big.model);
    const small = buildPayload("r.dxf", big.model, { maxBytes: 20_000 });
    expect(small.layers.rows[0].length).toBe(full.layers.rows[0].length);
    expect(small.model?.entities[0].t === "poly" ? (small.model.entities[0] as { pts: unknown[] }).pts.length : 0).toBeLessThan(4000);
    expect(small.modelNote).toMatch(/simplified/);
    const none = shrinkModel(big.model, 100);
    expect(none.model).toBeNull();
    expect(none.note).toMatch(/too large to show/);
  });
});

describe("drawing tips", () => {
  for (const [key, text] of Object.entries(DRAWING_TIPS)) {
    it(`${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
});
