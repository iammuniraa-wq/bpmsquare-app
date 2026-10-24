import { describe, expect, it } from "vitest";
import { validateTemplate } from "@/lib/estimator/template";
import { toBody, toDraft, blankDrawingRow, splitNames } from "@/components/estimator/templateDraft";
import type { TemplateInput } from "@/lib/estimator/types";

const inputs: TemplateInput[] = [
  { key: "len", label: "Length", type: "number", default: 10, min: 1, max: 100 },
  { key: "gates", label: "Gates", type: "number", default: 1 },
  { key: "tall", label: "Tall", type: "boolean", default: false },
];
const base = (drawing_map: unknown) => ({
  inputs, rates: [], rules: [{ code: "r", group: "G", description: "R", uom: "m", qty: "len + gates + tall", component: "materials", cost: { kind: "rate", rate: "x" } }],
  drawing_map,
});
const withRate = (drawing_map: unknown) => ({ ...base(drawing_map), rates: [{ key: "x", label: "X", unit: "per m", value: 1 }] });
const check = (m: unknown) => validateTemplate(withRate(m));
const msgs = (m: unknown) => check(m).issues.map((i) => `${i.path}: ${i.message}`).join("\n");

describe("drawing_map validation", () => {
  it("accepts a good map and returns it cleaned", () => {
    const v = check([{ input: "len", measure: "length_m", layers: [" FENCE ", "fence", "BOUNDARY"], scale: 0.001 }, { input: "gates", measure: "count", blocks: ["GATE"] }]);
    expect(v.issues).toEqual([]);
    expect(v.template?.drawing_map).toEqual([
      { input: "len", measure: "length_m", layers: ["FENCE", "BOUNDARY"], scale: 0.001 },
      { input: "gates", measure: "count", blocks: ["GATE"] },
    ]);
  });
  it("is optional: absent, null and empty all mean no map", () => {
    for (const m of [undefined, null, []]) {
      const v = check(m);
      expect(v.ok).toBe(true);
      expect("drawing_map" in (v.template ?? {})).toBe(false);
    }
  });
  it("needs a real number input, once", () => {
    expect(msgs([{ input: "nope", measure: "length_m", layers: ["A"] }])).toMatch(/drawing_map\[0\]\.input: Choose an input of this template/);
    expect(msgs([{ input: "tall", measure: "count", layers: ["A"] }])).toMatch(/not a number input/);
    expect(msgs([{ input: "len", measure: "length_m", layers: ["A"] }, { input: "len", measure: "area_m2", layers: ["B"] }])).toMatch(/drawing_map\[1\]\.input: "len" is already filled/);
  });
  it("needs a known measure and layers (or blocks when counting)", () => {
    expect(msgs([{ input: "len", measure: "weight", layers: ["A"] }])).toMatch(/Measures must be/);
    expect(msgs([{ input: "len", measure: "length_m" }])).toMatch(/Name at least one layer/);
    expect(msgs([{ input: "len", measure: "area_m2", layers: [] }])).toMatch(/Name at least one layer/);
    expect(msgs([{ input: "gates", measure: "count" }])).toMatch(/Name the layers or the blocks/);
    expect(check([{ input: "gates", measure: "count", layers: ["GATES"] }]).ok).toBe(true);
    expect(msgs([{ input: "len", measure: "length_m", layers: ["A"], blocks: ["B"] }])).toMatch(/only used when counting/);
  });
  it("holds names to 40 per row and 80 characters, and scale to a finite number above zero", () => {
    expect(msgs([{ input: "len", measure: "length_m", layers: Array.from({ length: 41 }, (_, i) => `L${i}`) }])).toMatch(/At most 40/);
    expect(msgs([{ input: "len", measure: "length_m", layers: ["x".repeat(81)] }])).toMatch(/1 to 80 characters/);
    expect(msgs([{ input: "len", measure: "length_m", layers: [""] }])).toMatch(/1 to 80 characters/);
    expect(msgs([{ input: "len", measure: "length_m", layers: [5] }])).toMatch(/1 to 80 characters/);
    expect(msgs([{ input: "len", measure: "length_m", layers: "FENCE" }])).toMatch(/list of names/);
    for (const scale of [0, -1, Number.NaN, Infinity, "big"]) expect(msgs([{ input: "len", measure: "length_m", layers: ["A"], scale }]), String(scale)).toMatch(/Scale must be a number above zero/);
    expect(msgs({ not: "a list" })).toMatch(/must be a list/);
    expect(msgs(Array.from({ length: 51 }, () => ({ input: "len", measure: "length_m", layers: ["A"] })))).toMatch(/at most 50/);
  });
  it("an input removed from the template invalidates a row that points at it", () => {
    const t = withRate([{ input: "len", measure: "length_m", layers: ["A"] }]);
    const v = validateTemplate({ ...t, inputs: inputs.filter((i) => i.key !== "len"), rules: [{ ...t.rules[0], qty: "gates" }] });
    expect(v.ok).toBe(false);
  });
});

describe("the editor's draft", () => {
  const stored = { name: "T", description: null, trade: null, quote_granularity: "group" as const, geometry: null, inputs, rates: [], rules: [], drawing_map: [{ input: "len", measure: "length_m" as const, layers: ["FENCE", "BOUNDARY"], scale: 0.001 }, { input: "gates", measure: "count" as const, blocks: ["GATE"] }] };

  it("round-trips the map as comma-separated text and back to the same rules", () => {
    const d = toDraft(stored);
    expect(d.drawing_map[0]).toEqual({ input: "len", measure: "length_m", layers: "FENCE, BOUNDARY", blocks: "", scale: "0.001" });
    expect(toBody(d).drawing_map).toEqual(stored.drawing_map);
  });
  it("sends no map for a template that has none, and keeps a half-filled row so the validator can name it", () => {
    expect("drawing_map" in toBody(toDraft({ ...stored, drawing_map: null }))).toBe(false);
    const d = toDraft({ ...stored, drawing_map: null });
    d.drawing_map.push(blankDrawingRow());
    expect(toBody(d).drawing_map).toEqual([{ input: "", measure: "length_m" }]);
  });
  it("splits names on commas, semicolons and new lines", () => {
    expect(splitNames(" A, B ;C\nD,, ")).toEqual(["A", "B", "C", "D"]);
  });
});
