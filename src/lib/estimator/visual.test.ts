import { describe, expect, it } from "vitest";
import { hasVisualMapping, inferVisualMapping, inferVolumeKey, keyWords, resolveVisualMapping, validateVisual } from "./visual";
import type { VisualIssue } from "./visual";
import { validateTemplate } from "./template";
import { PIPES_FITTINGS_STARTER } from "./starterTemplatesPipes";
import { PRECAST_ELEMENTS_STARTER } from "./starterTemplatesPrecast";
import { CIVIL_STARTERS } from "./starterTemplatesCivil";
import type { TemplateInput } from "./types";

const num = (key: string, unit?: string): TemplateInput => ({ key, label: key, type: "number", default: 1, ...(unit ? { unit } : {}) });

describe("inferring what each number input stands for", () => {
  it("reads the role words in a key", () => {
    expect(keyWords("room_length_m")).toEqual(["room", "length", "m"]);
    expect(keyWords("wallHeight2")).toEqual(["wall", "height"]);
    const m = inferVisualMapping([num("length_m", "m"), num("width_m", "m"), num("height_m", "m")]);
    expect(m).toEqual({ length: "length_m", width: "width_m", height: "height_m" });
  });

  it("reads short forms: len, w, h, n", () => {
    expect(inferVisualMapping([num("slab_n", "nr"), num("slab_len_m", "m"), num("slab_w_m", "m"), num("slab_h_m", "m")]))
      .toEqual({ count: "slab_n", length: "slab_len_m", width: "slab_w_m", height: "slab_h_m" });
  });

  it("reads the unit: m2 is an area, nr / nos / qty is a count", () => {
    expect(inferVisualMapping([num("wall_area_m2", "m²")])).toEqual({ area: "wall_area_m2" });
    expect(inferVisualMapping([num("surface", "m2")])).toEqual({ area: "surface" });
    expect(inferVisualMapping([num("manholes", "nr")])).toEqual({ count: "manholes" });
    expect(inferVisualMapping([num("fittings", "nos")])).toEqual({ count: "fittings" });
    expect(inferVisualMapping([num("lamps", "qty")])).toEqual({ count: "lamps" });
  });

  it("finds a run by its word (pipe, fence, trench ...)", () => {
    expect(inferVisualMapping([num("pipe_len_m", "m"), num("cable_m", "m")])).toEqual({ run: "pipe_len_m" });
    expect(inferVisualMapping([num("fence_m", "m")])).toEqual({ run: "fence_m" });
  });

  it("never uses an input twice and never reads settings as sizes", () => {
    const m = inferVisualMapping([num("tile_length_mm", "mm"), num("straining_spacing_m", "m"), num("haul_km", "km"), num("border_mm", "mm"), num("length_m", "m")]);
    expect(m).toEqual({ length: "length_m" });
    const values = Object.values(inferVisualMapping([num("n_units", "nr"), num("units_per_row", "nr")]));
    expect(new Set(values).size).toBe(values.length);
  });

  it("ignores select and yes/no inputs", () => {
    const sel: TemplateInput = { key: "length_class", label: "x", type: "select", default: "a", options: [{ key: "a", label: "A", value: 1 }] };
    expect(inferVisualMapping([sel])).toEqual({});
  });

  it("gives nothing for a template with no sizes at all", () => {
    expect(inferVisualMapping([num("margin", "%"), num("hours", "h")])).toEqual({});
  });

  it("finds a volume input for a template that only has one", () => {
    expect(inferVolumeKey([num("exc_m3", "m³"), num("dump_km", "km")])).toBe("exc_m3");
    expect(inferVolumeKey([num("length_m", "m")])).toBeUndefined();
  });
});

describe("the mapping a template resolves to", () => {
  const inputs = [num("length_m", "m"), num("valves_n", "nr"), num("depth_m", "m")];
  it("uses the template's own mapping when it names a role, and only that", () => {
    expect(resolveVisualMapping({ run: "length_m" }, inputs)).toEqual({ run: "length_m" });
  });
  it("falls back to inference when the mapping is empty or absent", () => {
    expect(resolveVisualMapping(undefined, inputs)).toEqual(inferVisualMapping(inputs));
    expect(resolveVisualMapping(null, inputs)).toEqual(inferVisualMapping(inputs));
    expect(resolveVisualMapping({ picture: "none" }, inputs)).toEqual(inferVisualMapping(inputs));
    expect(hasVisualMapping({ picture: "none" })).toBe(false);
  });
  it("drops a key that is not a number input of the template", () => {
    expect(resolveVisualMapping({ run: "gone", count: "valves_n" }, inputs)).toEqual({ count: "valves_n" });
  });
});

describe("validating the visual of a template", () => {
  const inputs: TemplateInput[] = [num("length_m", "m"), { key: "kind", label: "k", type: "select", default: "a", options: [{ key: "a", label: "A", value: 1 }] }];
  const run = (raw: unknown) => { const issues: VisualIssue[] = []; const v = validateVisual(raw, inputs, issues); return { v, issues }; };

  it("accepts input keys and the none switch; absent or empty is nothing", () => {
    expect(run({ run: "length_m" })).toEqual({ v: { run: "length_m" }, issues: [] });
    expect(run({ picture: "none" }).v).toEqual({ picture: "none" });
    expect(run(undefined).v).toBeUndefined();
    expect(run({}).v).toBeUndefined();
  });
  it("refuses keys that are not number inputs, unknown settings and a wrong shape", () => {
    expect(run({ run: "nope" }).issues[0].path).toBe("visual.run");
    expect(run({ run: "kind" }).issues[0].path).toBe("visual.run");
    expect(run({ colour: "red" }).issues[0].path).toBe("visual.colour");
    expect(run({ picture: "yes" }).issues[0].path).toBe("visual.picture");
    expect(run([]).issues[0].path).toBe("visual");
    expect(run({ run: 5 }).issues[0].path).toBe("visual.run");
  });
});

describe("visual in a whole template", () => {
  const body = {
    inputs: [num("length_m", "m")],
    rates: [{ key: "r", label: "r", unit: "m", value: 1 }],
    rules: [{ code: "a", group: "G", description: "A", uom: "m", qty: "length_m", component: "materials", cost: { kind: "rate", rate: "r" } }],
  };
  it("is kept by the validator and checked against the template's inputs", () => {
    const ok = validateTemplate({ ...body, visual: { run: "length_m" } });
    expect(ok.ok && ok.template?.visual).toEqual({ run: "length_m" });
    const bad = validateTemplate({ ...body, visual: { run: "x" } });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.path === "visual.run")).toBe(true);
  });
  it("is left out when empty", () => {
    const v = validateTemplate({ ...body, visual: {} });
    expect(v.ok && "visual" in (v.template ?? {})).toBe(false);
  });
});

describe("the starter mappings", () => {
  it("name real number inputs of their template and the template still validates", () => {
    for (const s of [PIPES_FITTINGS_STARTER, PRECAST_ELEMENTS_STARTER]) {
      expect(s.visual, s.name).toBeTruthy();
      const v = validateTemplate({ inputs: s.inputs, rates: s.rates, rules: s.rules, visual: s.visual });
      expect(v.ok, `${s.name}: ${JSON.stringify(v.issues)}`).toBe(true);
      expect(v.template?.visual).toEqual(s.visual);
    }
  });
  it("the other civil starters can be inferred without error", () => {
    for (const s of CIVIL_STARTERS) expect(() => inferVisualMapping(s.inputs)).not.toThrow();
  });
});
