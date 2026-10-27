import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STARTER_TEMPLATES } from "./starterTemplates";
import type { StarterTemplate } from "./starterTemplates";
import { validateTemplate } from "./template";
import { computeEstimate } from "./compute";
import type { ComputeSuccess } from "./compute";
import { parseMatchKey } from "./productMatch";
import { TEMPLATE_ICONS } from "./requests";
import { buildBomRows, buildWbsRows } from "./exports";
import { parseScheduleRows } from "./schedule";
import {
  ILLUSTRATIVE_SUFFIX, computePricedFromCatalogue, productRowFor, starterCatalogue, unitCostsFromCatalogue,
} from "./starterCatalogue";
import { PIPES_FITTINGS_STARTER, PIPE_DIAMETERS, PIPE_MATERIALS } from "./starterTemplatesPipes";
import { PRECAST_ELEMENTS_STARTER, CONCRETE_GRADES, HOLLOW_CORE_DEPTHS } from "./starterTemplatesPrecast";
import { BLOCKWORK_PLASTER_STARTER, CONCRETE_WORKS_STARTER, EXCAVATION_STARTER, BLOCK_THICKNESSES, READY_MIX_GRADES } from "./starterTemplatesCivil";
import { BUNDLE_38_FILE, bundle38Sql, startersSql } from "./starterSeedSql";
import { tipTextProblems } from "@/lib/infoTip";

// The GCC starters (docs/design/gcc-tender-deals.md, "Slice 3c-2 as built"): pipes and fittings, precast elements, and the three civil
// basics. Every figure asserted below was worked out by hand; the arithmetic is written beside it. The costs are the illustrative
// placeholders of the catalogue (starterCatalogue.ts), so a test of the numbers is a test of the formulas, not of any price.

const NEW_STARTERS: StarterTemplate[] = [PIPES_FITTINGS_STARTER, PRECAST_ELEMENTS_STARTER, EXCAVATION_STARTER, CONCRETE_WORKS_STARTER, BLOCKWORK_PLASTER_STARTER];
const ITEMS = starterCatalogue();
const body = (t: StarterTemplate) => ({ geometry: t.geometry, inputs: t.inputs, rates: t.rates, rules: t.rules });
const price = (t: StarterTemplate, params: Record<string, unknown> = {}, opts = {}): ComputeSuccess => computePricedFromCatalogue(body(t), params, ITEMS, opts);
const line = (r: ComputeSuccess, code: string) => r.lines.find((l) => l.code === code);
const cost = (r: ComputeSuccess, code: string) => line(r, code)?.cost_total ?? 0;
const qty = (r: ComputeSuccess, code: string) => line(r, code)?.qty ?? 0;

describe.each(NEW_STARTERS)("starter $name", (t) => {
  it("is valid with no warnings, locked, illustrative in name and description, and has a card name, words and an icon", () => {
    const v = validateTemplate(body(t));
    expect(v.issues).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(t.name).toMatch(/ \(illustrative\)$/);
    expect(t.description).toMatch(/^ILLUSTRATIVE/);
    expect((t.keywords ?? []).length).toBeGreaterThan(8);
    expect(TEMPLATE_ICONS as readonly string[]).toContain(t.icon);
    expect(t.quote_granularity).toBe("group");
    expect(STARTER_TEMPLATES.find((s) => s.name === t.name)?.locked).toBe(true);
    expect((t.catalogue ?? []).length).toBeGreaterThan(0);
  });

  it("prices its defaults completely from the catalogue items: every line costed, nothing unresolved", () => {
    const r = price(t);
    expect(r.complete).toBe(true);
    expect(r.unpriced).toEqual([]);
    expect(r.lines.every((l) => l.cost_total !== null && l.cost_total > 0)).toBe(true);
    expect(r.summary.cost_total).toBeGreaterThan(0);
  });

  it("names the catalogue items it uses, each of which exists once in the catalogue", () => {
    for (const item of t.catalogue ?? []) expect(ITEMS.filter((i) => i.sku === item.sku), item.sku).toHaveLength(1);
  });

  it("uses a MasterFormat code only in a group name, and only the codes it is sure of", () => {
    const sure = new Set(["31 23 16", "31 23 23", "33 11 00", "03 41 00", "03 11 00", "03 21 00", "03 30 00", "04 22 00", "09 24 00"]);
    for (const g of new Set(t.rules.map((r) => r.group))) {
      const m = /^(\d\d \d\d \d\d) /.exec(g);
      if (m) expect(sure.has(m[1]), g).toBe(true);
    }
    for (const r of t.rules) expect(r.description).not.toMatch(/^\d\d \d\d \d\d/);
  });
});

describe("the catalogue", () => {
  it("is 72 items with unique SKUs, a unit, a positive placeholder cost and tags", () => {
    expect(ITEMS).toHaveLength(72);
    expect(new Set(ITEMS.map((i) => i.sku)).size).toBe(72);
    for (const i of ITEMS) {
      expect(i.sku, i.name).toMatch(/^EST-[A-Z0-9-]+$/);
      expect(i.uom.length, i.sku).toBeGreaterThan(0);
      expect(i.cost, i.sku).toBeGreaterThan(0);
      expect(Object.keys(i.attrs).length, i.sku).toBeGreaterThan(0);
      expect(i.name, i.sku).not.toContain("illustrative");
    }
  });

  it("is marked illustrative as a product: name suffix, flag, source, description, no date", () => {
    for (const i of ITEMS) {
      const p = productRowFor(i);
      expect(p.name).toBe(`${i.name}${ILLUSTRATIVE_SUFFIX}`);
      expect(p.custom_data.illustrative).toBe(true);
      expect(p.custom_data.cost_source).toBe("Illustrative placeholder");
      expect(p.description).toMatch(/^ILLUSTRATIVE placeholder cost/);
      expect(p.cost_price).toBe(i.cost);
      expect(p.status).toBe("active");
      expect("cost_price_as_of" in p).toBe(false);
      expect(p.custom_data).toMatchObject(i.attrs);
    }
  });

  it("covers every choice a form offers: no combination leaves a line without its item", () => {
    for (const m of PIPE_MATERIALS) for (const dn of PIPE_DIAMETERS) for (const surface of ["natural", "gravel", "asphalt"]) {
      const r = price(PIPES_FITTINGS_STARTER, { pipe_material: m.key, pipe_dn: `dn${dn}`, surface, soil_type: "rock", fittings_n: 3, valves_n: 1 });
      expect(r.unpriced, `${m.key} DN${dn} ${surface}`).toEqual([]);
    }
    for (const g of CONCRETE_GRADES) for (const d of HOLLOW_CORE_DEPTHS) {
      expect(price(PRECAST_ELEMENTS_STARTER, { concrete_grade: g.key, hc_depth: d.key }).unpriced, `${g.key} ${d.key}`).toEqual([]);
    }
    for (const g of READY_MIX_GRADES) expect(price(CONCRETE_WORKS_STARTER, { concrete_grade: g.key }).unpriced, g.key).toEqual([]);
    for (const b of BLOCK_THICKNESSES) expect(price(BLOCKWORK_PLASTER_STARTER, { block_mm: b.key }).unpriced, b.key).toEqual([]);
  });

  it("is the same list however it is asked for (deterministic, one entry per SKU)", () => {
    expect(starterCatalogue().map((i) => i.sku)).toEqual(starterCatalogue(STARTER_TEMPLATES).map((i) => i.sku));
    expect(unitCostsFromCatalogue(computeEstimate(body(PIPES_FITTINGS_STARTER), {}) as ComputeSuccess, ITEMS).pipe).toBe(340);
  });
});

describe("pipes and fittings", () => {
  const T = PIPES_FITTINGS_STARTER;

  it("steel DN 300, 1000 m, 1.8 m deep in sand, 10 fittings, 2 valves: every line by hand", () => {
    const r = price(T);
    // Trench: 1000 m x (0.3 m pipe + 2 x 0.3 m working space = 0.9 m) x 1.8 m = 1620 m3.
    expect(qty(r, "exc")).toBe(64.8);                   // 1620 m3 x 1 (sand) / 25 m3 per h
    expect(cost(r, "exc")).toBe(9396);                  // 64.8 h x 145
    expect(line(r, "rock")).toBeUndefined();            // sand: no breaker
    expect(qty(r, "bed")).toBe(540);                    // 1000 x 0.9 x min(1.8, 2 x 0.15 + 0.3 = 0.6)
    expect(line(r, "bed")!.qty_gross).toBe(567);        // + 5% waste
    expect(cost(r, "bed")).toBe(35154);                 // 567 x 62
    expect(qty(r, "bkf")).toBe(1080);                   // 1620 - 540
    expect(cost(r, "bkf")).toBe(19440);                 // 1080 x 18
    expect(qty(r, "spl")).toBe(763.358);                // (540 + 1000 x 0.7854 x 0.3 x 0.3 = 610.686) x 1.25 = 763.3575
    expect(cost(r, "spl")).toBe(10687.01);              // 763.358 x 14
    expect(line(r, "pipe")!.qty_gross).toBe(1020);      // 1000 m + 2% waste
    expect(cost(r, "pipe")).toBe(346800);               // 1020 x 340
    expect(cost(r, "fit")).toBe(7600);                  // 10 x 760
    expect(cost(r, "val")).toBe(6200);                  // 2 x 3100
    expect(qty(r, "jnt")).toBe(107);                    // (ceil(1000 / 12) - 1 = 83) + 2 x (10 + 2) = 107
    expect(cost(r, "jnt")).toBe(20330);                 // 107 x 190
    expect(qty(r, "dlv")).toBe(9);                      // ceil(1000 x 300 / (120 x 300) = 8.33)
    expect(cost(r, "dlv")).toBe(8100);                  // 9 x 900
    expect(qty(r, "lay")).toBe(350);                    // 1000 x 0.35 x 300 / 300
    expect(cost(r, "lay")).toBe(29750);                 // 350 x 85
    expect(cost(r, "layp")).toBe(56000);                // 350 x 160
    expect(qty(r, "jlab")).toBe(267.5);                 // 107 x 2.5 h (steel)
    expect(cost(r, "jlab")).toBe(22737.5);              // 267.5 x 85
    expect(qty(r, "tst")).toBe(2);                      // ceil(1000 / 500)
    expect(cost(r, "tst")).toBe(4800);                  // 2 x 2400
    expect(line(r, "rein")).toBeUndefined();            // natural ground
    // 9396 + 35154 + 19440 + 10687.01 + 346800 + 7600 + 6200 + 20330 + 8100 + 29750 + 56000 + 22737.5 + 4800 = 576994.51
    expect(qty(r, "ovh")).toBe(576994.51);
    expect(cost(r, "ovh")).toBe(57699.45);              // 10%
    expect(r.summary.cost_total).toBe(634693.96);       // 576994.51 + 57699.45
    expect(Math.round((r.summary.cost_total / 1000) * 100) / 100).toBe(634.69); // cost per metre
  });

  it("GRP DN 200, 600 m, 2.2 m deep in clay, gravel reinstatement: the other variant picks its own items", () => {
    const r = price(T, { pipe_material: "grp", pipe_dn: "dn200", length_m: 600, depth_m: 2.2, soil_type: "clay", fittings_n: 4, valves_n: 1, surface: "gravel" });
    // Trench width 0.2 + 0.6 = 0.8 m; volume 600 x 0.8 x 2.2 = 1056 m3.
    expect(qty(r, "exc")).toBe(59.136);                 // 1056 x 1.4 / 25
    expect(cost(r, "exc")).toBe(8574.72);               // 59.136 x 145
    expect(qty(r, "bed")).toBe(240);                    // 600 x 0.8 x min(2.2, 0.3 + 0.2 = 0.5)
    expect(cost(r, "bed")).toBe(15624);                 // 252 x 62
    expect(cost(r, "bkf")).toBe(14688);                 // (1056 - 240) x 18
    expect(qty(r, "spl")).toBe(323.562);                // (240 + 600 x 0.7854 x 0.2 x 0.2 = 258.8496) x 1.25 = 323.562
    expect(cost(r, "spl")).toBe(4529.87);               // 323.562 x 14
    expect(cost(r, "pipe")).toBe(91800);                // 612 x 150 (GRP DN 200)
    expect(cost(r, "fit")).toBe(2080);                  // 4 x 520
    expect(cost(r, "val")).toBe(1500);                  // 1 x 1500
    expect(qty(r, "jnt")).toBe(59);                     // (ceil(600 / 12) - 1 = 49) + 2 x (4 + 1)
    expect(cost(r, "jnt")).toBe(7670);                  // 59 x 130
    expect(qty(r, "dlv")).toBe(4);                      // ceil(600 x 200 / (120 x 300) = 3.33)
    expect(cost(r, "lay")).toBe(11900);                 // 600 x 0.35 x 200 / 300 = 140 h x 85
    expect(cost(r, "layp")).toBe(22400);                // 140 x 160
    expect(qty(r, "jlab")).toBe(70.8);                  // 59 x 1.2 h (GRP)
    expect(cost(r, "jlab")).toBe(6018);                 // 70.8 x 85
    expect(cost(r, "tst")).toBe(4800);                  // ceil(600 / 500) = 2 x 2400
    expect(qty(r, "rein")).toBe(480);                   // 600 x 0.8 m2 of trench surface
    expect(cost(r, "rein")).toBe(18240);                // 480 x 38 (gravel)
    expect(r.summary.cost_total).toBe(234767.05);       // 213424.59 + 10% overhead 21342.46
    // The lines carry the tags of the chosen options, which is what the pricing step looks up.
    expect(parseMatchKey(line(r, "pipe")!.sku!)).toEqual({ est_kind: "pipe_supply", pipe_material: "grp", pipe_dn: "200" });
    expect(parseMatchKey(line(r, "val")!.sku!)).toEqual({ est_kind: "pipe_valve", pipe_dn: "200" });
    expect(parseMatchKey(line(r, "rein")!.sku!)).toEqual({ est_kind: "reinstatement", surface: "gravel" });
  });

  it("HDPE DN 100 in rock adds the breaker; no fittings or valves leaves only the pipe's joints", () => {
    const r = price(T, { pipe_material: "hdpe", pipe_dn: "dn100", length_m: 200, depth_m: 1.2, soil_type: "rock", fittings_n: 0, valves_n: 0, surface: "asphalt" });
    // Trench width 0.1 + 0.6 = 0.7 m; volume 200 x 0.7 x 1.2 = 168 m3.
    expect(qty(r, "exc")).toBe(16.8);                   // 168 x 2.5 / 25
    expect(cost(r, "exc")).toBe(2436);                  // 16.8 x 145
    expect(qty(r, "rock")).toBe(25.2);                  // 168 x 0.15 h per m3
    expect(cost(r, "rock")).toBe(4788);                 // 25.2 x 190
    expect(line(r, "fit")).toBeUndefined();
    expect(line(r, "val")).toBeUndefined();
    expect(qty(r, "jnt")).toBe(16);                     // ceil(200 / 12) - 1 = 16
    expect(cost(r, "pipe")).toBe(7752);                 // 204 x 38 (HDPE DN 100)
    expect(cost(r, "rein")).toBe(13300);                // 200 x 0.7 = 140 m2 x 95 (asphalt)
  });

  it("in a shallow trench the bedding takes most of the room and the backfill is what is left, never negative", () => {
    const r = price(T, { pipe_dn: "dn600", depth_m: 1, length_m: 100 });
    // DN 600: trench width 0.6 + 0.6 = 1.2 m, volume 100 x 1.2 x 1 = 120 m3; bedding 100 x 1.2 x min(1, 0.3 + 0.6) = 108 m3.
    expect(qty(r, "bed")).toBe(108);
    expect(qty(r, "bkf")).toBe(12);                     // 120 - 108
  });

  it("refuses a length or depth outside its range instead of pricing it", () => {
    expect(computeEstimate(body(T), { length_m: 0 }).ok).toBe(false);
    expect(computeEstimate(body(T), { depth_m: 0.5 }).ok).toBe(false);
  });

  it("exports a BOM of the materials only (with their item numbers) and a WBS with the MasterFormat codes", () => {
    const r = price(T, { surface: "gravel" });
    const items = r.lines.map((l) => {
      const attrs = l.sku ? parseMatchKey(l.sku) : null;
      const hit = attrs ? ITEMS.find((i) => Object.entries(attrs).every(([k, v]) => i.attrs[k] === v)) : ITEMS.find((i) => i.sku === l.sku);
      return { ...l, sku: hit?.sku ?? null };
    });
    const bom = buildBomRows(items);
    expect(bom.map((b) => b.description)).toEqual([
      "Granular bedding and surround", "Pipe, supplied", "Fittings (bends, tees, reducers)", "Isolation valves",
      "Joints (one between pipes, two at every fitting and valve)", "Surface reinstatement over the trench",
    ]);
    expect(bom.map((b) => b.item_number)).toEqual(["EST-PIPE-BED", "EST-PIPE-STEEL-300", "EST-FIT-STEEL-300", "EST-VLV-300", "EST-JNT-STEEL-300", "EST-REIN-GRAVEL"]);
    expect(bom.every((b) => b.unit_cost !== null && b.line_cost !== null)).toBe(true);
    const wbs = buildWbsRows(items, { depth: 1 });
    expect(wbs.map((w) => w.name)).toEqual([
      "31 23 16 Excavation", "31 23 23 Bedding and backfill", "33 11 00 Pipe, fittings and valves", "33 11 00 Laying, jointing and testing", "Surface reinstatement", "Overhead",
    ]);
  });
});

describe("precast elements", () => {
  const T = PRECAST_ELEMENTS_STARTER;

  it("the default job by hand: 100 wall panels, 20 slabs, 40 hollow-core planks, 12 columns, 16 beams, C40, 60 km", () => {
    const r = price(T);
    expect(qty(r, "conc_wall")).toBe(60);               // 100 x 2.5 x 2.4 x 0.1
    expect(cost(r, "conc_wall")).toBe(20196);           // 60 x 1.02 = 61.2 x 330 (C40)
    expect(qty(r, "conc_slab")).toBe(57.6);             // 20 x 6 x 2.4 x 0.2
    expect(cost(r, "conc_slab")).toBe(19388.16);        // 58.752 x 330
    expect(qty(r, "hc")).toBe(288);                     // 40 x 6 x 1.2 m2
    expect(cost(r, "hc")).toBe(41760);                  // 288 x 145 (200 mm)
    expect(qty(r, "conc_col")).toBe(7.68);              // 12 x 4 x 0.4 x 0.4
    expect(cost(r, "conc_col")).toBe(2585.22);          // 7.834 x 330
    expect(qty(r, "conc_beam")).toBe(14.4);             // 16 x 6 x 0.3 x 0.5
    expect(cost(r, "conc_beam")).toBe(4847.04);         // 14.688 x 330
    expect(qty(r, "rbr")).toBe(14361.6);                // 60 x 60 + 57.6 x 110 + 7.68 x 220 + 14.4 x 190 = 3600 + 6336 + 1689.6 + 2736
    expect(line(r, "rbr")!.qty_gross).toBe(15079.68);   // + 5%
    expect(cost(r, "rbr")).toBe(48254.98);              // 15079.68 x 3.2
    expect(qty(r, "mld")).toBe(139.68);                 // 60 + 57.6 + 7.68 + 14.4 m3 cast
    expect(cost(r, "mld")).toBe(12571.2);               // 139.68 x 90
    expect(qty(r, "lab")).toBe(488.88);                 // 139.68 x 3.5 h
    expect(cost(r, "lab")).toBe(8799.84);               // 488.88 x 18
    // Weight: 139.68 x 2.4 + 288 x 0.3 = 335.232 + 86.4 = 421.632 t; 17 loads of 25 t; 8 crane days of 60 t.
    expect(qty(r, "hdl")).toBe(17);
    expect(cost(r, "hdl")).toBe(2040);                  // 17 x 120
    expect(qty(r, "hlg")).toBe(1020);                   // 17 loads x 60 km
    expect(cost(r, "hlg")).toBe(4590);                  // 1020 x 4.5
    expect(qty(r, "crn")).toBe(8);
    expect(cost(r, "crn")).toBe(20800);                 // 8 x 2600
    expect(cost(r, "crw")).toBe(11200);                 // 8 x 1400
    expect(qty(r, "ovh")).toBe(158402.44);              // 20196 + (19388.16 + 41760 + 2585.22 + 4847.04) + (48254.98 + 12571.2 + 8799.84)
    expect(cost(r, "ovh")).toBe(19008.29);              // 12%
    expect(r.summary.cost_total).toBe(216040.73);       // 158402.44 + 4590 + 2040 + 20800 + 11200 + 19008.29
    expect(r.summary.by_component.erection).toBe(32000);
    expect(r.summary.by_component.moulds).toBe(12571.2);
  });

  it("an element schedule replaces the form's quantities and reaches reinforcement, weight, transport and the crane", () => {
    const table = [
      ["element_type", "mark", "count", "length_m", "width_m", "thickness_m"],
      ["boundary_wall_panel", "W-1", 20, 2.5, 2.4, 0.1],  // 12 m3
      ["boundary_wall_panel", "W-2", 10, 2.5, 2.4, 0.1],  // 6 m3
    ];
    const parsed = parseScheduleRows(table, { template: body(T) });
    expect(parsed.errors).toEqual([]);
    expect(parsed.quantities.map((q) => q.qty)).toEqual([12, 6]);
    const params = { slab_n: 0, hc_n: 0, col_n: 0, beam_n: 0 };
    const r = computePricedFromCatalogue(body(T), params, ITEMS, { schedule: parsed.quantities });
    const walls = r.lines.filter((l) => l.code === "conc_wall");
    expect(walls.map((l) => [l.element_ref, l.qty])).toEqual([["W-1", 12], ["W-2", 6]]);
    expect(qty(r, "rbr")).toBe(1080);                   // (12 + 6) m3 x 60 kg per m3
    expect(qty(r, "mld")).toBe(18);
    expect(qty(r, "hdl")).toBe(2);                      // 18 x 2.4 = 43.2 t -> ceil(43.2 / 25)
    expect(qty(r, "crn")).toBe(1);                      // ceil(43.2 / 60)
    expect(r.summary.cost_total).toBeGreaterThan(0);
  });

  it("takes hollow-core planks by the m2 a schedule row covers", () => {
    const parsed = parseScheduleRows([["element_type", "count", "length_m", "width_m", "thickness_m"], ["hollow_core", 10, 6, 1.2, 0.2]], { template: body(T) });
    expect(parsed.errors).toEqual([]);
    expect(parsed.quantities[0].qty).toBe(72);          // 10 x 6 x 1.2 m2
  });
});

describe("excavation and backfill", () => {
  const T = EXCAVATION_STARTER;
  it("500 m3 in sand, 350 m3 put back, 15 km to the tip: by hand", () => {
    const r = price(T);
    expect(cost(r, "exc")).toBe(2900);                  // 500 x 1 / 25 = 20 h x 145
    expect(line(r, "rock")).toBeUndefined();
    expect(cost(r, "bkf")).toBe(6300);                  // 350 x 18
    expect(line(r, "fill")).toBeUndefined();            // no imported fill
    expect(qty(r, "cart")).toBe(2812.5);                // (500 - 350) x 1.25 = 187.5 m3 x 15 km
    expect(cost(r, "cart")).toBe(1265.63);              // 2812.5 x 0.45 = 1265.625
    expect(cost(r, "tip")).toBe(1125);                  // 187.5 x 6
    expect(cost(r, "ovh")).toBe(1159.06);               // 10% of 2900 + 6300 + 1265.63 + 1125 = 11590.63
    expect(r.summary.cost_total).toBe(12749.69);
  });
  it("rock needs the breaker and imported fill comes from the catalogue", () => {
    const r = price(T, { soil_type: "rock", import_fill_m3: 100 });
    expect(cost(r, "exc")).toBe(7250);                  // 500 x 2.5 / 25 = 50 h x 145
    expect(qty(r, "rock")).toBe(75);                    // 500 x 0.15
    expect(cost(r, "rock")).toBe(14250);                // 75 x 190
    expect(cost(r, "fill")).toBe(5040);                 // 100 + 5% = 105 x 48
  });
  it("nothing to cart away when all the soil goes back", () => {
    const r = price(T, { backfill_m3: 500 });
    expect(line(r, "cart")).toBeUndefined();
    expect(line(r, "tip")).toBeUndefined();
  });
});

describe("reinforced concrete", () => {
  const T = CONCRETE_WORKS_STARTER;
  it("100 m3 of C30 with 100 kg per m3, 6 m2 of formwork per m3, pumped: by hand", () => {
    const r = price(T);
    expect(qty(r, "fwm")).toBe(600);                    // 100 x 6 m2
    expect(cost(r, "fwm")).toBe(13200);                 // 600 x 22
    expect(cost(r, "fwl")).toBe(8640);                  // 600 x 0.9 h = 540 x 16
    expect(qty(r, "rbr")).toBe(10000);                  // 100 x 100 kg
    expect(cost(r, "rbr")).toBe(33600);                 // 10500 (+5%) x 3.2
    expect(cost(r, "rbl")).toBe(1920);                  // 10000 x 0.012 = 120 h x 16
    expect(cost(r, "conc")).toBe(28325);                // 103 (+3%) x 275 (C30)
    expect(cost(r, "plc")).toBe(1920);                  // 100 x 1.2 = 120 h x 16
    expect(qty(r, "pmp")).toBe(3.333);                  // 100 / 30 m3 per h
    expect(cost(r, "pmp")).toBe(699.93);                // 3.333 x 210
    expect(cost(r, "ovh")).toBe(8830.49);               // 10% of 88304.93
    expect(r.summary.cost_total).toBe(97135.42);
  });
  it("kg per m3 is an input: 150 kg of C40, not pumped", () => {
    const r = price(T, { concrete_grade: "c40", rebar_kg_m3: 150, pumped: false });
    expect(qty(r, "rbr")).toBe(15000);                  // 100 x 150
    expect(cost(r, "rbr")).toBe(50400);                 // 15750 x 3.2
    expect(cost(r, "rbl")).toBe(2880);                  // 15000 x 0.012 = 180 h x 16
    expect(cost(r, "conc")).toBe(32445);                // 103 x 315 (C40)
    expect(line(r, "pmp")).toBeUndefined();
  });
});

describe("blockwork and plaster", () => {
  const T = BLOCKWORK_PLASTER_STARTER;
  it("300 m2 less 20 m2 of openings in 200 mm block, plastered both faces at 15 mm: by hand", () => {
    const r = price(T);
    expect(qty(r, "blk")).toBe(3500);                   // 280 m2 x 12.5
    expect(cost(r, "blk")).toBe(20580);                 // 3675 (+5%) x 5.6
    expect(qty(r, "mor")).toBe(5.04);                   // 280 x 0.2 x 0.09 m3
    expect(cost(r, "mor")).toBe(1053.36);               // 5.544 (+10%) x 190
    expect(cost(r, "bll")).toBe(4032);                  // 280 x 0.9 = 252 h x 16
    expect(qty(r, "pla")).toBe(8.4);                    // 280 x 2 x 0.015 m3
    expect(cost(r, "pla")).toBe(1940.4);                // 9.24 (+10%) x 210
    expect(cost(r, "plb")).toBe(6272);                  // 280 x 2 x 0.7 = 392 h x 16
    expect(cost(r, "ovh")).toBe(3387.78);               // 10% of 33877.76
    expect(r.summary.cost_total).toBe(37265.54);
  });
  it("a 100 mm block wall plastered on one face: fewer laying hours, the thinner block, half the plaster", () => {
    const r = price(T, { block_mm: "b100", plaster_sides: 1 });
    expect(cost(r, "blk")).toBe(11760);                 // 3675 x 3.2
    expect(qty(r, "bll")).toBe(126);                    // 280 x 0.9 x 100 / 200 h
    expect(qty(r, "pla")).toBe(4.2);                    // 280 x 1 x 0.015
  });
  it("openings larger than the wall leave nothing to build, not a negative quantity", () => {
    const r = price(T, { wall_area_m2: 10, openings_m2: 50 });
    expect(r.lines.filter((l) => l.group.startsWith("04 22 00"))).toEqual([]);
  });
});

describe("the seeds", () => {
  const seedDir = path.resolve(__dirname, "../../../scripts");
  const read = (f: string) => readFileSync(path.join(seedDir, f), "utf8").replace(/\r\n/g, "\n");

  it("generate the same text every time", () => {
    expect(startersSql()).toBe(startersSql());
    expect(bundle38Sql()).toBe(bundle38Sql());
  });

  it("the committed seed and bundle 38 are what the generator writes (run: npx jiti scripts/gen-estimate-seeds.ts)", () => {
    expect(read("seed-estimate-templates-starter.sql")).toBe(startersSql());
    expect(read(BUNDLE_38_FILE)).toBe(bundle38Sql());
  });

  it("bundle 38 installs the five new starters locked, never overwrites an edited item, and adds each SKU once", () => {
    const sql = bundle38Sql();
    for (const t of NEW_STARTERS) expect(sql, t.name).toContain(`'${t.name}'`);
    expect(sql).not.toContain("Chain-link fence");
    expect(sql).toContain("and locked = true");                       // a locked starter is refreshed
    expect(sql).toContain("if not exists (select 1 from products where tenant_id = t and sku = item.sku)");
    expect(sql).not.toMatch(/update products/i);                      // an item is never rewritten
    expect(sql).toContain("is_demo = true");                          // demo tenants only as shipped
    expect(sql).toContain("-- TARGET");
    for (const i of ITEMS) expect(sql.split(`"sku":"${i.sku}","name":`).length - 1, i.sku).toBe(1);
    expect(sql).toContain('"illustrative":true');
  });

  it("the bundle is listed in the ledger as pending, and the design doc and PROJECT.md describe slice 3c-2", () => {
    const root = path.resolve(__dirname, "../../..");
    const project = readFileSync(path.join(root, "PROJECT.md"), "utf8");
    expect(project).toContain("run-bundle-38-starter-templates-pipes-precast-civil-2026-10-26.sql");
    expect(readFileSync(path.join(root, "docs/design/gcc-tender-deals.md"), "utf8")).toContain("Slice 3c-2 as built");
  });
});

describe("explanations", () => {
  it("the template descriptions stay short enough for a card", () => {
    for (const t of NEW_STARTERS) expect(t.description.length, t.name).toBeLessThan(560);
    expect(tipTextProblems("x")).toEqual([]);
  });
});
