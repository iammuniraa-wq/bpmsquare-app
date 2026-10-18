// Starter estimate templates (docs/estimator-architecture.md §0, §7, §10.2).
//
// THE PRECAST VILLA STARTER IS ILLUSTRATIVE. Nothing is known about how any
// real precast manufacturer quotes. Every rate, ratio, rule and grouping below
// is a plausible-looking placeholder whose job is to make the estimator
// demonstrable and testable; none of it is a real price, a real mix, or a
// real company's method. Tenants copy this template ("Duplicate template") and
// replace the numbers and rules with their own, as data, without a deploy.
// That is why this lives in a typed constant used by the demo seed and the
// "start from" action, and is not referenced by any other code path.
//
// The template names the `precast_villa` geometry module: the building is a
// list of real pieces, and the rule lines below price the piece totals
// (vol_<code>, n_<code>, area_<code>, vol_total, weight_total) with rates and
// formulas. The rates are the mock-up's (docs/estimator-reference), so the
// reference villa lands on the mock-up's own figures.

import type { EstimateTemplateBody, QuoteGranularity } from "./types";

export type StarterTemplate = EstimateTemplateBody & {
  name: string;
  description: string;
  trade: string;
  quote_granularity: QuoteGranularity;
};

export const PRECAST_VILLA_STARTER: StarterTemplate = {
  name: "Precast villa (illustrative)",
  description:
    "ILLUSTRATIVE starter for a precast villa with a boundary wall, built from an exact piece model (wall panels, planks, beams, columns, stairs, boundary panels). All rates, ratios and rules are placeholders to demonstrate the estimator, not any company's real prices or method. Duplicate it and replace them with your own.",
  trade: "precast",
  quote_granularity: "group",
  geometry: "precast_villa",

  inputs: [
    // ILLUSTRATIVE ranges and defaults. The first seven keys are read by the
    // precast_villa geometry module.
    { key: "floors", label: "Number of floors", type: "number", default: 2, min: 1, max: 4, unit: "floors", section: "Building" },
    { key: "built_up_area_m2", label: "Built-up area per floor", type: "number", default: 150, min: 20, max: 2000, unit: "m²", section: "Building", help: "Area of ONE floor; every floor is the same shape." },
    { key: "wall_perimeter_m", label: "External wall perimeter (one floor)", type: "number", default: 50, min: 10, max: 500, unit: "m", section: "Building", help: "With the area, this fixes the length and depth of the building." },
    { key: "wall_height_m", label: "Floor-to-floor wall height", type: "number", default: 3, min: 2.4, max: 6, unit: "m", section: "Building" },
    { key: "ext_wall_thickness_m", label: "External wall thickness", type: "number", default: 0.2, min: 0.1, max: 0.5, unit: "m", section: "Building" },
    { key: "finish_level", label: "External finish", type: "select", default: "standard", section: "Building", options: [
      // The option value is the concrete price multiplier on visible faces.
      { key: "basic", label: "Basic", value: 1 },
      { key: "standard", label: "Standard (+8% on visible faces)", value: 1.08 },
      { key: "premium", label: "Premium (+18% on visible faces)", value: 1.18 },
    ] },
    { key: "include_stairs", label: "Include precast stairs", type: "boolean", default: true, section: "Stairs" },
    { key: "stair_flights", label: "Stair flights", type: "number", default: 2, min: 0, max: 10, unit: "flights", section: "Stairs" },
    { key: "boundary_wall_length_m", label: "Boundary wall length", type: "number", default: 60, min: 0, max: 2000, unit: "m", section: "Boundary wall" },
    { key: "boundary_wall_height_m", label: "Boundary wall height", type: "number", default: 2.4, min: 1, max: 4, unit: "m", section: "Boundary wall" },
  ],

  // Every value here is an ILLUSTRATIVE placeholder (the mock-up's). `low` and
  // `high` on a rate are its risk range for the Simulation tab (Monte Carlo and
  // the tornado); a productivity range is hours per m³, so low hours = fast.
  rates: [
    // Physical constants and ratios
    { key: "concrete_density_t_m3", label: "Concrete density", unit: "t/m³", value: 2.4 },
    { key: "rebar_kg_per_m3", label: "Reinforcement per m³ of concrete", unit: "kg/m³", value: 100 },
    { key: "insulated_area_share", label: "Share of external wall face that is insulated", unit: "fraction", value: 0.9 },
    { key: "insert_spacing_m3", label: "Concrete served by one lifting insert", unit: "m³", value: 1.2 },
    { key: "wastage_pct", label: "Wastage on concrete, steel and boards", unit: "%", value: 0 },
    // Unit costs (per the unit shown)
    { key: "concrete_cost_m3", label: "Precast concrete, supplied and cast", unit: "per m³", value: 330, low: 297, high: 412.5 },
    { key: "rebar_cost_kg", label: "Reinforcement steel, cut and bent", unit: "per kg", value: 3.2, low: 2.72, high: 4.32 },
    { key: "insulation_cost_m2", label: "Insulation board", unit: "per m²", value: 38, low: 34.2, high: 43.7 },
    { key: "fixing_cost_nr", label: "Lifting insert and fixings", unit: "per nr", value: 65, low: 58.5, high: 74.75 },
    { key: "mould_cost_m3", label: "Mould usage", unit: "per m³", value: 90 },
    { key: "labour_hours_per_m3", label: "Production labour hours per m³", unit: "h/m³", value: 3.5, low: 3.18, high: 4.375 },
    { key: "labour_rate_hr", label: "Production labour rate", unit: "per h", value: 18, low: 16.2, high: 21.6 },
    { key: "transport_load_capacity_t", label: "Transport capacity per load", unit: "t/load", value: 25 },
    { key: "transport_cost_load", label: "Transport cost per load", unit: "per load", value: 1800, low: 1620, high: 2340 },
    { key: "erection_cost_m3", label: "Erection", unit: "per m³", value: 120, low: 108, high: 150 },
    { key: "overhead_factor", label: "Factory and yard overhead (share of production cost)", unit: "fraction", value: 0.12 },
    // Simulation tab (schedule). Not read by any rule; defaults apply when absent.
    { key: "cap_cast_m3_per_day", label: "Casting capacity", unit: "m³/day", value: 18 },
    { key: "cap_trucks_loads_per_day", label: "Truck loads leaving the factory", unit: "loads/day", value: 4 },
    { key: "cap_crane_m3_per_day", label: "Crane erection capacity", unit: "m³/day", value: 24 },
    { key: "transport_start_day", label: "Transport starts on day", unit: "day", value: 5 },
    { key: "erection_start_day", label: "Erection starts on day", unit: "day", value: 6 },
  ],

  rules: [
    // ── Envelope ──
    { code: "ew", group: "Envelope", description: "External wall panels (insulated)", uom: "m3",
      qty: "vol_EW", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "wall_panel" },
    { code: "pr", group: "Envelope", description: "Parapet panels", uom: "m3",
      qty: "vol_PR", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "parapet_panel" },
    // The finish premium is priced on the visible-face pieces as extra
    // concrete; "m3" here is volume-equivalent, zero (and dropped) for Basic.
    { code: "fin", group: "Envelope", description: "External finish premium (volume equivalent, visible faces)", uom: "m3",
      qty: "(vol_EW + vol_PR + vol_BW) * (finish_level - 1)",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },

    // ── Structure ──
    { code: "iw", group: "Structure", description: "Internal wall panels", uom: "m3",
      qty: "vol_IW", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },
    { code: "sl", group: "Structure", description: "Hollow-core floor and roof planks", uom: "m3",
      qty: "vol_SL", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "slab" },
    { code: "fr", group: "Structure", description: "Beams and columns", uom: "m3",
      qty: "vol_FR", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "beam" },

    // ── Stairs ──
    { code: "st", group: "Stairs", description: "Stair flights", uom: "m3",
      qty: "vol_ST", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "stair" },

    // ── Boundary wall ──
    { code: "bw", group: "Boundary wall", description: "Boundary wall panels", uom: "m3",
      qty: "vol_BW", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "boundary_panel" },

    // ── Production: across every piece ──
    { code: "rbr", group: "Production", description: "Reinforcement steel", uom: "kg",
      qty: "vol_total * rebar_kg_per_m3", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "rebar_cost_kg" } },
    { code: "mld", group: "Production", description: "Mould usage", uom: "m3",
      qty: "vol_total",
      component: "moulds", cost: { kind: "rate", rate: "mould_cost_m3" } },
    { code: "lab", group: "Production", description: "Production labour", uom: "h",
      qty: "vol_total * labour_hours_per_m3",
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },

    // ── Insulation and fixings (outside the overhead base) ──
    { code: "ins", group: "Insulation and fixings", description: "Wall insulation board", uom: "m2",
      qty: "area_EW * insulated_area_share", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "insulation_cost_m2" } },
    { code: "fix", group: "Insulation and fixings", description: "Lifting inserts and fixings", uom: "nr",
      qty: "ceil(vol_total / insert_spacing_m3)",
      component: "materials", cost: { kind: "rate", rate: "fixing_cost_nr" } },

    // ── Transport & erection ──
    { code: "trl", group: "Transport & erection", description: "Transport to site (loads by weight)", uom: "load",
      qty: "ceil(weight_total / transport_load_capacity_t)",
      component: "transport", cost: { kind: "rate", rate: "transport_cost_load" } },
    { code: "ere", group: "Transport & erection", description: "Erection", uom: "m3",
      qty: "vol_total",
      component: "erection", cost: { kind: "rate", rate: "erection_cost_m3" } },

    // ── Overhead: a share of the factory-side cost (insulation, fixings, transport and erection excluded) ──
    { code: "ovh", group: "Overhead", description: "Factory and yard overhead", uom: "cost",
      qty: "sub_envelope + sub_structure + sub_stairs + sub_boundary_wall + sub_production",
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } },
  ],
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [PRECAST_VILLA_STARTER];
