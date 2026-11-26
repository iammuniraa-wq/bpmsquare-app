// Starter template: wastewater plant civil package (docs/design/gcc-tender-deals.md, "Slice 3c-2 as built" and its wastewater addendum).
//
// THE RATES, RATIOS AND CATALOGUE COSTS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no particular currency. They are not any contractor's
// method or any supplier's price. One template for the civil works package of an industrial wastewater treatment and recycling plant,
// the way a BOQ lists it: earthworks and soil replacement, foundation and tank concrete, waterproofing, geotextile, HDPE membrane
// works and the water-tightness and seam tests. Building works (blockwork and plaster) are left to the Blockwork and plaster starter.
//
// It reuses the civil basics rather than repeating them: the soil choices, the ready-mix grades, reinforcement, formwork and fill
// items, and the excavation and reinforced-concrete rates are read from starterTemplatesCivil.ts, so a rate sheet that reprices
// "Reinforcement steel" reaches this template as well. Waterproofing, geotextile and liner materials are NEW catalogue items; plant,
// labour, water and testing are template rates, which a workspace changes by "Copy to customise".
//
// Group names are plain words (they become the WBS and the price sections); a MasterFormat code is used only where it is certain.

import { groupSlug } from "./types";
import type { StarterCatalogueItem } from "./starterCatalogue";
import type { CatalogueStarter } from "./starterTemplatesTiles";
import type { TemplateRate, TemplateRule } from "./types";
import { CIVIL_CATALOGUE, CONCRETE_WORKS_STARTER, EXCAVATION_STARTER, READY_MIX_GRADES, SOIL_OPTIONS } from "./starterTemplatesCivil";

const sub = (group: string) => `sub_${groupSlug(group)}`;
const rule = (r: TemplateRule): TemplateRule => r;

const civilItem = (sku: string): StarterCatalogueItem => {
  const hit = CIVIL_CATALOGUE.find((i) => i.sku === sku);
  if (!hit) throw new Error(`The civil catalogue has no item ${sku}`);
  return hit;
};
const civilRate = (from: readonly TemplateRate[], key: string): TemplateRate => {
  const hit = from.find((r) => r.key === key);
  if (!hit) throw new Error(`The civil starters have no rate ${key}`);
  return hit;
};

// ── Catalogue items that are new here ────────────────────────────────────────────────────────────────────────────────

export const WASTEWATER_SYSTEMS = [
  { key: "cementitious", label: "Cementitious coating", value: 1, sku: "EST-WP-CEM", name: "Cementitious waterproofing coating, two coats", cost: 36 },
  { key: "sheet", label: "Bituminous sheet membrane", value: 2, sku: "EST-WP-SHEET", name: "Bituminous sheet waterproofing membrane", cost: 58 },
  { key: "pu", label: "Polyurethane liquid membrane", value: 3, sku: "EST-WP-PU", name: "Polyurethane liquid waterproofing membrane", cost: 74 },
] as const;

export const HDPE_THICKNESSES = [
  { key: "t15", label: "1.5 mm", mm: "1.5", value: 1.5, sku: "EST-HDPE-15", cost: 21 },
  { key: "t20", label: "2.0 mm", mm: "2.0", value: 2, sku: "EST-HDPE-20", cost: 28 },
] as const;

const NEW_ITEMS: StarterCatalogueItem[] = [
  { sku: "EST-WW-CRUSHED", name: "Crushed rock base, delivered", uom: "m3", cost: 85, attrs: { est_kind: "crushed_rock" }, family: "civil" },
  ...WASTEWATER_SYSTEMS.map((s): StarterCatalogueItem => ({
    sku: s.sku, name: s.name, uom: "m2", cost: s.cost, attrs: { est_kind: "waterproofing", wp_system: s.key }, family: "civil",
  })),
  { sku: "EST-WP-PRIMER", name: "Waterproofing primer", uom: "l", cost: 16, attrs: { est_kind: "wp_primer" }, family: "civil" },
  { sku: "EST-WP-BOARD", name: "Protection board over waterproofing", uom: "m2", cost: 26, attrs: { est_kind: "wp_protection" }, family: "civil" },
  { sku: "EST-GEOTEXTILE", name: "Nonwoven geotextile, 300 g/m2", uom: "m2", cost: 7.5, attrs: { est_kind: "geotextile" }, family: "civil" },
  ...HDPE_THICKNESSES.map((t): StarterCatalogueItem => ({
    sku: t.sku, name: `HDPE geomembrane ${t.label}, smooth`, uom: "m2", cost: t.cost, attrs: { est_kind: "hdpe_liner", hdpe_thk: t.mm }, family: "civil",
  })),
];

const REUSED_SKUS = ["EST-FILL", "EST-REBAR", "EST-FORMWORK", ...READY_MIX_GRADES.map((g) => `EST-RMX-${g.label}`)];

/** What this template prices from: the civil items it reuses, then the items that are new here. */
export const WASTEWATER_CATALOGUE: readonly StarterCatalogueItem[] = [...REUSED_SKUS.map(civilItem), ...NEW_ITEMS];
/** Only the items that exist because of this template (the rest are the civil basics' own). */
export const WASTEWATER_NEW_ITEMS: readonly StarterCatalogueItem[] = NEW_ITEMS;

// ── Groups ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const G_EXC = "31 23 16 Excavation";
const G_FILL = "31 23 23 Soil replacement and fill";
const G_DISP = "Disposal of surplus";
const G_BLIND = "Blinding concrete";
const G_FORM = "03 11 00 Concrete forming and accessories";
const G_RBR = "03 21 00 Reinforcing steel";
const G_CIP = "03 30 00 Cast-in-place concrete";
const G_WP = "Waterproofing";
const G_GT = "Geotextile";
const G_HDPE = "HDPE membrane works";
const G_TEST = "Testing";
const GROUPS = [G_EXC, G_FILL, G_DISP, G_BLIND, G_FORM, G_RBR, G_CIP, G_WP, G_GT, G_HDPE, G_TEST];

/** Poor soil dug out and replaced: the plan area times the depth. */
const REPL = "(repl_area_m2 * repl_depth_m)";
/** One metre of liner roll gives 1/roll-width metres of seam per m2 of liner. */
const SEAM = "(hdpe_area_m2 / hdpe_roll_w_m)";

const exc = EXCAVATION_STARTER.rates;
const con = CONCRETE_WORKS_STARTER.rates;

export const WASTEWATER_PLANT_STARTER: CatalogueStarter = {
  name: "Wastewater plant civil package (illustrative)",
  description:
    "ILLUSTRATIVE starter for the civil works of an industrial wastewater treatment and recycling plant: earthworks and soil replacement, tank and foundation concrete, waterproofing, geotextile, HDPE membrane works, and water-tightness and seam testing. Materials come from catalogue items marked illustrative until you import a rate sheet; plant, labour and test rates are placeholders. Blockwork and plaster are left to their own starter.",
  trade: "civil",
  icon: "grid",
  keywords: [
    "wastewater", "waste water", "sewage", "effluent", "treatment plant", "STP", "ETP", "WWTP", "recycling plant", "tank", "tanks", "sump", "channel",
    "water retaining", "waterproofing", "membrane", "geotextile", "HDPE", "liner", "geomembrane", "water tightness", "flood test", "leak test",
    "soil replacement", "excavation", "reinforced concrete", "civil package", "foundation",
  ],
  quote_granularity: "group",
  catalogue: WASTEWATER_CATALOGUE,
  visual: { picture: "none" },

  inputs: [
    { key: "exc_m3", label: "Volume to excavate", type: "number", default: 8000, min: 0, max: 10000000, unit: "m³", section: "Earthworks" },
    { key: "soil_type", label: "Soil", type: "select", default: "sand", section: "Earthworks",
      help: "Clay digs slower than sand, and rock needs a breaker as well as the excavator.", options: SOIL_OPTIONS },
    { key: "repl_area_m2", label: "Poor soil to replace, plan area", type: "number", default: 2500, min: 0, max: 1000000, unit: "m²", section: "Soil replacement and fill",
      help: "The area where soft or unsuitable soil is dug out below the structures and replaced. Taken as soft soil, never rock." },
    { key: "repl_depth_m", label: "Replacement depth", type: "number", default: 1, min: 0, max: 6, unit: "m", section: "Soil replacement and fill" },
    { key: "repl_fill", label: "Replacement fill", type: "select", default: "selected", section: "Soil replacement and fill",
      options: [
        { key: "selected", label: "Selected granular fill", value: 1 },
        { key: "crushed", label: "Crushed rock base", value: 2 },
      ] },
    { key: "backfill_m3", label: "Excavated soil put back (compacted)", type: "number", default: 4500, min: 0, max: 10000000, unit: "m³", section: "Soil replacement and fill",
      help: "The excavated soil that is reused. What is not put back is carted away." },
    { key: "import_fill_m3", label: "Imported fill for backfill", type: "number", default: 1200, min: 0, max: 10000000, unit: "m³", section: "Soil replacement and fill" },
    { key: "dump_km", label: "Distance to the tip", type: "number", default: 20, min: 0, max: 500, unit: "km", section: "Soil replacement and fill" },

    { key: "concrete_m3", label: "Concrete in foundations, tanks, channels and sumps", type: "number", default: 1800, min: 0, max: 10000000, unit: "m³", section: "Concrete structures" },
    { key: "concrete_grade", label: "Grade", type: "select", default: "c35", section: "Concrete structures",
      options: READY_MIX_GRADES.map((g) => ({ key: g.key, label: g.label, value: g.value, attrs: { concrete_grade: g.key } })) },
    { key: "pumped", label: "Placed by pump", type: "boolean", default: true, section: "Concrete structures" },
    { key: "rebar_kg_m3", label: "Reinforcement", type: "number", default: 130, min: 0, max: 500, unit: "kg per m³", section: "Concrete structures" },
    { key: "formwork_m2_per_m3", label: "Formwork contact area", type: "number", default: 7, min: 0, max: 40, unit: "m² per m³", section: "Concrete structures",
      help: "About 2 for a thick slab, 6 for a slab or beam, 10 or more for walls." },
    { key: "blinding_m2", label: "Blinding, plan area", type: "number", default: 2500, min: 0, max: 1000000, unit: "m²", section: "Concrete structures" },
    { key: "blinding_thk_mm", label: "Blinding thickness", type: "number", default: 100, min: 50, max: 300, unit: "mm", section: "Concrete structures" },

    { key: "wp_area_m2", label: "Waterproofed area", type: "number", default: 4500, min: 0, max: 1000000, unit: "m²", section: "Waterproofing" },
    { key: "wp_system", label: "System", type: "select", default: "sheet", section: "Waterproofing",
      help: "Picks the waterproofing material from your catalogue. A membrane also takes primer.",
      options: WASTEWATER_SYSTEMS.map((s) => ({ key: s.key, label: s.label, value: s.value, attrs: { wp_system: s.key } })) },
    { key: "wp_protect", label: "Protection board over the membrane", type: "boolean", default: true, section: "Waterproofing" },

    { key: "gt_area_m2", label: "Geotextile area", type: "number", default: 6000, min: 0, max: 1000000, unit: "m²", section: "Geotextile" },
    { key: "gt_overlap_pct", label: "Overlap", type: "number", default: 10, min: 0, max: 50, unit: "%", section: "Geotextile" },

    { key: "hdpe_area_m2", label: "Liner area", type: "number", default: 4000, min: 0, max: 1000000, unit: "m²", section: "HDPE membrane" },
    { key: "hdpe_thk", label: "Thickness", type: "select", default: "t20", section: "HDPE membrane",
      options: HDPE_THICKNESSES.map((t) => ({ key: t.key, label: t.label, value: t.value, attrs: { hdpe_thk: t.mm } })) },
    { key: "hdpe_waste_pct", label: "Wastage (cut-offs and trimming)", type: "number", default: 8, min: 0, max: 30, unit: "%", section: "HDPE membrane" },
    { key: "hdpe_detail_m", label: "Extrusion-welded details (pipe boots, corners, patches)", type: "number", default: 200, min: 0, max: 1000000, unit: "m", section: "HDPE membrane" },

    { key: "tanks_n", label: "Tanks to test", type: "number", default: 8, min: 0, max: 1000, unit: "nr", section: "Testing" },
    { key: "test_m3", label: "Test water per tank", type: "number", default: 650, min: 1, max: 1000000, unit: "m³", section: "Testing" },
    { key: "test_hold_days", label: "Hold time", type: "number", default: 7, min: 1, max: 60, unit: "days", section: "Testing" },
  ],

  rates: [
    // The excavation and reinforced-concrete rates of the civil basics, so one set of numbers serves all three templates.
    ...["exc_m3_per_h", "excavator_rate_hr", "breaker_h_per_m3", "breaker_rate_hr", "backfill_cost_m3", "fill_waste_pct", "spoil_swell", "cart_cost_m3_km", "tipping_fee_m3"]
      .map((k) => civilRate(exc, k)),
    ...["concrete_waste_pct", "rebar_waste_pct", "form_h_per_m2", "rebar_h_per_kg", "place_h_per_m3", "labour_rate_hr", "pump_m3_per_h", "pump_rate_hr"]
      .map((k) => civilRate(con, k)),
    { key: "wp_waste_pct", label: "Laps, upstands and wastage on waterproofing", unit: "%", value: 8 },
    { key: "wp_primer_l_per_m2", label: "Primer per m² of membrane", unit: "l/m²", value: 0.25 },
    { key: "wp_h_cem", label: "Labour per m² of cementitious coating", unit: "h/m²", value: 0.18, low: 0.15, high: 0.25 },
    { key: "wp_h_sheet", label: "Labour per m² of sheet membrane", unit: "h/m²", value: 0.3, low: 0.25, high: 0.4 },
    { key: "wp_h_pu", label: "Labour per m² of liquid membrane", unit: "h/m²", value: 0.25, low: 0.2, high: 0.35 },
    { key: "wp_board_h_per_m2", label: "Labour per m² of protection board", unit: "h/m²", value: 0.06 },
    { key: "gt_waste_pct", label: "Wastage on geotextile", unit: "%", value: 3 },
    { key: "gt_h_per_m2", label: "Labour per m² of geotextile laid", unit: "h/m²", value: 0.03 },
    { key: "hdpe_roll_w_m", label: "Liner roll width (a seam runs along each roll)", unit: "m", value: 8 },
    { key: "hdpe_crew_rate_hr", label: "Liner crew, per hour", unit: "per h", value: 24, low: 20, high: 32 },
    { key: "hdpe_deploy_h_per_m2", label: "Crew hours to deploy a m² of liner", unit: "h/m²", value: 0.12, low: 0.1, high: 0.16 },
    { key: "hdpe_weld_rate_m", label: "Fusion welding (crew and machine), per m of seam", unit: "per m", value: 9, low: 7, high: 13 },
    { key: "hdpe_ext_rate_m", label: "Extrusion welding, per m of detail", unit: "per m", value: 22, low: 17, high: 30 },
    { key: "hdpe_seam_test_h_per_m", label: "Seam test crew hours per m of fusion seam", unit: "h/m", value: 0.02 },
    { key: "test_reuse_share", label: "Share of test water reused from tank to tank", unit: "fraction", value: 0.6 },
    { key: "test_water_cost_m3", label: "Test water, delivered", unit: "per m³", value: 9, low: 6, high: 14 },
    { key: "test_pump_m3_per_h", label: "Test pump output", unit: "m³/h", value: 130 },
    { key: "test_pump_rate_hr", label: "Test pump with operator", unit: "per h", value: 55, low: 45, high: 70 },
    { key: "test_setup_h", label: "Labour hours to fill, fit gauges and drain one tank", unit: "h", value: 16 },
    { key: "test_monitor_h_per_day", label: "Technician hours per tank per day of the hold", unit: "h/day", value: 3 },
    { key: "tech_rate_hr", label: "Technician rate", unit: "per h", value: 24, low: 20, high: 30 },
    { key: "vac_test_rate_m", label: "Vacuum and spark testing, per m of weld", unit: "per m", value: 7, low: 5, high: 10 },
    civilRate(exc, "overhead_factor"),
  ],

  rules: [
    // Earthworks
    rule({ code: "exc", group: G_EXC, description: "Excavation (excavator with operator)", uom: "h", qty: "exc_m3 * soil_type / exc_m3_per_h",
      component: "other", cost: { kind: "rate", rate: "excavator_rate_hr" } }),
    rule({ code: "rock", group: G_EXC, description: "Rock breaking (hydraulic breaker)", uom: "h", qty: "(soil_type > 2) * exc_m3 * breaker_h_per_m3",
      component: "other", cost: { kind: "rate", rate: "breaker_rate_hr" } }),
    rule({ code: "pdig", group: G_EXC, description: "Poor soil dug out below structures (excavator with operator)", uom: "h", qty: `${REPL} / exc_m3_per_h`,
      component: "other", cost: { kind: "rate", rate: "excavator_rate_hr" } }),
    rule({ code: "rfs", group: G_FILL, description: "Replacement fill: selected granular fill", uom: "m3", qty: `(repl_fill == 1) * ${REPL}`, waste_pct: "fill_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-FILL" } }),
    rule({ code: "rfc", group: G_FILL, description: "Replacement fill: crushed rock base", uom: "m3", qty: `(repl_fill == 2) * ${REPL}`, waste_pct: "fill_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-WW-CRUSHED" } }),
    rule({ code: "rcp", group: G_FILL, description: "Placing and compacting replacement fill (labour and plant)", uom: "m3", qty: REPL,
      component: "other", cost: { kind: "rate", rate: "backfill_cost_m3" } }),
    rule({ code: "bkf", group: G_FILL, description: "Backfill and compaction (labour and plant)", uom: "m3", qty: "backfill_m3",
      component: "other", cost: { kind: "rate", rate: "backfill_cost_m3" } }),
    rule({ code: "fill", group: G_FILL, description: "Imported selected fill for backfill", uom: "m3", qty: "import_fill_m3", waste_pct: "fill_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-FILL" } }),
    rule({ code: "cart", group: G_DISP, description: "Surplus spoil carted to tip", uom: "m3-km", qty: `max(0, exc_m3 + ${REPL} - backfill_m3) * spoil_swell * dump_km`,
      component: "transport", cost: { kind: "rate", rate: "cart_cost_m3_km" } }),
    rule({ code: "tip", group: G_DISP, description: "Tipping fee", uom: "m3", qty: `max(0, exc_m3 + ${REPL} - backfill_m3) * spoil_swell`,
      component: "other", cost: { kind: "rate", rate: "tipping_fee_m3" } }),

    // Foundations and reinforced concrete structures
    rule({ code: "bld", group: G_BLIND, description: "Blinding concrete C25, delivered", uom: "m3", qty: "blinding_m2 * blinding_thk_mm / 1000", waste_pct: "concrete_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-RMX-C25" } }),
    rule({ code: "blp", group: G_BLIND, description: "Placing and levelling blinding (labour)", uom: "h", qty: "qty_bld * place_h_per_m3",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "fwm", group: G_FORM, description: "Formwork materials", uom: "m2", qty: "concrete_m3 * formwork_m2_per_m3",
      component: "materials", cost: { kind: "product", sku: "EST-FORMWORK" } }),
    rule({ code: "fwl", group: G_FORM, description: "Formwork labour (fix and strip)", uom: "h", qty: "qty_fwm * form_h_per_m2",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "rbr", group: G_RBR, description: "Reinforcement steel (cut and bent)", uom: "kg", qty: "concrete_m3 * rebar_kg_m3", waste_pct: "rebar_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-REBAR" } }),
    rule({ code: "rbl", group: G_RBR, description: "Reinforcement labour (cut, bend and fix)", uom: "h", qty: "qty_rbr * rebar_h_per_kg",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "conc", group: G_CIP, description: "Ready-mix concrete, delivered", uom: "m3", qty: "concrete_m3", waste_pct: "concrete_waste_pct",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "ready_mix" }, from: ["concrete_grade"] } } }),
    rule({ code: "plc", group: G_CIP, description: "Placing, vibrating and curing labour", uom: "h", qty: "concrete_m3 * place_h_per_m3",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "pmp", group: G_CIP, description: "Concrete pump", uom: "h", qty: "pumped * concrete_m3 / pump_m3_per_h",
      component: "other", cost: { kind: "rate", rate: "pump_rate_hr" } }),

    // Waterproofing
    rule({ code: "wpm", group: G_WP, description: "Waterproofing system, supplied", uom: "m2", qty: "wp_area_m2", waste_pct: "wp_waste_pct",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "waterproofing" }, from: ["wp_system"] } } }),
    rule({ code: "wpp", group: G_WP, description: "Primer (membrane systems)", uom: "l", qty: "(wp_system > 1) * wp_area_m2 * wp_primer_l_per_m2", waste_pct: "wp_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-WP-PRIMER" } }),
    rule({ code: "wpb", group: G_WP, description: "Protection board", uom: "m2", qty: "wp_protect * wp_area_m2", waste_pct: "wp_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-WP-BOARD" } }),
    rule({ code: "wpl", group: G_WP, description: "Waterproofing application labour", uom: "h",
      qty: "wp_area_m2 * if(wp_system == 1, wp_h_cem, if(wp_system == 2, wp_h_sheet, wp_h_pu))",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "wpf", group: G_WP, description: "Protection board fixing labour", uom: "h", qty: "qty_wpb * wp_board_h_per_m2",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),

    // Geotextile
    rule({ code: "gtm", group: G_GT, description: "Geotextile, including overlaps", uom: "m2", qty: "gt_area_m2 * (1 + gt_overlap_pct / 100)", waste_pct: "gt_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-GEOTEXTILE" } }),
    rule({ code: "gtl", group: G_GT, description: "Geotextile laying labour", uom: "h", qty: "qty_gtm * gt_h_per_m2",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),

    // HDPE membrane works
    rule({ code: "lin", group: G_HDPE, description: "HDPE geomembrane liner, supplied", uom: "m2", qty: "hdpe_area_m2", waste_pct: "hdpe_waste_pct",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "hdpe_liner" }, from: ["hdpe_thk"] } } }),
    rule({ code: "dep", group: G_HDPE, description: "Liner deployment (crew)", uom: "h", qty: "hdpe_area_m2 * hdpe_deploy_h_per_m2",
      component: "labour", cost: { kind: "rate", rate: "hdpe_crew_rate_hr" } }),
    rule({ code: "seam", group: G_HDPE, description: "Fusion welding of seams (length from the liner area)", uom: "m", qty: SEAM,
      component: "other", cost: { kind: "rate", rate: "hdpe_weld_rate_m" } }),
    rule({ code: "ext", group: G_HDPE, description: "Extrusion welding of details", uom: "m", qty: "hdpe_detail_m",
      component: "other", cost: { kind: "rate", rate: "hdpe_ext_rate_m" } }),
    rule({ code: "stl", group: G_HDPE, description: "Seam test labour (air-channel test of fusion seams)", uom: "h", qty: "qty_seam * hdpe_seam_test_h_per_m",
      component: "labour", cost: { kind: "rate", rate: "hdpe_crew_rate_hr" } }),

    // Testing
    rule({ code: "tw", group: G_TEST, description: "Water-tightness test: test water", uom: "m3", qty: "tanks_n * test_m3 * (1 - test_reuse_share)",
      component: "other", cost: { kind: "rate", rate: "test_water_cost_m3" } }),
    rule({ code: "tp", group: G_TEST, description: "Water-tightness test: pumping", uom: "h", qty: "tanks_n * test_m3 / test_pump_m3_per_h",
      component: "other", cost: { kind: "rate", rate: "test_pump_rate_hr" } }),
    rule({ code: "ts", group: G_TEST, description: "Water-tightness test: fill, gauges and drain (labour)", uom: "h", qty: "tanks_n * test_setup_h",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "tm", group: G_TEST, description: "Water-tightness test: level monitoring over the hold (technician)", uom: "h", qty: "tanks_n * test_hold_days * test_monitor_h_per_day",
      component: "labour", cost: { kind: "rate", rate: "tech_rate_hr" } }),
    rule({ code: "vt", group: G_TEST, description: "Vacuum and spark testing of extrusion welds", uom: "m", qty: "hdpe_detail_m",
      component: "other", cost: { kind: "rate", rate: "vac_test_rate_m" } }),

    rule({ code: "ovh", group: "Overhead", description: "Overhead", uom: "cost", qty: GROUPS.map(sub).join(" + "),
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

export const WASTEWATER_STARTERS: readonly CatalogueStarter[] = [WASTEWATER_PLANT_STARTER];
