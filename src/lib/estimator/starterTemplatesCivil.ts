// Starter templates: civil basics (docs/design/gcc-tender-deals.md, "Slice 3c-2 as built").
//
// Three small templates rather than one with a work-type switch: a form shows only what the work needs, a BOQ line such as
// "Reinforced concrete C30" opens the matching template with its quantity, and each prints its own lines on a quote.
//   1. Excavation and backfill
//   2. Reinforced concrete (concrete, formwork, reinforcement at kg per m³)
//   3. Blockwork and plaster
//
// THE RATES, RATIOS AND CATALOGUE COSTS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no particular currency. Materials (ready-mix,
// reinforcement, formwork, blocks, mortar, plaster, fill) are CATALOGUE items flagged illustrative until a rate sheet is
// imported; plant, labour and haulage are template rates, which a workspace changes by "Copy to customise".
//
// Group names carry the MasterFormat section where the code is certain: 31 23 16 Excavation, 31 23 23 Fill, 03 11 00 Concrete
// Forming and Accessories, 03 21 00 Reinforcing Steel, 03 30 00 Cast-in-Place Concrete, 04 22 00 Concrete Unit Masonry,
// 09 24 00 Cement Plastering. The template format has no cost-code field of its own yet, so the code rides in the group name.

import { groupSlug } from "./types";
import type { StarterCatalogueItem } from "./starterCatalogue";
import type { CatalogueStarter } from "./starterTemplatesTiles";
import type { TemplateRule } from "./types";

const sub = (group: string) => `sub_${groupSlug(group)}`;
const rule = (r: TemplateRule): TemplateRule => r;

// ── Shared catalogue items ───────────────────────────────────────────────────────────────────────────────────────────

export const READY_MIX_GRADES = [
  { key: "c25", label: "C25", value: 25, cost: 255 },
  { key: "c30", label: "C30", value: 30, cost: 275 },
  { key: "c35", label: "C35", value: 35, cost: 295 },
  { key: "c40", label: "C40", value: 40, cost: 315 },
  { key: "c50", label: "C50", value: 50, cost: 345 },
] as const;

export const BLOCK_THICKNESSES = [
  { key: "b100", mm: 100, cost: 3.2 },
  { key: "b150", mm: 150, cost: 4.4 },
  { key: "b200", mm: 200, cost: 5.6 },
] as const;

const REBAR: StarterCatalogueItem = { sku: "EST-REBAR", name: "Reinforcement steel, cut and bent", uom: "kg", cost: 3.2, attrs: { est_kind: "rebar" }, family: "civil" };
const FILL: StarterCatalogueItem = { sku: "EST-FILL", name: "Selected fill, delivered", uom: "m3", cost: 48, attrs: { est_kind: "fill" }, family: "civil" };
const FORMWORK: StarterCatalogueItem = { sku: "EST-FORMWORK", name: "Formwork materials (plywood, props, ties), per m² of contact area", uom: "m2", cost: 22, attrs: { est_kind: "formwork" }, family: "civil" };
const MORTAR: StarterCatalogueItem = { sku: "EST-MORTAR", name: "Block mortar (cement and sand)", uom: "m3", cost: 190, attrs: { est_kind: "mortar" }, family: "civil" };
const PLASTER: StarterCatalogueItem = { sku: "EST-PLASTER", name: "Plaster (cement and sand, mixed)", uom: "m3", cost: 210, attrs: { est_kind: "plaster" }, family: "civil" };
const READY_MIX: StarterCatalogueItem[] = READY_MIX_GRADES.map((g) => ({
  sku: `EST-RMX-${g.label}`, name: `Ready-mix concrete ${g.label}, delivered`, uom: "m3", cost: g.cost,
  attrs: { est_kind: "ready_mix", concrete_grade: g.key }, family: "civil" as const,
}));
const BLOCKS: StarterCatalogueItem[] = BLOCK_THICKNESSES.map((b) => ({
  sku: `EST-BLK-${b.mm}`, name: `Concrete block ${b.mm} mm (400 x 200)`, uom: "nr", cost: b.cost,
  attrs: { est_kind: "block", block_mm: String(b.mm) }, family: "civil" as const,
}));

export const CIVIL_CATALOGUE: readonly StarterCatalogueItem[] = [REBAR, FILL, FORMWORK, MORTAR, PLASTER, ...READY_MIX, ...BLOCKS];

const SOIL_OPTIONS = [
  { key: "sand", label: "Sand or loose soil", value: 1 },
  { key: "clay", label: "Stiff clay", value: 1.4 },
  { key: "rock", label: "Rock", value: 2.5 },
];

// ── 1. Excavation and backfill ──────────────────────────────────────────────────────────────────────────────────────

const G_EXC = "31 23 16 Excavation";
const G_FILL = "31 23 23 Fill and compaction";
const G_DISP = "Disposal of surplus";

export const EXCAVATION_STARTER: CatalogueStarter = {
  name: "Excavation and backfill (illustrative)",
  description:
    "ILLUSTRATIVE starter for bulk or trench excavation with backfill: excavator and breaker time by soil, compaction, imported fill, and surplus carted away to tip. Imported fill comes from a catalogue item marked illustrative until you import a rate sheet; plant and haulage rates are placeholders. Copy it and replace them with your own.",
  trade: "civil works",
  icon: "grid",
  keywords: ["excavation", "excavate", "earthworks", "cut and fill", "backfill", "compaction", "trench", "spoil", "soil", "rock", "dig", "imported fill", "disposal", "tip"],
  quote_granularity: "group",
  catalogue: [FILL],

  inputs: [
    { key: "exc_m3", label: "Volume to excavate", type: "number", default: 500, min: 0.1, max: 1000000, unit: "m³", section: "Excavation" },
    { key: "soil_type", label: "Soil", type: "select", default: "sand", section: "Excavation",
      help: "Clay digs slower than sand, and rock needs a breaker as well as the excavator.", options: SOIL_OPTIONS },
    { key: "backfill_m3", label: "Volume put back (compacted)", type: "number", default: 350, min: 0, max: 1000000, unit: "m³", section: "Backfill and disposal",
      help: "The excavated soil that is reused. What is not put back is carted away." },
    { key: "import_fill_m3", label: "Imported fill", type: "number", default: 0, min: 0, max: 1000000, unit: "m³", section: "Backfill and disposal" },
    { key: "dump_km", label: "Distance to the tip", type: "number", default: 15, min: 0, max: 500, unit: "km", section: "Backfill and disposal" },
  ],

  rates: [
    { key: "exc_m3_per_h", label: "Excavator production in sand", unit: "m³/h", value: 25 },
    { key: "excavator_rate_hr", label: "Excavator with operator", unit: "per h", value: 145, low: 130, high: 175 },
    { key: "breaker_h_per_m3", label: "Breaker time in rock", unit: "h/m³", value: 0.15 },
    { key: "breaker_rate_hr", label: "Hydraulic breaker with operator", unit: "per h", value: 190, low: 170, high: 230 },
    { key: "backfill_cost_m3", label: "Backfill and compaction, labour and plant", unit: "per m³", value: 18, low: 15, high: 24 },
    { key: "fill_waste_pct", label: "Wastage on imported fill", unit: "%", value: 5 },
    { key: "spoil_swell", label: "Loose volume of spoil per m³ in place", unit: "factor", value: 1.25 },
    { key: "cart_cost_m3_km", label: "Spoil carted, per m³ and km", unit: "per m³-km", value: 0.45, low: 0.38, high: 0.6 },
    { key: "tipping_fee_m3", label: "Tipping fee", unit: "per m³", value: 6 },
    { key: "overhead_factor", label: "Overhead (share of all the cost above)", unit: "fraction", value: 0.1 },
  ],

  rules: [
    rule({ code: "exc", group: G_EXC, description: "Excavation (excavator with operator)", uom: "h", qty: "exc_m3 * soil_type / exc_m3_per_h",
      component: "other", cost: { kind: "rate", rate: "excavator_rate_hr" } }),
    rule({ code: "rock", group: G_EXC, description: "Rock breaking (hydraulic breaker)", uom: "h", qty: "(soil_type > 2) * exc_m3 * breaker_h_per_m3",
      component: "other", cost: { kind: "rate", rate: "breaker_rate_hr" } }),
    rule({ code: "bkf", group: G_FILL, description: "Backfill and compaction (labour and plant)", uom: "m3", qty: "backfill_m3",
      component: "other", cost: { kind: "rate", rate: "backfill_cost_m3" } }),
    rule({ code: "fill", group: G_FILL, description: "Imported selected fill", uom: "m3", qty: "import_fill_m3", waste_pct: "fill_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-FILL" } }),
    rule({ code: "cart", group: G_DISP, description: "Surplus spoil carted to tip", uom: "m3-km", qty: "max(0, exc_m3 - backfill_m3) * spoil_swell * dump_km",
      component: "transport", cost: { kind: "rate", rate: "cart_cost_m3_km" } }),
    rule({ code: "tip", group: G_DISP, description: "Tipping fee", uom: "m3", qty: "max(0, exc_m3 - backfill_m3) * spoil_swell",
      component: "other", cost: { kind: "rate", rate: "tipping_fee_m3" } }),
    rule({ code: "ovh", group: "Overhead", description: "Overhead", uom: "cost", qty: `${sub(G_EXC)} + ${sub(G_FILL)} + ${sub(G_DISP)}`,
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

// ── 2. Reinforced concrete ──────────────────────────────────────────────────────────────────────────────────────────

const G_FORM = "03 11 00 Concrete forming and accessories";
const G_RBR = "03 21 00 Reinforcing steel";
const G_CIP = "03 30 00 Cast-in-place concrete";

export const CONCRETE_WORKS_STARTER: CatalogueStarter = {
  name: "Reinforced concrete (illustrative)",
  description:
    "ILLUSTRATIVE starter for cast-in-place reinforced concrete: formwork, reinforcement at a kg per m³ you choose, ready-mix concrete by grade, placing labour and an optional pump. Concrete, steel and formwork materials come from catalogue items marked illustrative until you import a rate sheet; labour and pump rates are placeholders. Copy it and replace them with your own.",
  trade: "civil works",
  icon: "grid",
  keywords: ["concrete", "reinforced concrete", "RCC", "formwork", "shuttering", "rebar", "reinforcement", "steel bars", "foundation", "slab", "wall", "column", "ready mix", "pump", "cast in place", "kg per m3"],
  quote_granularity: "group",
  catalogue: [REBAR, FORMWORK, ...READY_MIX],

  inputs: [
    { key: "concrete_m3", label: "Concrete", type: "number", default: 100, min: 0.1, max: 1000000, unit: "m³", section: "Concrete" },
    { key: "concrete_grade", label: "Grade", type: "select", default: "c30", section: "Concrete",
      options: READY_MIX_GRADES.map((g) => ({ key: g.key, label: g.label, value: g.value, attrs: { concrete_grade: g.key } })) },
    { key: "pumped", label: "Placed by pump", type: "boolean", default: true, section: "Concrete" },
    { key: "rebar_kg_m3", label: "Reinforcement", type: "number", default: 100, min: 0, max: 500, unit: "kg per m³", section: "Reinforcement and formwork" },
    { key: "formwork_m2_per_m3", label: "Formwork contact area", type: "number", default: 6, min: 0, max: 40, unit: "m² per m³", section: "Reinforcement and formwork",
      help: "About 2 for a thick slab, 6 for a slab or beam, 10 or more for walls and columns." },
  ],

  rates: [
    { key: "concrete_waste_pct", label: "Wastage on concrete", unit: "%", value: 3 },
    { key: "rebar_waste_pct", label: "Wastage on reinforcement", unit: "%", value: 5 },
    { key: "form_h_per_m2", label: "Carpenter hours to fix and strip a m² of formwork", unit: "h/m²", value: 0.9, low: 0.75, high: 1.2 },
    { key: "rebar_h_per_kg", label: "Steel fixer hours per kg", unit: "h/kg", value: 0.012, low: 0.01, high: 0.016 },
    { key: "place_h_per_m3", label: "Placing, vibrating and curing hours per m³", unit: "h/m³", value: 1.2 },
    { key: "labour_rate_hr", label: "Labour rate", unit: "per h", value: 16, low: 14, high: 20 },
    { key: "pump_m3_per_h", label: "Pump output", unit: "m³/h", value: 30 },
    { key: "pump_rate_hr", label: "Concrete pump with operator", unit: "per h", value: 210, low: 190, high: 260 },
    { key: "overhead_factor", label: "Overhead (share of all the cost above)", unit: "fraction", value: 0.1 },
  ],

  rules: [
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
    rule({ code: "ovh", group: "Overhead", description: "Overhead", uom: "cost", qty: `${sub(G_FORM)} + ${sub(G_RBR)} + ${sub(G_CIP)}`,
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

// ── 3. Blockwork and plaster ────────────────────────────────────────────────────────────────────────────────────────

const G_MAS = "04 22 00 Concrete unit masonry";
const G_PLA = "09 24 00 Cement plastering";
/** The wall area to build and plaster: the gross wall less the openings. */
const NET = "max(0, wall_area_m2 - openings_m2)";

export const BLOCKWORK_PLASTER_STARTER: CatalogueStarter = {
  name: "Blockwork and plaster (illustrative)",
  description:
    "ILLUSTRATIVE starter for blockwork with cement plaster: blocks and mortar from the wall area less its openings, laying labour, and plaster on one or both faces. Blocks, mortar and plaster come from catalogue items marked illustrative until you import a rate sheet; labour rates are placeholders. Copy it and replace them with your own.",
  trade: "civil works",
  icon: "grid",
  keywords: ["blockwork", "block wall", "blocks", "masonry", "plaster", "plastering", "render", "cement plaster", "partition wall", "wall", "mortar", "hollow block", "solid block", "per m2"],
  quote_granularity: "group",
  catalogue: [MORTAR, PLASTER, ...BLOCKS],

  inputs: [
    { key: "wall_area_m2", label: "Wall area", type: "number", default: 300, min: 1, max: 1000000, unit: "m²", section: "Wall" },
    { key: "openings_m2", label: "Openings (doors and windows)", type: "number", default: 20, min: 0, max: 100000, unit: "m²", section: "Wall" },
    { key: "block_mm", label: "Block thickness", type: "select", default: "b200", section: "Wall", unit: "mm",
      options: BLOCK_THICKNESSES.map((b) => ({ key: b.key, label: `${b.mm} mm`, value: b.mm, attrs: { block_mm: String(b.mm) } })) },
    { key: "plaster_sides", label: "Faces to plaster", type: "number", default: 2, min: 0, max: 2, unit: "faces", section: "Plaster" },
    { key: "plaster_thk_mm", label: "Plaster thickness", type: "number", default: 15, min: 6, max: 40, unit: "mm", section: "Plaster" },
  ],

  rates: [
    { key: "blocks_per_m2", label: "Blocks per m² of wall (400 x 200 face)", unit: "nr/m²", value: 12.5 },
    { key: "block_waste_pct", label: "Breakage and cutting on blocks", unit: "%", value: 5 },
    { key: "mortar_share", label: "Mortar as a share of the wall volume", unit: "fraction", value: 0.09 },
    { key: "mortar_waste_pct", label: "Wastage on mortar", unit: "%", value: 10 },
    { key: "plaster_waste_pct", label: "Wastage on plaster", unit: "%", value: 10 },
    { key: "lay_h_per_m2", label: "Blocklayer and helper hours per m² of 200 mm wall", unit: "h/m²", value: 0.9, low: 0.75, high: 1.15 },
    { key: "plaster_h_per_m2", label: "Plasterer and helper hours per m² of face", unit: "h/m²", value: 0.7, low: 0.6, high: 0.95 },
    { key: "labour_rate_hr", label: "Labour rate", unit: "per h", value: 16, low: 14, high: 20 },
    { key: "overhead_factor", label: "Overhead (share of all the cost above)", unit: "fraction", value: 0.1 },
  ],

  rules: [
    rule({ code: "blk", group: G_MAS, description: "Concrete blocks", uom: "nr", qty: `${NET} * blocks_per_m2`, waste_pct: "block_waste_pct",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "block" }, from: ["block_mm"] } } }),
    rule({ code: "mor", group: G_MAS, description: "Block mortar", uom: "m3", qty: `${NET} * (block_mm / 1000) * mortar_share`, waste_pct: "mortar_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-MORTAR" } }),
    rule({ code: "bll", group: G_MAS, description: "Blockwork laying (blocklayer and helper)", uom: "h", qty: `${NET} * lay_h_per_m2 * block_mm / 200`,
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "pla", group: G_PLA, description: "Plaster", uom: "m3", qty: `${NET} * plaster_sides * plaster_thk_mm / 1000`, waste_pct: "plaster_waste_pct",
      component: "materials", cost: { kind: "product", sku: "EST-PLASTER" } }),
    rule({ code: "plb", group: G_PLA, description: "Plastering labour (plasterer and helper)", uom: "h", qty: `${NET} * plaster_sides * plaster_h_per_m2`,
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } }),
    rule({ code: "ovh", group: "Overhead", description: "Overhead", uom: "cost", qty: `${sub(G_MAS)} + ${sub(G_PLA)}`,
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

export const CIVIL_STARTERS: readonly CatalogueStarter[] = [EXCAVATION_STARTER, CONCRETE_WORKS_STARTER, BLOCKWORK_PLASTER_STARTER];
