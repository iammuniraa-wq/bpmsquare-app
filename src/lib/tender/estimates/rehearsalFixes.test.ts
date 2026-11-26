import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toBody, toDraft } from "@/components/estimator/templateDraft";
import { validateTemplate } from "@/lib/estimator/template";
import { BLOCKWORK_PLASTER_STARTER, CONCRETE_WORKS_STARTER, EXCAVATION_STARTER } from "@/lib/estimator/starterTemplatesCivil";
import { PIPES_FITTINGS_STARTER } from "@/lib/estimator/starterTemplatesPipes";
import { PRECAST_ELEMENTS_STARTER } from "@/lib/estimator/starterTemplatesPrecast";
import { TILES_FLOOR_STARTER } from "@/lib/estimator/starterTemplatesTiles";
import { filterCounts, filterRows, needsRepriceRow, type RowLike } from "@/lib/tender/boq/table";
import {
  gradeParams, measuredQuantity, paramsEdited, prefillParams, priceableParts, pricesSeveralParts, quantityCheck, quantityView, suggestTemplate,
  type EstLine, type QtyInputDef, type TemplateHint,
} from "./rules";

// The rehearsal of the tender flow on a 43-line BOQ (2026-11-26): what "Build up this rate" fills in, which template it offers, when an
// estimate is for a whole scope, and which BOQ rows say "Re-price".

const inputsOf = (t: { inputs: unknown }) => t.inputs as QtyInputDef[];

describe("the BOQ quantity is declared by the template, in data (defect 4)", () => {
  it("fills the excavation volume for a line in m3, the blockwork wall area for m2, the concrete volume for m3 and the pipeline length for m", () => {
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "m3", 62400)).toEqual({ exc_m3: 62400 });
    expect(prefillParams(inputsOf(BLOCKWORK_PLASTER_STARTER), "m2", 8400)).toEqual({ wall_area_m2: 8400 });
    expect(prefillParams(inputsOf(CONCRETE_WORKS_STARTER), "m3", 6480)).toEqual({ concrete_m3: 6480 });
    expect(prefillParams(inputsOf(PIPES_FITTINGS_STARTER), "m", 420)).toEqual({ length_m: 420 });
  });

  it("reads the unit in any spelling, and nothing is filled for a unit the template does not declare", () => {
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "cu.m", 100)).toEqual({ exc_m3: 100 });
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "m³", 100)).toEqual({ exc_m3: 100 });
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "nr", 100)).toEqual({});
    expect(prefillParams(inputsOf(BLOCKWORK_PLASTER_STARTER), "m3", 100)).toEqual({});
  });

  it("the excavation template has several m3 inputs, so only the declaration can tell which takes the line's quantity", () => {
    const m3 = inputsOf(EXCAVATION_STARTER).filter((i) => i.unit === "m³");
    expect(m3.length).toBeGreaterThan(1);
    const bare = inputsOf(EXCAVATION_STARTER).map(({ boq_units: _gone, ...rest }) => rest);
    expect(prefillParams(bare, "m3", 62400)).toEqual({});
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "m3", 62400)).toEqual({ exc_m3: 62400 });
  });

  it("an input is never set outside its range", () => {
    expect(prefillParams(inputsOf(EXCAVATION_STARTER), "m3", 2_000_000)).toEqual({});
  });

  it("the quantity check follows the declaration: matching, then a different number, never 'unknown' for a declared unit", () => {
    const inputs = inputsOf(EXCAVATION_STARTER);
    expect(quantityCheck({ inputs, params: { exc_m3: 62400 }, boqUnit: "m3", boqQty: 62400 }).status).toBe("matches");
    expect(quantityCheck({ inputs, params: {}, boqUnit: "m3", boqQty: 62400 })).toMatchObject({ status: "mismatch", measured: 500 });
    expect(measuredQuantity(inputs, { exc_m3: 1000 }, "m3")).toBe(1000);
  });

  it("two inputs declaring the same unit declare nothing: the older rules decide", () => {
    const twice: QtyInputDef[] = [
      { key: "a_m3", type: "number", unit: "m³", boq_units: ["m3"] }, { key: "b_m3", type: "number", unit: "m³", boq_units: ["m3"] },
    ];
    expect(prefillParams(twice, "m3", 10)).toEqual({});
  });

  it("the civil and pipe starters declare it; the whole-scope starters (precast elements, floor tiles) do not", () => {
    for (const t of [EXCAVATION_STARTER, CONCRETE_WORKS_STARTER, BLOCKWORK_PLASTER_STARTER, PIPES_FITTINGS_STARTER]) {
      expect(inputsOf(t).some((i) => (i.boq_units?.length ?? 0) > 0), t.name).toBe(true);
    }
    expect(inputsOf(PRECAST_ELEMENTS_STARTER).some((i) => i.boq_units)).toBe(false);
    expect(inputsOf(TILES_FLOOR_STARTER).some((i) => i.boq_units)).toBe(false);
  });

  it("survives the template validator and the editor's round trip, so a copy of a starter keeps it", () => {
    const check = validateTemplate({ ...EXCAVATION_STARTER });
    expect(check.ok).toBe(true);
    expect(check.template?.inputs.find((i) => i.key === "exc_m3")?.boq_units).toEqual(["m3"]);
    const body = toBody(toDraft({ ...EXCAVATION_STARTER, description: "", trade: "", geometry: null, quote_granularity: "group", drawing_map: null, visual: null }));
    expect(body.inputs.find((i) => i.key === "exc_m3")?.boq_units).toEqual(["m3"]);
    expect(body.inputs.find((i) => i.key === "soil_type")?.boq_units).toBeUndefined();
  });
});

describe("the 'not filled in automatically' banner goes once the person has set the quantity (defect 4)", () => {
  const unknown = { status: "unknown" as const, measured: null, boq_qty: 62400, uom: "m3" };

  it("shows for an untouched estimate and goes when a number was changed from its default", () => {
    expect(quantityView(unknown, false, "A1005", null, false).note).toContain("not filled in automatically");
    const view = quantityView(unknown, false, "A1005", null, true);
    expect(view.note).toBeNull();
    expect(view.needs_confirm).toBe(true);
  });

  it("an edit is a number that differs from the template's default, not just a stored one", () => {
    const inputs = inputsOf(EXCAVATION_STARTER);
    expect(paramsEdited(inputs, {})).toBe(false);
    expect(paramsEdited(inputs, { exc_m3: 500 })).toBe(false);
    expect(paramsEdited(inputs, { exc_m3: 62400 })).toBe(true);
    expect(paramsEdited(inputs, { soil_type: "rock" })).toBe(false);
    expect(paramsEdited(null, { exc_m3: 1 })).toBe(false);
  });
});

const estLine = (n: number, wbs: string, cost: number): EstLine => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`, code: `c${n}`, description: `Line ${n}`, uom: "m3", qty: 1, waste_pct: 0, unit_cost: cost, cost_total: cost,
  component: "materials", wbs_code: wbs, product_id: null, custom_data: null, updated_at: "2026-11-26T00:00:00Z",
});

describe("an estimate that prices several parts is never applied whole to one line (defect 1)", () => {
  const plant = [estLine(1, "1.1", 100), estLine(2, "2.1", 200), estLine(3, "3.1", 300)];
  const buildUp = [estLine(1, "1.1", 100)];

  it("counts the WBS groups that carry cost; with no WBS codes, the cost lines", () => {
    expect(priceableParts(plant)).toBe(3);
    expect(priceableParts(buildUp)).toBe(1);
    expect(priceableParts([estLine(1, "1.1", 100), estLine(2, "1.2", 50)])).toBe(1);
    expect(priceableParts([{ ...estLine(1, "1.1", 0) }, estLine(2, "2.1", 50)])).toBe(1);
    expect(priceableParts([{ ...estLine(1, "", 10), wbs_code: null }, { ...estLine(2, "", 20), wbs_code: null }])).toBe(2);
  });

  it("several parts and no quantity input to read: pick a part", () => {
    expect(pricesSeveralParts(plant, "unknown")).toBe(true);
  });

  it("a build-up whose quantity input is known keeps Apply, even with several groups, and so does a single part", () => {
    expect(pricesSeveralParts(plant, "matches")).toBe(false);
    expect(pricesSeveralParts(plant, "mismatch")).toBe(false);
    expect(pricesSeveralParts(buildUp, "unknown")).toBe(false);
    expect(pricesSeveralParts(plant, undefined)).toBe(false);
  });
});

describe("the template offered for a BOQ line (defect 5)", () => {
  const T = (id: string, name: string, keywords: string[], inputs: QtyInputDef[] = [], trade = "civil works"): TemplateHint => ({ id, name, trade, keywords, inputs });
  const templates: TemplateHint[] = [
    T("blk", "Blockwork and plaster (illustrative)", ["blockwork", "block", "plaster", "wall"], inputsOf(BLOCKWORK_PLASTER_STARTER)),
    T("exc", "Excavation and backfill (illustrative)", ["excavation", "backfill", "soil", "earthworks"], inputsOf(EXCAVATION_STARTER)),
    T("rc", "Reinforced concrete (illustrative)", ["concrete", "reinforced concrete", "formwork", "rebar"], inputsOf(CONCRETE_WORKS_STARTER)),
    T("plant", "Plant civil package", ["soil", "tank", "waterproofing"], [], "wastewater"),
  ];

  it("picks the template that reads like the line, from its keywords, name and the unit it declares", () => {
    expect(suggestTemplate(templates, "A1005 Soil replacement (m3)", "m3")).toBe("exc");
    expect(suggestTemplate(templates, "Reinforced concrete grade C35 in raft foundations", "m3")).toBe("rc");
    expect(suggestTemplate(templates, "200 mm hollow block walls, plastered both sides", "m2")).toBe("blk");
  });

  it("a whole-scope template with the same keyword does not outrank the build-up whose unit matches", () => {
    expect(suggestTemplate(templates, "Soil replacement", "m3")).toBe("exc");
  });

  it("nothing is preselected when nothing fits, or when two fit equally", () => {
    expect(suggestTemplate(templates, "Provision of site accommodation for the engineer", "month")).toBeNull();
    expect(suggestTemplate(templates, "", "m3")).toBeNull();
    expect(suggestTemplate([T("a", "Alpha", ["pump"]), T("b", "Beta", ["pump"])], "Duty pump", "nr")).toBeNull();
    expect(suggestTemplate([], "Soil", "m3")).toBeNull();
  });

  it("reads plurals and keeps a one-word coincidence below the bar", () => {
    expect(suggestTemplate(templates, "Walls of blocks", "m2")).toBe("blk");
    expect(suggestTemplate([T("x", "Sample", ["rock"], [], "")], "Rocket launcher", "nr")).toBeNull();
  });

  it("the starters' own keywords find the lines of a civil BOQ", () => {
    const real: TemplateHint[] = [EXCAVATION_STARTER, CONCRETE_WORKS_STARTER, BLOCKWORK_PLASTER_STARTER, PIPES_FITTINGS_STARTER].map((t) => ({
      id: t.name, name: t.name, trade: t.trade ?? null, keywords: t.keywords ?? [], inputs: inputsOf(t),
    }));
    expect(suggestTemplate(real, "Bulk excavation in soft soil", "m3")).toBe(EXCAVATION_STARTER.name);
    expect(suggestTemplate(real, "Reinforced concrete C35 in foundations", "m3")).toBe(CONCRETE_WORKS_STARTER.name);
    expect(suggestTemplate(real, "Concrete block walls 200 mm", "m2")).toBe(BLOCKWORK_PLASTER_STARTER.name);
  });
});

describe("a concrete grade named in the line is chosen (defect 5)", () => {
  const inputs = inputsOf(CONCRETE_WORKS_STARTER);

  it("C35 in the line sets the grade select to C35", () => {
    expect(gradeParams(inputs, "Reinforced concrete C35 for raft")).toEqual({ concrete_grade: "c35" });
    expect(gradeParams(inputs, "RC grade C 40/50 columns")).toEqual({ concrete_grade: "c40" });
    expect(gradeParams(inputs, "concrete c25")).toEqual({ concrete_grade: "c25" });
  });

  it("a grade the template does not have, a line with none, or a template with no grade changes nothing", () => {
    expect(gradeParams(inputs, "Concrete C99")).toEqual({});
    expect(gradeParams(inputs, "Reinforced concrete")).toEqual({});
    expect(gradeParams(inputsOf(EXCAVATION_STARTER), "C35 concrete")).toEqual({});
    expect(gradeParams(inputs, null)).toEqual({});
  });
});

describe("a row says Re-price when its estimate changed (defect 6)", () => {
  const row = (id: string, over: Partial<RowLike> = {}): RowLike & { id: string } => ({
    id, item_no: id, row_no: 1, priced: true, removed: false, price_source: "estimate", price_source_ref: "EST-1", stale: false, stale_accepted: false, ...over,
  });
  const rows = [row("a"), row("b"), row("c", { stale: true }), row("d", { priced: false })];
  const links = [
    { boq_id: "a", stale: true, waiting: false, broken: false },
    { boq_id: "b", stale: true, waiting: true, broken: false },
    { boq_id: "d", stale: true, waiting: false, broken: true },
  ];

  it("a stale link on a priced row counts; a build-up still waiting or a broken link does not", () => {
    expect(needsRepriceRow("a", links)).toBe(true);
    expect(needsRepriceRow("b", links)).toBe(false);
    expect(needsRepriceRow("d", links)).toBe(false);
    expect(needsRepriceRow("zzz", links)).toBe(false);
    expect(needsRepriceRow(undefined, links)).toBe(false);
  });

  it("the Stale filter and its counter include the row whose estimate changed, beside the rows with an old price", () => {
    expect(filterCounts(rows, links).stale).toBe(2);
    expect(filterRows(rows, "stale", links).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterCounts(rows).stale).toBe(1);
    expect(filterRows(rows, "stale").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("the one-workspace script that declares the quantity on installed starters (defect 4)", () => {
  const sql = readFileSync(join(process.cwd(), "scripts/estimator-boq-prefill-keys-2026-11-26.sql"), "utf8");

  it("takes one slug at the top and stops, changing nothing, when no workspace has it", () => {
    expect(sql).toMatch(/v_slug text := '[^']*'; -- CHANGE THIS/);
    expect(sql).toContain("No workspace with slug % was found. Nothing was changed.");
    expect(sql.indexOf("raise exception 'No workspace with slug")).toBeLessThan(sql.indexOf("update estimate_templates"));
  });

  it("only adds: locked starters only, an input that already has a list is left, nothing is deleted", () => {
    expect(sql).toContain("et.locked = true");
    expect(sql).toContain("not (x.e ? 'boq_units')");
    expect(sql).not.toMatch(/\bdelete\b|\bdrop\b|\btruncate\b/i);
  });

  it("names the same input and unit as the starters declare", () => {
    for (const t of [EXCAVATION_STARTER, CONCRETE_WORKS_STARTER, BLOCKWORK_PLASTER_STARTER, PIPES_FITTINGS_STARTER]) {
      const input = inputsOf(t).find((i) => i.boq_units?.length);
      expect(input, t.name).toBeTruthy();
      expect(sql).toContain(`'${t.name}', '${input!.key}', '${JSON.stringify(input!.boq_units)}'::jsonb`);
    }
  });
});
