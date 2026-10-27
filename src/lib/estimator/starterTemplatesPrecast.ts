// Starter template: precast elements (docs/design/gcc-tender-deals.md, "Slice 3c-2 as built").
//
// THE RATES, RATIOS AND CATALOGUE COSTS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no particular currency. They are not any
// manufacturer's prices or method. Concrete, hollow-core planks and reinforcement are CATALOGUE items (priced from the
// workspace's products, flagged illustrative until a rate sheet is imported); moulds, casting labour, haulage and the
// erection crane and crew are template rates, which a workspace changes by "Copy to customise".
//
// Unlike the precast villa this has no 3D layout: it prices a LIST of elements, which is how a precast job is usually enquired
// (a boundary wall of so many panels, floors in slabs or hollow-core planks, columns and beams). Each element family takes a
// count and its dimensions from the form, or its quantity from an uploaded element schedule (the same schedule import the
// villa uses: a rule with an `element_type` takes its quantity from the schedule rows of that type). Everything downstream
// (reinforcement, moulds, casting labour, weight, transport, crane days) reads the concrete lines' quantities, so a schedule
// reaches every cost line.
//
// 03 41 00 is Precast Structural Concrete (MasterFormat); the boundary wall panels are left without a code.

import { groupSlug } from "./types";
import type { StarterCatalogueItem } from "./starterCatalogue";
import type { CatalogueStarter } from "./starterTemplatesTiles";
import type { TemplateRule } from "./types";

const G_WALL = "Boundary wall panels";
const G_STR = "03 41 00 Precast structural concrete";
const G_PROD = "Reinforcement, moulds and casting";
const G_DEL = "Transport and erection";
const sub = (group: string) => `sub_${groupSlug(group)}`;

export const CONCRETE_GRADES = [
  { key: "c30", label: "C30", value: 30, cost: 300 },
  { key: "c40", label: "C40", value: 40, cost: 330 },
  { key: "c50", label: "C50", value: 50, cost: 365 },
] as const;

export const HOLLOW_CORE_DEPTHS = [
  { key: "hc200", mm: 200, cost: 145 },
  { key: "hc265", mm: 265, cost: 175 },
  { key: "hc320", mm: 320, cost: 205 },
] as const;

export const PRECAST_CATALOGUE: readonly StarterCatalogueItem[] = [
  ...CONCRETE_GRADES.map((g): StarterCatalogueItem => ({
    sku: `EST-PC-CONC-${g.label}`, name: `Precast concrete ${g.label}, supplied`, uom: "m3", cost: g.cost,
    attrs: { est_kind: "precast_concrete", concrete_grade: g.key }, family: "precast",
  })),
  ...HOLLOW_CORE_DEPTHS.map((d): StarterCatalogueItem => ({
    sku: `EST-HCS-${d.mm}`, name: `Hollow-core plank ${d.mm} mm, supplied`, uom: "m2", cost: d.cost,
    attrs: { est_kind: "hollow_core", hc_depth_mm: String(d.mm) }, family: "precast",
  })),
  { sku: "EST-REBAR", name: "Reinforcement steel, cut and bent", uom: "kg", cost: 3.2, attrs: { est_kind: "rebar" }, family: "precast" },
];

/** The concrete poured or cast in the yard, in m³ (the four cast families; hollow-core is bought in by the m²). */
const CAST = "(qty_conc_wall + qty_conc_slab + qty_conc_col + qty_conc_beam)";
/** Tonnes to move: cast concrete at its density, plus the hollow-core planks by area. */
const WEIGHT = `(${CAST} * concrete_density_t_m3 + qty_hc * hc_t_per_m2)`;
const concrete = { kind: "product" as const, match: { attrs: { est_kind: "precast_concrete" }, from: ["concrete_grade"] } };

const rule = (r: TemplateRule): TemplateRule => r;

export const PRECAST_ELEMENTS_STARTER: CatalogueStarter = {
  name: "Precast elements (illustrative)",
  description:
    "ILLUSTRATIVE starter for precast elements: boundary wall panels, slabs, hollow-core planks, columns and beams, from a count and sizes or from an element schedule. Concrete, planks and reinforcement come from catalogue items marked illustrative until you import a rate sheet; moulds, casting labour, transport and the erection crane and crew are placeholder rates. Copy it and replace them with your own.",
  trade: "precast",
  icon: "building",
  keywords: [
    "precast", "pre-cast", "boundary wall", "wall panel", "panels", "slab", "slabs", "hollow core", "hollow-core", "plank", "column", "columns",
    "beam", "beams", "element schedule", "elements", "crane", "erection", "casting", "mould", "prefab",
  ],
  quote_granularity: "group",
  catalogue: PRECAST_CATALOGUE,

  inputs: [
    { key: "wall_n", label: "Panels", type: "number", default: 100, min: 0, max: 10000, unit: "nr", section: "Boundary wall panels" },
    { key: "wall_len_m", label: "Panel length", type: "number", default: 2.5, min: 0.5, max: 12, unit: "m", section: "Boundary wall panels" },
    { key: "wall_h_m", label: "Panel height", type: "number", default: 2.4, min: 0.5, max: 6, unit: "m", section: "Boundary wall panels" },
    { key: "wall_t_m", label: "Panel thickness", type: "number", default: 0.1, min: 0.05, max: 0.5, unit: "m", section: "Boundary wall panels" },

    { key: "slab_n", label: "Slabs", type: "number", default: 20, min: 0, max: 10000, unit: "nr", section: "Solid slabs" },
    { key: "slab_len_m", label: "Slab length", type: "number", default: 6, min: 0.5, max: 20, unit: "m", section: "Solid slabs" },
    { key: "slab_w_m", label: "Slab width", type: "number", default: 2.4, min: 0.5, max: 4, unit: "m", section: "Solid slabs" },
    { key: "slab_t_m", label: "Slab thickness", type: "number", default: 0.2, min: 0.05, max: 0.6, unit: "m", section: "Solid slabs" },

    { key: "hc_n", label: "Planks", type: "number", default: 40, min: 0, max: 20000, unit: "nr", section: "Hollow-core planks" },
    { key: "hc_len_m", label: "Plank length", type: "number", default: 6, min: 1, max: 20, unit: "m", section: "Hollow-core planks" },
    { key: "hc_w_m", label: "Plank width", type: "number", default: 1.2, min: 0.4, max: 2.4, unit: "m", section: "Hollow-core planks" },
    { key: "hc_depth", label: "Plank depth", type: "select", default: "hc200", section: "Hollow-core planks", unit: "mm",
      options: HOLLOW_CORE_DEPTHS.map((d) => ({ key: d.key, label: `${d.mm} mm`, value: d.mm, attrs: { hc_depth_mm: String(d.mm) } })) },

    { key: "col_n", label: "Columns", type: "number", default: 12, min: 0, max: 5000, unit: "nr", section: "Columns" },
    { key: "col_h_m", label: "Column height", type: "number", default: 4, min: 0.5, max: 20, unit: "m", section: "Columns" },
    { key: "col_b_m", label: "Column width", type: "number", default: 0.4, min: 0.1, max: 2, unit: "m", section: "Columns" },
    { key: "col_d_m", label: "Column depth", type: "number", default: 0.4, min: 0.1, max: 2, unit: "m", section: "Columns" },

    { key: "beam_n", label: "Beams", type: "number", default: 16, min: 0, max: 5000, unit: "nr", section: "Beams" },
    { key: "beam_len_m", label: "Beam length", type: "number", default: 6, min: 0.5, max: 30, unit: "m", section: "Beams" },
    { key: "beam_b_m", label: "Beam width", type: "number", default: 0.3, min: 0.1, max: 2, unit: "m", section: "Beams" },
    { key: "beam_h_m", label: "Beam depth", type: "number", default: 0.5, min: 0.1, max: 3, unit: "m", section: "Beams" },

    { key: "concrete_grade", label: "Concrete grade", type: "select", default: "c40", section: "Concrete and delivery",
      options: CONCRETE_GRADES.map((g) => ({ key: g.key, label: g.label, value: g.value, attrs: { concrete_grade: g.key } })) },
    { key: "haul_km", label: "Distance to site", type: "number", default: 60, min: 0, max: 3000, unit: "km", section: "Concrete and delivery" },
  ],

  rates: [
    // Physical constants and ratios (ILLUSTRATIVE)
    { key: "concrete_density_t_m3", label: "Concrete density", unit: "t/m³", value: 2.4 },
    { key: "hc_t_per_m2", label: "Weight of a hollow-core plank per m²", unit: "t/m²", value: 0.3 },
    { key: "concrete_waste_pct", label: "Wastage on concrete", unit: "%", value: 2 },
    { key: "rebar_kg_m3_wall", label: "Reinforcement in wall panels", unit: "kg/m³", value: 60 },
    { key: "rebar_kg_m3_slab", label: "Reinforcement in slabs", unit: "kg/m³", value: 110 },
    { key: "rebar_kg_m3_col", label: "Reinforcement in columns", unit: "kg/m³", value: 220 },
    { key: "rebar_kg_m3_beam", label: "Reinforcement in beams", unit: "kg/m³", value: 190 },
    // Production, haulage and erection costs (ILLUSTRATIVE)
    { key: "mould_cost_m3", label: "Mould usage", unit: "per m³", value: 90, low: 80, high: 115 },
    { key: "casting_h_per_m3", label: "Casting and finishing hours per m³", unit: "h/m³", value: 3.5, low: 3.1, high: 4.4 },
    { key: "casting_rate_hr", label: "Casting labour rate", unit: "per h", value: 18, low: 16, high: 22 },
    { key: "transport_load_capacity_t", label: "Transport capacity per load", unit: "t/load", value: 25 },
    { key: "transport_cost_load_km", label: "Transport cost per load and km", unit: "per load-km", value: 4.5, low: 4, high: 6 },
    { key: "handling_cost_load", label: "Loading and unloading per load", unit: "per load", value: 120 },
    { key: "erect_t_per_day", label: "Erection output of crane and crew", unit: "t/day", value: 60 },
    { key: "crane_cost_day", label: "Mobile crane with operator", unit: "per day", value: 2600, low: 2300, high: 3200 },
    { key: "erection_crew_cost_day", label: "Erection crew (four people)", unit: "per day", value: 1400, low: 1250, high: 1700 },
    { key: "overhead_factor", label: "Factory and yard overhead (share of production cost)", unit: "fraction", value: 0.12 },
  ],

  rules: [
    // ── Boundary wall panels ──
    rule({ code: "conc_wall", group: G_WALL, description: "Boundary wall panels: concrete", uom: "m3", qty: "wall_n * wall_len_m * wall_h_m * wall_t_m",
      waste_pct: "concrete_waste_pct", component: "materials", cost: concrete, element_type: "boundary_wall_panel" }),

    // ── 03 41 00 Precast structural concrete ──
    rule({ code: "conc_slab", group: G_STR, description: "Solid slabs: concrete", uom: "m3", qty: "slab_n * slab_len_m * slab_w_m * slab_t_m",
      waste_pct: "concrete_waste_pct", component: "materials", cost: concrete, element_type: "slab" }),
    rule({ code: "hc", group: G_STR, description: "Hollow-core planks, supplied", uom: "m2", qty: "hc_n * hc_len_m * hc_w_m",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "hollow_core" }, from: ["hc_depth"] } }, element_type: "hollow_core" }),
    rule({ code: "conc_col", group: G_STR, description: "Columns: concrete", uom: "m3", qty: "col_n * col_h_m * col_b_m * col_d_m",
      waste_pct: "concrete_waste_pct", component: "materials", cost: concrete, element_type: "column" }),
    rule({ code: "conc_beam", group: G_STR, description: "Beams: concrete", uom: "m3", qty: "beam_n * beam_len_m * beam_b_m * beam_h_m",
      waste_pct: "concrete_waste_pct", component: "materials", cost: concrete, element_type: "beam" }),

    // ── Reinforcement, moulds and casting (across the cast families) ──
    rule({ code: "rbr", group: G_PROD, description: "Reinforcement steel (cut and bent)", uom: "kg",
      qty: "qty_conc_wall * rebar_kg_m3_wall + qty_conc_slab * rebar_kg_m3_slab + qty_conc_col * rebar_kg_m3_col + qty_conc_beam * rebar_kg_m3_beam",
      waste_pct: 5, component: "materials", cost: { kind: "product", sku: "EST-REBAR" } }),
    rule({ code: "mld", group: G_PROD, description: "Moulds and formwork", uom: "m3", qty: CAST,
      component: "moulds", cost: { kind: "rate", rate: "mould_cost_m3" } }),
    rule({ code: "lab", group: G_PROD, description: "Casting labour", uom: "h", qty: `${CAST} * casting_h_per_m3`,
      component: "labour", cost: { kind: "rate", rate: "casting_rate_hr" } }),

    // ── Transport and erection ──
    rule({ code: "hlg", group: G_DEL, description: "Transport to site (loads by weight, by distance)", uom: "load-km",
      qty: `ceil(${WEIGHT} / transport_load_capacity_t) * haul_km`, component: "transport", cost: { kind: "rate", rate: "transport_cost_load_km" } }),
    rule({ code: "hdl", group: G_DEL, description: "Loading and unloading", uom: "load",
      qty: `ceil(${WEIGHT} / transport_load_capacity_t)`, component: "transport", cost: { kind: "rate", rate: "handling_cost_load" } }),
    rule({ code: "crn", group: G_DEL, description: "Erection crane (days by weight)", uom: "day",
      qty: `ceil(${WEIGHT} / erect_t_per_day)`, component: "erection", cost: { kind: "rate", rate: "crane_cost_day" } }),
    rule({ code: "crw", group: G_DEL, description: "Erection crew (same days as the crane)", uom: "day",
      qty: "qty_crn", component: "erection", cost: { kind: "rate", rate: "erection_crew_cost_day" } }),

    // ── Overhead: a share of the factory-side cost (transport and erection excluded) ──
    rule({ code: "ovh", group: "Overhead", description: "Factory and yard overhead", uom: "cost",
      qty: `${sub(G_WALL)} + ${sub(G_STR)} + ${sub(G_PROD)}`, component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

export const PRECAST_ELEMENTS_STARTERS: readonly CatalogueStarter[] = [PRECAST_ELEMENTS_STARTER];
