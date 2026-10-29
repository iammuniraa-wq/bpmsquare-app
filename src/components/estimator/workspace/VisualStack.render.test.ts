import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

import VisualStack from "./VisualStack";
import CustomerPreview from "./CustomerPreview";
import EstimateVisualStrip, { CustomerVisualStrip } from "@/components/estimator/EstimateVisualStrip";
import { pictureFor } from "./picture";
import { previewKindFor } from "./layoutKind";
import { shownFromPreview } from "./shown";
import { initialValues, toParams } from "@/components/estimator/InputsForm";
import { previewEstimate } from "@/lib/estimator/preview";
import { buildStrip, customerStrip } from "@/lib/estimator/visualStrip";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";
import { PIPES_FITTINGS_STARTER } from "@/lib/estimator/starterTemplatesPipes";
import type { EstimateTemplateBody, TemplateVisual } from "@/lib/estimator/types";
import type { WorkspaceTemplate } from "./types";

const clean = (h: string) => h.replace(/<!-- -->/g, "");
const money = (n: number) => `SAR ${Math.round(n)}`;

type Body = EstimateTemplateBody & { visual?: TemplateVisual };
function wt(b: Body, over: Partial<WorkspaceTemplate> = {}): WorkspaceTemplate {
  return { id: "t", name: "T", description: null, geometry: b.geometry ?? null, inputs: b.inputs, rates: b.rates, rules: b.rules, quote_granularity: "group", visual: b.visual ?? null, ...over };
}

/** What the workspace does with a template: preview it, take the picture, take the strip. */
function stack(t: WorkspaceTemplate, values: Record<string, number | string | boolean> = {}) {
  const params = toParams(t.inputs, initialValues(t.inputs, values));
  const p = previewEstimate({ template: { ...(t.geometry ? { geometry: t.geometry } : {}), inputs: t.inputs, rates: t.rates, rules: t.rules }, params, margin_pct: 10, vat_pct: 15 });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  const shown = shownFromPreview(p);
  const picture = pictureFor(t, shown.model, params, shown.lines);
  const strip = buildStrip(shown.totals, shown.lines);
  const html = clean(renderToString(createElement(VisualStack, { picture, fenceView: null, strip, rates: t.rates, money })));
  return { html, picture, strip, shown };
}

const formulaOnly: Body = {
  inputs: [{ key: "hours", label: "Hours", type: "number", default: 40, unit: "h" }],
  rates: [{ key: "rate", label: "Rate", unit: "per h", value: 80 }, { key: "fee", label: "Fee", unit: "each", value: 500 }],
  rules: [
    { code: "labour", group: "Labour", description: "Site labour", uom: "h", qty: "hours", component: "labour", cost: { kind: "rate", rate: "rate" } },
    { code: "mob", group: "Set-up", description: "Mobilisation", uom: "nr", qty: "1", component: "overhead", cost: { kind: "rate", rate: "fee" } },
  ],
};

const dimensioned: Body = {
  inputs: [
    { key: "pipe_length_m", label: "Pipe length", type: "number", default: 240, unit: "m" },
    { key: "manholes", label: "Manholes", type: "number", default: 4, unit: "nr" },
  ],
  rates: [{ key: "pipe", label: "Pipe", unit: "per m", value: 90 }, { key: "mh", label: "Manhole", unit: "each", value: 2500 }],
  rules: [
    { code: "pipe", group: "Pipework", description: "Concrete pipe laid", uom: "m", qty: "pipe_length_m", component: "materials", cost: { kind: "rate", rate: "pipe" } },
    { code: "mh", group: "Chambers", description: "Manholes", uom: "nr", qty: "manholes", component: "erection", cost: { kind: "rate", rate: "mh" } },
  ],
};

describe("a formula-only template (no dimensions, no module)", () => {
  const { html, picture, strip } = stack(wt(formulaOnly));
  it("has no picture but always has the composition strip", () => {
    expect(picture.kind).toBe("none");
    expect(strip).not.toBeNull();
    expect(html).toContain("Where the cost goes");
    expect(html).toContain("Labour");
    expect(html).toContain("Set-up");
    expect(html).not.toContain("The layout");
  });
  it("shows the amount and the share of each group, and the components", () => {
    expect(html).toContain("SAR 3200");
    expect(html).toContain("SAR 500");
    expect(html).toContain("86%");
    expect(html).toContain("Production labour");
    expect(html).toContain("data-guide=\"estimate.strip\"");
  });
  it("is a small card at 375 px: the rows wrap and nothing has a fixed width", () => {
    expect(html).toContain("est-strip-head");
    expect(html).not.toMatch(/width:\s*\d{3,}px/);
  });
});

describe("a template with dimensions", () => {
  const { html, picture, shown } = stack(wt(dimensioned));
  it("is drawn from its inputs: the layout card and the strip", () => {
    expect(picture.kind).toBe("generic");
    expect(picture.model?.pieces.length).toBeGreaterThan(5);
    expect(html).toContain("The layout");
    expect(html).toContain("Where the cost goes");
  });
  it("lights up a line's pieces through the marks given to the line", () => {
    const pipe = picture.lines.find((l) => l.code === "pipe")!;
    expect(pipe.element_ref).toMatch(/^RN-01\.\.RN-\d+$/);
    expect(shown.lines.find((l) => l.code === "pipe")!.element_ref).toBeNull();
  });
  it("follows the numbers: more length, more pieces and a different strip", () => {
    const longer = stack(wt(dimensioned), { pipe_length_m: 480 });
    expect(longer.picture.model!.pieces.length).toBeGreaterThan(picture.model!.pieces.length);
    expect(longer.strip!.groups[0].pct).not.toBe(stack(wt(dimensioned)).strip!.groups[0].pct);
  });
  it("can be switched off, and maps its roles when told to", () => {
    expect(stack(wt(dimensioned, { visual: { picture: "none" } })).picture.kind).toBe("none");
    const mapped = stack(wt(dimensioned, { visual: { run: "pipe_length_m" } }));
    expect(new Set(mapped.picture.model!.pieces.map((p) => p.code))).toEqual(new Set(["RN"]));
  });
  it("shows a line without a price as a pill", () => {
    const t = wt({ ...dimensioned, rules: [...dimensioned.rules, { code: "valve", group: "Valves", description: "Gate valves", uom: "nr", qty: "manholes", component: "materials", cost: { kind: "product", sku: "NOPE" } }] });
    const p = previewEstimate({ template: { inputs: t.inputs, rates: t.rates, rules: t.rules }, params: toParams(t.inputs, {}), margin_pct: 0, vat_pct: 0 });
    if (!p.ok) throw new Error("no preview");
    const shownP = shownFromPreview(p);
    const html2 = clean(renderToString(createElement(EstimateVisualStrip, { strip: buildStrip(shownP.totals, shownP.lines)!, money })));
    expect(html2).toContain("No price yet: Gate valves");
  });
});

describe("the villa (bespoke 3D)", () => {
  const t = wt({ geometry: PRECAST_VILLA_STARTER.geometry, inputs: PRECAST_VILLA_STARTER.inputs, rates: PRECAST_VILLA_STARTER.rates, rules: PRECAST_VILLA_STARTER.rules });
  const { html, picture } = stack(t);
  it("keeps its own model, not the sketch from the inputs", () => {
    expect(picture.kind).toBe("pieces");
    expect(picture.model?.geometry).toBe("precast_villa");
    expect(picture.model?.illustrative).toBeUndefined();
    expect(html).toContain("The villa");
    expect(html).not.toContain("The layout");
  });
  it("and still has the strip", () => {
    expect(html).toContain("Where the cost goes");
  });
  it("is never overridden by a visual mapping", () => {
    expect(stack({ ...t, visual: { picture: "none" } }).picture.kind).toBe("pieces");
  });
});

describe("a catalogue-priced template with a mapping (pipes)", () => {
  it("draws a run with its valves as units", () => {
    const t = wt(PIPES_FITTINGS_STARTER, { visual: PIPES_FITTINGS_STARTER.visual });
    const params = toParams(t.inputs, initialValues(t.inputs));
    const model = pictureFor(t, null, params, []).model!;
    expect(model.pieces.filter((p) => p.code === "RN").length).toBeGreaterThan(50);
    expect(model.pieces.filter((p) => p.code === "UN")).toHaveLength(2);
  });
});

describe("the picture kind", () => {
  it("is the trade's own for a module, else generic when a picture exists, else none", () => {
    expect(previewKindFor("chainlink_fence")).toBe("fence");
    expect(previewKindFor("precast_villa")).toBe("pieces");
    expect(previewKindFor(null, true)).toBe("generic");
    expect(previewKindFor(null)).toBe("none");
  });
});

describe("the customer-facing strip", () => {
  const strip = stack(wt(dimensioned)).strip!;
  it("is a static SVG with shares and no amount", () => {
    const html = clean(renderToString(createElement(CustomerVisualStrip, { strip: customerStrip(strip)! })));
    expect(html).toContain("<svg");
    expect(html).toContain("Pipework");
    expect(html).toContain("%");
    expect(html).not.toMatch(/SAR|amount|cost/i);
    expect(html).not.toContain("<script");
  });
  it("sits in the quote preview only when the template is customer-visible, and never shows an amount of its own", () => {
    const p = previewEstimate({ template: dimensioned, params: toParams(dimensioned.inputs, {}), margin_pct: 10, vat_pct: 15 });
    if (!p.ok) throw new Error("no preview");
    const props = { view: p.view, options: null, money, customer: "ACME", quote: null };
    const withStrip = clean(renderToString(createElement(CustomerPreview, { ...props, strip: customerStrip(strip) })));
    const without = clean(renderToString(createElement(CustomerPreview, { ...props, strip: null })));
    expect(withStrip).toContain("<svg");
    expect(without).not.toContain("<svg");
    const svg = withStrip.slice(withStrip.indexOf("<svg"), withStrip.indexOf("</svg>"));
    expect(svg).not.toContain("SAR");
  });
});
