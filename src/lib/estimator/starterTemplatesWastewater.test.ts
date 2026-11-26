import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STARTER_TEMPLATES } from "./starterTemplates";
import { validateTemplate } from "./template";
import { computeEstimate } from "./compute";
import type { ComputeSuccess } from "./compute";
import { parseMatchKey } from "./productMatch";
import { TEMPLATE_ICONS } from "./requests";
import { ILLUSTRATIVE_SUFFIX, computePricedFromCatalogue, productRowFor, starterCatalogue } from "./starterCatalogue";
import { CIVIL_CATALOGUE, CONCRETE_WORKS_STARTER, EXCAVATION_STARTER, READY_MIX_GRADES, SOIL_OPTIONS } from "./starterTemplatesCivil";
import {
  HDPE_THICKNESSES, WASTEWATER_CATALOGUE, WASTEWATER_NEW_ITEMS, WASTEWATER_PLANT_STARTER as T, WASTEWATER_SYSTEMS,
} from "./starterTemplatesWastewater";
import {
  BUNDLE_57_FILE, SLUG_SCRIPT_FILE, SLUG_VARIABLE_RE, bundle38Sql, bundle57Sql, startersSql, wastewaterSlugSql,
} from "./starterSeedSql";

// The wastewater plant civil package starter. Every figure asserted below was worked out by hand; the arithmetic is written beside it.
// The costs are the illustrative placeholders of the catalogue, so a test of the numbers is a test of the formulas, not of any price.
// Default job: 8,000 m3 excavated in sand, 2,500 m2 of poor soil 1 m deep replaced with selected fill, 4,500 m3 put back, 1,200 m3 of
// imported fill, 20 km to the tip; 1,800 m3 of C35 at 130 kg per m3 and 7 m2 of formwork per m3, pumped, 2,500 m2 of 100 mm blinding;
// 4,500 m2 of sheet membrane waterproofing with primer and protection board; 6,000 m2 of geotextile with 10% overlap; 4,000 m2 of 2.0 mm
// HDPE liner (8 m rolls, 8% wastage, 200 m of extrusion-welded details); 8 tanks of 650 m3 held for 7 days.

const ITEMS = starterCatalogue();
const body = { geometry: T.geometry, inputs: T.inputs, rates: T.rates, rules: T.rules };
const price = (params: Record<string, unknown> = {}, opts = {}): ComputeSuccess => computePricedFromCatalogue(body, params, ITEMS, opts);
const line = (r: ComputeSuccess, code: string) => r.lines.find((l) => l.code === code);
const cost = (r: ComputeSuccess, code: string) => line(r, code)?.cost_total ?? 0;
const qty = (r: ComputeSuccess, code: string) => line(r, code)?.qty ?? 0;
const groupCost = (r: ComputeSuccess, name: string) => r.summary.by_group.find((g) => g.name === name)?.cost;

describe("the wastewater plant civil package starter", () => {
  it("is valid with no warnings, locked, illustrative in name and description, with a card name, words and an icon", () => {
    const v = validateTemplate(body);
    expect(v.issues).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(T.name).toBe("Wastewater plant civil package (illustrative)");
    expect(T.name).toMatch(/ \(illustrative\)$/);
    expect(T.description).toMatch(/^ILLUSTRATIVE/);
    expect(T.description.length).toBeLessThan(560);
    expect(T.trade).toBe("civil");
    expect((T.keywords ?? []).length).toBeGreaterThan(8);
    expect(TEMPLATE_ICONS as readonly string[]).toContain(T.icon);
    expect(T.quote_granularity).toBe("group");
    expect(STARTER_TEMPLATES.find((s) => s.name === T.name)?.locked).toBe(true);
  });

  it("is generic: no workspace, client or company name anywhere in the template or its catalogue items", () => {
    const text = JSON.stringify([T, WASTEWATER_CATALOGUE]);
    expect(text).not.toMatch(/kamco|amiral|veolia|orascom|vikas|bim\b|pcbs/i);
  });

  it("leaves blockwork and plaster to its own starter and says so", () => {
    expect(T.description).toContain("Blockwork and plaster");
    expect(STARTER_TEMPLATES.some((s) => s.name === "Blockwork and plaster (illustrative)")).toBe(true);
    expect(T.rules.some((r) => /block|plaster/i.test(r.description))).toBe(false);
  });

  it("groups the cost lines under plain names, MasterFormat codes only where they are certain", () => {
    const groups = [...new Set(T.rules.map((r) => r.group))];
    expect(groups).toEqual([
      "31 23 16 Excavation", "31 23 23 Soil replacement and fill", "Disposal of surplus", "Blinding concrete",
      "03 11 00 Concrete forming and accessories", "03 21 00 Reinforcing steel", "03 30 00 Cast-in-place concrete",
      "Waterproofing", "Geotextile", "HDPE membrane works", "Testing", "Overhead",
    ]);
    const sure = new Set(["31 23 16", "31 23 23", "03 11 00", "03 21 00", "03 30 00"]);
    for (const g of groups) {
      const m = /^(\d\d \d\d \d\d) /.exec(g);
      if (m) expect(sure.has(m[1]), g).toBe(true);
    }
    for (const r of T.rules) expect(r.description).not.toMatch(/^\d\d \d\d \d\d/);
  });

  it("reads plain numbers a bid estimator takes off a BOQ, in seven sections, with every default inside its range", () => {
    expect([...new Set(T.inputs.map((i) => i.section))]).toEqual([
      "Earthworks", "Soil replacement and fill", "Concrete structures", "Waterproofing", "Geotextile", "HDPE membrane", "Testing",
    ]);
    for (const i of T.inputs) {
      if (i.type !== "number") continue;
      const d = i.default as number;
      if (i.min != null) expect(d, i.key).toBeGreaterThanOrEqual(i.min);
      if (i.max != null) expect(d, i.key).toBeLessThanOrEqual(i.max);
    }
    expect(T.inputs.filter((i) => i.type === "select").map((i) => i.key)).toEqual(["soil_type", "repl_fill", "concrete_grade", "wp_system", "hdpe_thk"]);
  });

  it("every rate a range is given for sits inside it, and the shared civil rates are the civil basics' own", () => {
    for (const r of T.rates) {
      if (r.low != null) expect(r.low, r.key).toBeLessThanOrEqual(r.value);
      if (r.high != null) expect(r.high, r.key).toBeGreaterThanOrEqual(r.value);
    }
    const dug = EXCAVATION_STARTER.rates.find((r) => r.key === "excavator_rate_hr");
    const labour = CONCRETE_WORKS_STARTER.rates.find((r) => r.key === "labour_rate_hr");
    expect(T.rates.find((r) => r.key === "excavator_rate_hr")).toEqual(dug);
    expect(T.rates.find((r) => r.key === "labour_rate_hr")).toEqual(labour);
    expect(T.inputs.find((i) => i.key === "soil_type")?.options).toEqual(SOIL_OPTIONS);
    expect(T.rates.filter((r) => r.low != null && r.high != null).length).toBeGreaterThanOrEqual(12);
  });
});

describe("the catalogue items", () => {
  it("are 17: the 8 shared with the civil basics, reused as they are, and 9 new ones, each once in the whole catalogue", () => {
    expect(WASTEWATER_CATALOGUE).toHaveLength(17);
    expect(WASTEWATER_NEW_ITEMS.map((i) => i.sku)).toEqual([
      "EST-WW-CRUSHED", "EST-WP-CEM", "EST-WP-SHEET", "EST-WP-PU", "EST-WP-PRIMER", "EST-WP-BOARD", "EST-GEOTEXTILE", "EST-HDPE-15", "EST-HDPE-20",
    ]);
    const shared = WASTEWATER_CATALOGUE.filter((i) => !WASTEWATER_NEW_ITEMS.includes(i));
    expect(shared).toHaveLength(8);
    for (const i of shared) expect(CIVIL_CATALOGUE.includes(i), i.sku).toBe(true);
    for (const i of WASTEWATER_CATALOGUE) expect(ITEMS.filter((x) => x.sku === i.sku), i.sku).toHaveLength(1);
  });

  it("are marked illustrative three ways: name suffix, flag with its source, and no cost date", () => {
    for (const i of WASTEWATER_NEW_ITEMS) {
      expect(i.sku).toMatch(/^EST-[A-Z0-9-]+$/);
      expect(i.cost, i.sku).toBeGreaterThan(0);
      expect(i.name).not.toContain("illustrative");
      const p = productRowFor(i);
      expect(p.name).toBe(`${i.name}${ILLUSTRATIVE_SUFFIX}`);
      expect(p.custom_data.illustrative).toBe(true);
      expect(p.custom_data.cost_source).toBe("Illustrative placeholder");
      expect("cost_price_as_of" in p).toBe(false);
      expect(p.custom_data).toMatchObject(i.attrs);
    }
  });

  it("price every choice a form offers: no combination of the five selects leaves a line without its item", () => {
    for (const soil of SOIL_OPTIONS) for (const fill of ["selected", "crushed"]) for (const g of READY_MIX_GRADES) for (const s of WASTEWATER_SYSTEMS) for (const h of HDPE_THICKNESSES) {
      const r = price({ soil_type: soil.key, repl_fill: fill, concrete_grade: g.key, wp_system: s.key, hdpe_thk: h.key });
      expect(r.unpriced, `${soil.key} ${fill} ${g.key} ${s.key} ${h.key}`).toEqual([]);
      expect(r.complete).toBe(true);
    }
  });

  it("are picked by the tags of the chosen option, for the concrete grade, the waterproofing system and the liner thickness", () => {
    const r = price({ concrete_grade: "c50", wp_system: "pu", hdpe_thk: "t15" });
    expect(parseMatchKey(line(r, "conc")!.sku!)).toEqual({ est_kind: "ready_mix", concrete_grade: "c50" });
    expect(parseMatchKey(line(r, "wpm")!.sku!)).toEqual({ est_kind: "waterproofing", wp_system: "pu" });
    expect(parseMatchKey(line(r, "lin")!.sku!)).toEqual({ est_kind: "hdpe_liner", hdpe_thk: "1.5" });
  });
});

describe("pricing the defaults", () => {
  it("costs every line from the catalogue: nothing unresolved, every line above zero", () => {
    const r = price();
    expect(r.complete).toBe(true);
    expect(r.unpriced).toEqual([]);
    expect(r.lines.every((l) => l.cost_total !== null && l.cost_total > 0)).toBe(true);
    expect(r.lines).toHaveLength(35);                 // 37 rules less rock (sand) and rfc (selected fill chosen)
  });

  it("earthworks by hand: 8,000 m3 in sand, 2,500 m3 of poor soil replaced, 4,500 m3 put back, 1,200 m3 imported, 20 km to the tip", () => {
    const r = price();
    expect(qty(r, "exc")).toBe(320);                    // 8000 m3 x 1 (sand) / 25 m3 per h
    expect(cost(r, "exc")).toBe(46400);                 // 320 h x 145
    expect(line(r, "rock")).toBeUndefined();            // sand: no breaker
    expect(qty(r, "pdig")).toBe(100);                   // 2500 m2 x 1 m = 2500 m3 / 25 m3 per h
    expect(cost(r, "pdig")).toBe(14500);                // 100 h x 145
    expect(line(r, "rfs")!.qty_gross).toBe(2625);       // 2500 m3 + 5% wastage
    expect(cost(r, "rfs")).toBe(126000);                // 2625 x 48 (selected fill)
    expect(line(r, "rfc")).toBeUndefined();             // selected fill chosen, not the crushed rock
    expect(cost(r, "rcp")).toBe(45000);                 // 2500 m3 x 18
    expect(cost(r, "bkf")).toBe(81000);                 // 4500 m3 x 18
    expect(line(r, "fill")!.qty_gross).toBe(1260);      // 1200 m3 + 5%
    expect(cost(r, "fill")).toBe(60480);                // 1260 x 48
    expect(qty(r, "cart")).toBe(150000);                // (8000 + 2500 - 4500 = 6000 m3 in place) x 1.25 = 7500 m3 loose x 20 km
    expect(cost(r, "cart")).toBe(67500);                // 150000 x 0.45
    expect(qty(r, "tip")).toBe(7500);
    expect(cost(r, "tip")).toBe(45000);                 // 7500 x 6
    expect(groupCost(r, "31 23 16 Excavation")).toBe(60900);                 // 46400 + 14500
    expect(groupCost(r, "31 23 23 Soil replacement and fill")).toBe(312480); // 126000 + 45000 + 81000 + 60480
    expect(groupCost(r, "Disposal of surplus")).toBe(112500);                // 67500 + 45000
  });

  it("rock needs the breaker, crushed rock replaces the selected fill and each is priced from its own item", () => {
    const r = price({ soil_type: "rock", repl_fill: "crushed" });
    expect(cost(r, "exc")).toBe(116000);                // 8000 x 2.5 / 25 = 800 h x 145
    expect(qty(r, "rock")).toBe(1200);                  // 8000 x 0.15 h per m3
    expect(cost(r, "rock")).toBe(228000);               // 1200 x 190
    expect(line(r, "rfs")).toBeUndefined();
    expect(cost(r, "rfc")).toBe(223125);                // 2625 x 85 (crushed rock)
    expect(cost(r, "pdig")).toBe(14500);                // the poor soil is soft: the same hours whatever the bulk soil
  });

  it("no replacement depth leaves no replacement lines, and the surplus is only the bulk excavation less what is put back", () => {
    const r = price({ repl_depth_m: 0 });
    for (const c of ["pdig", "rfs", "rfc", "rcp"]) expect(line(r, c), c).toBeUndefined();
    expect(qty(r, "tip")).toBe(4375);                   // (8000 - 4500) x 1.25
    expect(qty(r, "cart")).toBe(87500);                 // 4375 x 20 km
    expect(cost(r, "cart")).toBe(39375);                // 87500 x 0.45
    expect(cost(r, "tip")).toBe(26250);                 // 4375 x 6
  });

  it("nothing to cart away when all the soil goes back", () => {
    const r = price({ backfill_m3: 10500 });
    expect(line(r, "cart")).toBeUndefined();
    expect(line(r, "tip")).toBeUndefined();
  });

  it("concrete by hand: 1,800 m3 of C35 at 130 kg per m3 and 7 m2 of formwork per m3, pumped, plus blinding", () => {
    const r = price();
    expect(qty(r, "bld")).toBe(250);                    // 2500 m2 x 100 mm
    expect(line(r, "bld")!.qty_gross).toBe(257.5);      // + 3% wastage
    expect(cost(r, "bld")).toBe(65662.5);               // 257.5 x 255 (C25)
    expect(qty(r, "blp")).toBe(300);                    // 250 x 1.2 h per m3
    expect(cost(r, "blp")).toBe(4800);                  // 300 x 16
    expect(qty(r, "fwm")).toBe(12600);                  // 1800 x 7 m2
    expect(cost(r, "fwm")).toBe(277200);                // 12600 x 22
    expect(qty(r, "fwl")).toBe(11340);                  // 12600 x 0.9 h
    expect(cost(r, "fwl")).toBe(181440);                // 11340 x 16
    expect(qty(r, "rbr")).toBe(234000);                 // 1800 x 130 kg
    expect(line(r, "rbr")!.qty_gross).toBe(245700);     // + 5%
    expect(cost(r, "rbr")).toBe(786240);                // 245700 x 3.2
    expect(qty(r, "rbl")).toBe(2808);                   // 234000 x 0.012 h
    expect(cost(r, "rbl")).toBe(44928);                 // 2808 x 16
    expect(line(r, "conc")!.qty_gross).toBe(1854);      // 1800 + 3%
    expect(cost(r, "conc")).toBe(546930);               // 1854 x 295 (C35)
    expect(qty(r, "plc")).toBe(2160);                   // 1800 x 1.2 h
    expect(cost(r, "plc")).toBe(34560);                 // 2160 x 16
    expect(qty(r, "pmp")).toBe(60);                     // 1800 / 30 m3 per h
    expect(cost(r, "pmp")).toBe(12600);                 // 60 x 210
    expect(groupCost(r, "Blinding concrete")).toBe(70462.5);                      // 65662.5 + 4800
    expect(groupCost(r, "03 11 00 Concrete forming and accessories")).toBe(458640); // 277200 + 181440
    expect(groupCost(r, "03 21 00 Reinforcing steel")).toBe(831168);              // 786240 + 44928
    expect(groupCost(r, "03 30 00 Cast-in-place concrete")).toBe(594090);         // 546930 + 34560 + 12600
  });

  it("C50 placed without a pump takes the dearer ready-mix and no pump line", () => {
    const r = price({ concrete_grade: "c50", pumped: false });
    expect(cost(r, "conc")).toBe(639630);               // 1854 x 345 (C50)
    expect(line(r, "pmp")).toBeUndefined();
  });

  it("waterproofing by hand: 4,500 m2 of sheet membrane with primer and protection board", () => {
    const r = price();
    expect(line(r, "wpm")!.qty_gross).toBe(4860);       // 4500 + 8% laps and wastage
    expect(cost(r, "wpm")).toBe(281880);                // 4860 x 58 (sheet membrane)
    expect(qty(r, "wpp")).toBe(1125);                   // 4500 x 0.25 l per m2
    expect(cost(r, "wpp")).toBe(19440);                 // 1215 (+8%) x 16
    expect(cost(r, "wpb")).toBe(126360);                // 4860 (+8%) x 26
    expect(qty(r, "wpl")).toBe(1350);                   // 4500 x 0.30 h (sheet)
    expect(cost(r, "wpl")).toBe(21600);                 // 1350 x 16
    expect(qty(r, "wpf")).toBe(270);                    // 4500 x 0.06 h
    expect(cost(r, "wpf")).toBe(4320);                  // 270 x 16
    expect(groupCost(r, "Waterproofing")).toBe(453600); // 281880 + 19440 + 126360 + 21600 + 4320
  });

  it("a cementitious coating takes no primer, and no protection board when it is switched off", () => {
    const r = price({ wp_system: "cementitious", wp_protect: false });
    expect(cost(r, "wpm")).toBe(174960);                // 4860 x 36
    expect(line(r, "wpp")).toBeUndefined();
    expect(line(r, "wpb")).toBeUndefined();
    expect(line(r, "wpf")).toBeUndefined();
    expect(qty(r, "wpl")).toBe(810);                    // 4500 x 0.18 h
    expect(cost(r, "wpl")).toBe(12960);                 // 810 x 16
  });

  it("a liquid membrane is dearer, takes primer and 0.25 h per m2", () => {
    const r = price({ wp_system: "pu" });
    expect(cost(r, "wpm")).toBe(359640);                // 4860 x 74
    expect(cost(r, "wpp")).toBe(19440);
    expect(qty(r, "wpl")).toBe(1125);                   // 4500 x 0.25 h
    expect(cost(r, "wpl")).toBe(18000);                 // 1125 x 16
  });

  it("geotextile by hand: 6,000 m2 with a 10% overlap, and the overlap is an input", () => {
    const r = price();
    expect(qty(r, "gtm")).toBe(6600);                   // 6000 x 1.10
    expect(line(r, "gtm")!.qty_gross).toBe(6798);       // + 3% cutting wastage
    expect(cost(r, "gtm")).toBe(50985);                 // 6798 x 7.5
    expect(qty(r, "gtl")).toBe(198);                    // 6600 x 0.03 h
    expect(cost(r, "gtl")).toBe(3168);                  // 198 x 16
    const wide = price({ gt_area_m2: 1000, gt_overlap_pct: 20 });
    expect(qty(wide, "gtm")).toBe(1200);                // 1000 x 1.20
    expect(cost(wide, "gtm")).toBe(9270);               // 1236 x 7.5
    expect(cost(wide, "gtl")).toBe(576);                // 1200 x 0.03 = 36 h x 16
  });

  it("HDPE works by hand: 4,000 m2 of 2.0 mm liner, 8 m rolls, 8% wastage, 200 m of extrusion-welded details", () => {
    const r = price();
    expect(line(r, "lin")!.qty_gross).toBe(4320);       // 4000 + 8%
    expect(cost(r, "lin")).toBe(120960);                // 4320 x 28 (2.0 mm)
    expect(qty(r, "dep")).toBe(480);                    // 4000 x 0.12 h
    expect(cost(r, "dep")).toBe(11520);                 // 480 x 24
    expect(qty(r, "seam")).toBe(500);                   // 4000 m2 / 8 m roll width
    expect(cost(r, "seam")).toBe(4500);                 // 500 x 9
    expect(qty(r, "ext")).toBe(200);
    expect(cost(r, "ext")).toBe(4400);                  // 200 x 22
    expect(qty(r, "stl")).toBe(10);                     // 500 m of seam x 0.02 h
    expect(cost(r, "stl")).toBe(240);                   // 10 x 24
    expect(groupCost(r, "HDPE membrane works")).toBe(141620); // 120960 + 11520 + 4500 + 4400 + 240
  });

  it("the seam length follows the liner area, the thickness picks its own liner and the wastage is an input", () => {
    const r = price({ hdpe_area_m2: 2000, hdpe_thk: "t15", hdpe_waste_pct: 10 });
    expect(qty(r, "seam")).toBe(250);                   // 2000 / 8
    expect(cost(r, "seam")).toBe(2250);                 // 250 x 9
    expect(qty(r, "stl")).toBe(5);                      // 250 x 0.02
    expect(cost(r, "stl")).toBe(120);                   // 5 x 24
    expect(line(r, "lin")!.qty_gross).toBe(2200);       // 2000 + 10%
    expect(cost(r, "lin")).toBe(46200);                 // 2200 x 21 (1.5 mm)
    expect(cost(r, "dep")).toBe(5760);                  // 2000 x 0.12 = 240 h x 24
    expect(line(price({ hdpe_waste_pct: 0 }), "lin")!.qty_gross).toBe(4000);
  });

  it("testing by hand: 8 tanks of 650 m3, 7 days hold, 60% of the water reused, 200 m of extrusion weld", () => {
    const r = price();
    expect(qty(r, "tw")).toBe(2080);                    // 8 x 650 x (1 - 0.6)
    expect(cost(r, "tw")).toBe(18720);                  // 2080 x 9
    expect(qty(r, "tp")).toBe(40);                      // 8 x 650 = 5200 m3 / 130 m3 per h
    expect(cost(r, "tp")).toBe(2200);                   // 40 x 55
    expect(qty(r, "ts")).toBe(128);                     // 8 x 16 h
    expect(cost(r, "ts")).toBe(2048);                   // 128 x 16
    expect(qty(r, "tm")).toBe(168);                     // 8 x 7 days x 3 h
    expect(cost(r, "tm")).toBe(4032);                   // 168 x 24
    expect(qty(r, "vt")).toBe(200);                     // every metre of extrusion weld
    expect(cost(r, "vt")).toBe(1400);                   // 200 x 7
    expect(groupCost(r, "Testing")).toBe(28400);        // 18720 + 2200 + 2048 + 4032 + 1400
  });

  it("5 tanks of 520 m3 held for 14 days, and no tanks leaves only the weld testing", () => {
    const r = price({ tanks_n: 5, test_m3: 520, test_hold_days: 14 });
    expect(cost(r, "tw")).toBe(9360);                   // 5 x 520 x 0.4 = 1040 m3 x 9
    expect(qty(r, "tp")).toBe(20);                      // 2600 m3 / 130
    expect(cost(r, "tp")).toBe(1100);                   // 20 x 55
    expect(cost(r, "ts")).toBe(1280);                   // 5 x 16 = 80 h x 16
    expect(cost(r, "tm")).toBe(5040);                   // 5 x 14 x 3 = 210 h x 24
    const none = price({ tanks_n: 0 });
    for (const c of ["tw", "tp", "ts", "tm"]) expect(line(none, c), c).toBeUndefined();
    expect(cost(none, "vt")).toBe(1400);
  });

  it("no liner leaves the extrusion details and every other group untouched", () => {
    const r = price({ hdpe_area_m2: 0 });
    for (const c of ["lin", "dep", "seam", "stl"]) expect(line(r, c), c).toBeUndefined();
    expect(cost(r, "ext")).toBe(4400);
  });

  it("totals by hand: overhead is 10% of every group above it", () => {
    const r = price();
    // 60900 + 312480 + 112500 + 70462.5 + 458640 + 831168 + 594090 + 453600 + 54153 + 141620 + 28400 = 3118013.5
    expect(groupCost(r, "Geotextile")).toBe(54153);     // 50985 + 3168
    expect(qty(r, "ovh")).toBe(3118013.5);
    expect(cost(r, "ovh")).toBe(311801.35);             // 10%
    expect(r.summary.cost_total).toBe(3429814.85);      // 3118013.5 + 311801.35
    expect(r.summary.by_component.transport).toBe(67500);
    expect(r.summary.by_group.map((g) => g.wbs_code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  });

  it("refuses a value outside its range instead of pricing it", () => {
    expect(computeEstimate(body, { test_hold_days: 0 }).ok).toBe(false);
    expect(computeEstimate(body, { test_m3: 0 }).ok).toBe(false);
    expect(computeEstimate(body, { blinding_thk_mm: 20 }).ok).toBe(false);
    expect(computeEstimate(body, { hdpe_waste_pct: 50 }).ok).toBe(false);
    expect(computeEstimate(body, { gt_overlap_pct: 80 }).ok).toBe(false);
  });

  it("carries a risk range on the plant, labour, welding, water and test rates for the Simulation tab", () => {
    for (const k of ["excavator_rate_hr", "labour_rate_hr", "hdpe_weld_rate_m", "hdpe_ext_rate_m", "test_water_cost_m3", "vac_test_rate_m", "tech_rate_hr"]) {
      const rate = T.rates.find((r) => r.key === k)!;
      expect(rate.low, k).toBeLessThan(rate.value);
      expect(rate.high, k).toBeGreaterThan(rate.value);
    }
  });
});

describe("the seeds", () => {
  const seedDir = path.resolve(__dirname, "../../../scripts");
  const read = (f: string) => readFileSync(path.join(seedDir, f), "utf8").replace(/\r\n/g, "\n");

  it("generate the same text every time", () => {
    expect(bundle57Sql()).toBe(bundle57Sql());
    expect(wastewaterSlugSql("any")).toBe(wastewaterSlugSql("any"));
  });

  it("the committed bundle 57, the slug script and the starters seed are what the generator writes (run: npx jiti scripts/gen-estimate-seeds.ts)", () => {
    expect(read(BUNDLE_57_FILE)).toBe(bundle57Sql());
    const committed = read(SLUG_SCRIPT_FILE);
    const slug = SLUG_VARIABLE_RE.exec(committed)?.[1];
    expect(slug).toBeTruthy();
    expect(committed).toBe(wastewaterSlugSql(slug!));
    expect(read("seed-estimate-templates-starter.sql")).toBe(startersSql());
  });

  it("bundle 38 is still the file that was applied: the wastewater starter is not in it", () => {
    expect(bundle38Sql()).not.toContain("Wastewater plant");
    expect(bundle38Sql()).not.toContain("EST-HDPE");
  });

  it("bundle 57 adds this one locked template and its 17 items, never rewrites a product, demo tenants only as shipped", () => {
    const sql = bundle57Sql();
    expect(sql).toContain(`'${T.name}'`);
    expect(sql.split("insert into estimate_templates").length - 1).toBe(1);
    expect(sql).not.toContain("Pipes and fittings");
    expect(sql).toContain("and locked = true");
    expect(sql).toContain("if not exists (select 1 from products where tenant_id = t and sku = item.sku)");
    expect(sql).not.toMatch(/update products/i);
    expect(sql).toContain("is_demo = true");
    expect(sql).toContain("-- TARGET");
    expect(sql).toContain("Catalogue items for the starters (17)");
    for (const i of WASTEWATER_CATALOGUE) expect(sql.split(`"sku":"${i.sku}","name":`).length - 1, i.sku).toBe(1);
    expect(sql).toContain('"illustrative":true');
    expect(sql).toContain(`scripts/seed-wastewater-civil-starter-for-slug.sql`);
  });

  it("the slug script names the workspace on one line only, refuses what it should, and adds only what is missing", () => {
    const sql = read(SLUG_SCRIPT_FILE);
    const slug = SLUG_VARIABLE_RE.exec(sql)![1];
    expect(sql.split(`'${slug}'`).length - 1).toBe(1);                  // the slug is written once, in the variable
    expect(sql).toMatch(/where slug = v_slug/);
    expect(sql).toContain("No workspace with slug % was found. Nothing was changed.");
    expect(sql).toContain("is flagged as a demo workspace");
    expect(sql).toContain("does not have the Estimates module on");
    expect(sql).not.toContain("is_demo = true");                        // never targets demo tenants
    expect(sql).not.toContain("-- TARGET");
    expect(sql).not.toContain("and locked = true");                     // an existing template is not refreshed
    expect(sql).not.toMatch(/update estimate_templates/i);
    expect(sql).not.toMatch(/update products/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql.split("insert into estimate_templates").length - 1).toBe(1);
    expect(sql).toContain("if not exists (select 1 from estimate_templates where tenant_id = t and lower(name) = lower('Wastewater plant civil package (illustrative)'))");
    expect(sql).toContain("if not exists (select 1 from products where tenant_id = t and sku = item.sku)");
    expect(sql).toContain("Each of the 17 catalogue items");
    for (const i of WASTEWATER_CATALOGUE) expect(sql.split(`"sku":"${i.sku}","name":`).length - 1, i.sku).toBe(1);
    expect(sql.indexOf("v_slug text :=")).toBeLessThan(sql.indexOf("insert into estimate_templates"));
  });

  it("the seed that adds the template is the same body as the one the from-starter route validates", () => {
    const v = validateTemplate({ geometry: T.geometry, inputs: T.inputs, rates: T.rates, rules: T.rules, drawing_map: T.drawing_map, visual: T.visual });
    expect(v.ok).toBe(true);
    expect(v.template?.visual).toEqual({ picture: "none" });
    expect(starterCatalogue([STARTER_TEMPLATES.find((s) => s.name === T.name)!])).toHaveLength(17);
  });

  it("is listed in the ledger as pending, as a bundle of its own", () => {
    const project = readFileSync(path.resolve(__dirname, "../../../PROJECT.md"), "utf8");
    expect(project).toContain(BUNDLE_57_FILE);
    expect(project).toContain(SLUG_SCRIPT_FILE);
  });
});
