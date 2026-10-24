import { describe, it, expect } from "vitest";
import { validateTemplate } from "./template";
import { computeEstimate } from "./compute";
import { getGeometry } from "./geometry";
import type { GeometryModule } from "./geometry";
import { CHAINLINK_FENCE_STARTER, PRECAST_VILLA_STARTER } from "./starterTemplates";
import { resolveVisuals } from "./visuals";
import { toDraft, toBody } from "@/components/estimator/templateDraft";
import type { EstimateTemplateBody, TemplateInput } from "./types";

const baseWith = (input: TemplateInput, extra: Partial<EstimateTemplateBody> = {}): EstimateTemplateBody => ({
  inputs: [{ key: "x", label: "X", type: "number", default: 2 }, input],
  rates: [{ key: "r", label: "R", unit: "per m", value: 10 }],
  rules: [{ code: "a", group: "Main", description: "A", uom: "m", qty: "x", component: "materials", cost: { kind: "rate", rate: "r" } }],
  ...extra,
});

const paintInput = (over: Partial<TemplateInput> = {}): TemplateInput => ({
  key: "colour", label: "Colour", type: "select", default: "a", paints: "wall",
  options: [{ key: "a", label: "A", value: 1, visual: "concrete_precast" }, { key: "b", label: "B", value: 2, visual: "#d9ccb4" }],
  ...over,
});

const issues = (t: unknown) => validateTemplate(t).issues.map((i) => `${i.path}: ${i.message}`);

/** Declares slots on a geometry module for one test (modules in other branches add their own). */
function withSlots<T>(key: string, slots: GeometryModule["slots"], run: () => T): T {
  const mod = getGeometry(key) as { slots?: GeometryModule["slots"] };
  const before = mod.slots;
  mod.slots = slots;
  try { return run(); } finally { mod.slots = before; }
}

describe("design attributes: validation", () => {
  it("keeps paints and visual through validation", () => {
    const v = validateTemplate(baseWith(paintInput()));
    expect(v.issues).toEqual([]);
    const inp = v.template!.inputs.find((i) => i.key === "colour")!;
    expect(inp.paints).toBe("wall");
    expect(inp.options?.map((o) => o.visual)).toEqual(["concrete_precast", "#d9ccb4"]);
  });

  it("rejects paints on a number or yes/no input", () => {
    const n = baseWith({ key: "y", label: "Y", type: "number", default: 1, paints: "wall" } as TemplateInput);
    expect(issues(n).join("\n")).toMatch(/inputs\[1\]\.paints: Only a choice input/);
    const b = baseWith({ key: "y", label: "Y", type: "boolean", default: true, paints: "wall" } as TemplateInput);
    expect(issues(b).join("\n")).toMatch(/paints: Only a choice input/);
  });

  it("rejects a visual that is neither a catalogue material nor a #rrggbb colour", () => {
    const t = baseWith(paintInput({ options: [{ key: "a", label: "A", value: 1, visual: "shiny_gold" }, { key: "b", label: "B", value: 2, visual: "#fff" }] }));
    const out = issues(t);
    expect(out.some((m) => m.startsWith("inputs[1].options[0].visual") && m.includes("shiny_gold"))).toBe(true);
    expect(out.some((m) => m.startsWith("inputs[1].options[1].visual"))).toBe(true);
  });

  it("rejects a malformed slot key", () => {
    expect(issues(baseWith(paintInput({ paints: "Wall Panel" }))).join("\n")).toMatch(/inputs\[1\]\.paints: Paints must name a part/);
  });

  it("tolerates a layout that declares no slots, and warns when there is no layout at all", () => {
    const withLayout = validateTemplate({ ...PRECAST_VILLA_STARTER });
    expect(withLayout.ok).toBe(true);
    const noLayout = validateTemplate(baseWith(paintInput()));
    expect(noLayout.ok).toBe(true);
    expect(noLayout.warnings.map((w) => w.path)).toContain("inputs[1].paints");
    expect(noLayout.warnings.some((w) => w.message.includes("is not used by any rule"))).toBe(false);
  });

  it("rejects an unknown slot when the layout declares its parts, and accepts a known one", () => {
    withSlots("precast_villa", [{ key: "wall", label: "Walls", default: "concrete_precast" }, { key: "slab", label: "Slabs", default: "concrete_precast" }], () => {
      expect(validateTemplate(PRECAST_VILLA_STARTER).ok).toBe(true);
      const bad = { ...PRECAST_VILLA_STARTER, inputs: PRECAST_VILLA_STARTER.inputs.map((i) => (i.key === "wall_colour" ? { ...i, paints: "roof" } : i)) };
      const out = issues(bad);
      expect(out.length).toBe(1);
      expect(out[0]).toMatch(/\.paints: The "precast_villa" model has no part called "roof"\. Parts you can repaint: wall, slab\./);
    });
  });
});

describe("design attributes: editor round trip", () => {
  it("toDraft then toBody keeps paints and each option's visual", () => {
    const t = validateTemplate(baseWith(paintInput())).template!;
    const draft = toDraft({ name: "T", description: null, trade: null, quote_granularity: "line", geometry: null, inputs: t.inputs, rates: t.rates, rules: t.rules });
    const back = toBody(draft);
    const inp = back.inputs.find((i) => i.key === "colour")!;
    expect(inp.paints).toBe("wall");
    expect(inp.options?.map((o) => o.visual)).toEqual(["concrete_precast", "#d9ccb4"]);
    expect(validateTemplate(back).ok).toBe(true);
  });

  it("a choice that paints nothing carries no paints", () => {
    const t = validateTemplate(baseWith(paintInput({ paints: undefined, options: [{ key: "a", label: "A", value: 1 }] }))).template!;
    const body = toBody(toDraft({ name: "T", description: null, trade: null, quote_granularity: "line", geometry: null, inputs: t.inputs, rates: t.rates, rules: t.rules }));
    expect(body.inputs.find((i) => i.key === "colour")).not.toHaveProperty("paints");
  });
});

describe("design attributes: starter templates", () => {
  const lines = (t: EstimateTemplateBody, params: Record<string, string>) => {
    const v = validateTemplate(t);
    const res = computeEstimate(v.template!, params, {});
    expect(res.ok).toBe(true);
    return res.ok ? JSON.stringify(res.lines) : "";
  };

  it("the fence and precast starters paint the documented parts", () => {
    const paints = (t: EstimateTemplateBody) => Object.fromEntries(t.inputs.filter((i) => i.paints).map((i) => [i.key, i.paints]));
    expect(paints(CHAINLINK_FENCE_STARTER)).toEqual({ mesh_colour: "mesh", post_colour: "posts" });
    expect(paints(PRECAST_VILLA_STARTER)).toEqual({ wall_colour: "wall", slab_colour: "slab" });
  });

  it("choosing a colour never changes the bill of materials", () => {
    expect(lines(CHAINLINK_FENCE_STARTER, { mesh_colour: "black", post_colour: "blue" })).toBe(lines(CHAINLINK_FENCE_STARTER, {}));
    expect(lines(PRECAST_VILLA_STARTER, { wall_colour: "white", slab_colour: "sand" })).toBe(lines(PRECAST_VILLA_STARTER, {}));
  });

  it("every option of a design attribute resolves to a visual", () => {
    for (const t of [CHAINLINK_FENCE_STARTER, PRECAST_VILLA_STARTER]) {
      const slots = t.inputs.filter((i) => i.paints).map((i) => ({ key: i.paints!, label: i.paints!, default: "#000000" }));
      for (const inp of t.inputs.filter((i) => i.paints)) {
        for (const o of inp.options ?? []) {
          expect(resolveVisuals(slots, t.inputs, { [inp.key]: o.key })[inp.paints!]).toBe(o.visual);
        }
      }
    }
  });
});
