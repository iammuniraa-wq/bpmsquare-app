// Starter estimate templates (docs/estimator-architecture.md §0, §7).
//
// THE PRECAST VILLA STARTER IS ILLUSTRATIVE. Nothing is known about how any
// real precast manufacturer quotes. Every rate, ratio, rule and grouping below
// is a plausible-looking placeholder whose job is to make the estimator
// demonstrable and testable; none of it is a real price, a real mix, or a
// real company's method. Tenants copy this template ("Duplicate template") and
// replace the numbers and rules with their own, as data, without a deploy.
// That is why this lives in a typed constant used by the demo seed and the
// "start from" action, and is not referenced by any other code path.

import type { EstimateTemplateBody, QuoteGranularity } from "./types";

export type StarterTemplate = EstimateTemplateBody & {
  name: string;
  description: string;
  trade: string;
  quote_granularity: QuoteGranularity;
};

// The total precast volume of every element, written once as text and pasted
// into the production, transport and erection formulas (a formula can only
// read earlier lines, and there is no "total" variable by design).
const ALL_VOLUME = "(qty_ewp + qty_slb + qty_bem + qty_str + qty_bwp + qty_bwf)";

export const PRECAST_VILLA_STARTER: StarterTemplate = {
  name: "Precast villa (illustrative)",
  description:
    "ILLUSTRATIVE starter for a precast villa with a boundary wall. All rates, ratios and rules are placeholders to demonstrate the estimator, not any company's real prices or method. Duplicate it and replace them with your own.",
  trade: "precast",
  quote_granularity: "group",

  inputs: [
    // Building -- ILLUSTRATIVE ranges and defaults.
    { key: "floors", label: "Number of floors", type: "number", default: 2, min: 1, max: 4, unit: "floors", section: "Building" },
    { key: "built_up_area_m2", label: "Built-up area per floor", type: "number", default: 150, min: 20, max: 2000, unit: "m²", section: "Building", help: "Area of ONE floor; the estimate multiplies by the number of floors." },
    { key: "wall_perimeter_m", label: "External wall perimeter (one floor)", type: "number", default: 50, min: 10, max: 500, unit: "m", section: "Building" },
    { key: "wall_height_m", label: "Floor-to-floor wall height", type: "number", default: 3, min: 2.4, max: 6, unit: "m", section: "Building" },
    { key: "ext_wall_thickness_m", label: "External wall thickness", type: "number", default: 0.2, min: 0.1, max: 0.5, unit: "m", section: "Building" },
    { key: "slab_thickness_m", label: "Slab thickness", type: "number", default: 0.2, min: 0.1, max: 0.5, unit: "m", section: "Building" },
    { key: "finish_level", label: "External finish", type: "select", default: "standard", section: "Building", options: [
      { key: "basic", label: "Basic", value: 1 },
      { key: "standard", label: "Standard", value: 2 },
      { key: "premium", label: "Premium", value: 3 },
    ] },
    // Stairs
    { key: "include_stairs", label: "Include precast stairs", type: "boolean", default: true, section: "Stairs" },
    { key: "stair_flights", label: "Stair flights", type: "number", default: 2, min: 0, max: 10, unit: "flights", section: "Stairs" },
    // Boundary wall
    { key: "boundary_wall_length_m", label: "Boundary wall length", type: "number", default: 60, min: 0, max: 2000, unit: "m", section: "Boundary wall" },
    { key: "boundary_wall_height_m", label: "Boundary wall height", type: "number", default: 2.4, min: 0, max: 6, unit: "m", section: "Boundary wall" },
  ],

  // Every value here is an ILLUSTRATIVE placeholder.
  rates: [
    // Physical constants and ratios
    { key: "concrete_density_t_m3", label: "Concrete density", unit: "t/m³", value: 2.4 },
    { key: "rebar_kg_per_m3", label: "Reinforcement per m³ of concrete", unit: "kg/m³", value: 100 },
    { key: "formwork_m2_per_m3", label: "Formwork contact area per m³ of concrete", unit: "m²/m³", value: 19 },
    { key: "opening_deduction_pct", label: "Openings deducted from walls", unit: "%", value: 12 },
    { key: "slab_void_pct", label: "Hollow-core void share of a slab", unit: "%", value: 30 },
    { key: "beam_section_m2", label: "Beam cross-section", unit: "m²", value: 0.135 },
    { key: "panel_width_m", label: "Standard wall panel width", unit: "m", value: 2.4 },
    { key: "wastage_pct", label: "Wastage on concrete, steel and boards", unit: "%", value: 3 },
    { key: "stair_flight_volume_m3", label: "Concrete in one stair flight", unit: "m³", value: 0.9 },
    { key: "lifting_inserts_per_panel", label: "Lifting inserts per panel", unit: "nr", value: 4 },
    { key: "boundary_wall_thickness_m", label: "Boundary wall panel thickness", unit: "m", value: 0.1 },
    { key: "boundary_footing_section_m2", label: "Boundary footing cross-section", unit: "m²", value: 0.12 },
    // Unit costs (per the unit shown)
    { key: "concrete_cost_m3", label: "Precast concrete, supplied and cast", unit: "per m³", value: 320 },
    { key: "rebar_cost_kg", label: "Reinforcement steel, cut and bent", unit: "per kg", value: 3.2 },
    { key: "insulation_cost_m2", label: "Insulation board", unit: "per m²", value: 28 },
    { key: "joint_cost_m", label: "Joint sealant and grout", unit: "per m", value: 12 },
    { key: "finish_basic_m2", label: "External finish, basic", unit: "per m²", value: 18 },
    { key: "finish_standard_m2", label: "External finish, standard", unit: "per m²", value: 35 },
    { key: "finish_premium_m2", label: "External finish, premium", unit: "per m²", value: 65 },
    { key: "fixing_cost_nr", label: "Lifting insert and fixings", unit: "per nr", value: 25 },
    { key: "mould_cost_m3", label: "Mould usage", unit: "per m³", value: 55 },
    { key: "formwork_consumable_m2", label: "Formwork consumables", unit: "per m²", value: 4 },
    { key: "labour_hours_per_m3", label: "Production labour hours per m³", unit: "h/m³", value: 4.5 },
    { key: "labour_rate_hr", label: "Production labour rate", unit: "per h", value: 22 },
    { key: "transport_load_capacity_t", label: "Transport capacity per load", unit: "t/load", value: 22 },
    { key: "transport_cost_load", label: "Transport cost per load", unit: "per load", value: 1800 },
    { key: "crane_mobilisation", label: "Crane mobilisation", unit: "per nr", value: 4500 },
    { key: "erection_cost_m3", label: "Erection", unit: "per m³", value: 140 },
    { key: "overhead_factor", label: "Factory and yard overhead (share of production cost)", unit: "fraction", value: 0.12 },
  ],

  rules: [
    // ── Structure ──
    { code: "ewp", group: "Structure", description: "External wall panels (solid precast)", uom: "m3",
      qty: "wall_perimeter_m * wall_height_m * floors * ext_wall_thickness_m * (1 - opening_deduction_pct / 100)",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "wall_panel" },
    { code: "slb", group: "Structure", description: "Floor and roof slabs (hollow-core)", uom: "m3",
      qty: "built_up_area_m2 * floors * slab_thickness_m * (1 - slab_void_pct / 100)",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "slab" },
    { code: "bem", group: "Structure", description: "Beams and lintels", uom: "m3",
      qty: "wall_perimeter_m * floors * beam_section_m2",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "beam" },

    // ── Envelope ──
    { code: "ins", group: "Envelope", description: "Wall insulation board", uom: "m2",
      qty: "wall_perimeter_m * wall_height_m * floors * (1 - opening_deduction_pct / 100)",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "insulation_cost_m2" } },
    { code: "jnt", group: "Envelope", description: "Panel joints (sealant and grout)", uom: "m",
      qty: "ceil(wall_perimeter_m / panel_width_m) * wall_height_m * floors + wall_perimeter_m * floors",
      component: "materials", cost: { kind: "rate", rate: "joint_cost_m" } },
    // One finish line per level; the unchosen two come out at zero and are dropped.
    { code: "fnb", group: "Envelope", description: "External finish, basic", uom: "m2",
      qty: "wall_perimeter_m * wall_height_m * floors * (finish_level == 1)",
      component: "materials", cost: { kind: "rate", rate: "finish_basic_m2" } },
    { code: "fns", group: "Envelope", description: "External finish, standard", uom: "m2",
      qty: "wall_perimeter_m * wall_height_m * floors * (finish_level == 2)",
      component: "materials", cost: { kind: "rate", rate: "finish_standard_m2" } },
    { code: "fnp", group: "Envelope", description: "External finish, premium", uom: "m2",
      qty: "wall_perimeter_m * wall_height_m * floors * (finish_level == 3)",
      component: "materials", cost: { kind: "rate", rate: "finish_premium_m2" } },

    // ── Stairs & ancillary ──
    { code: "str", group: "Stairs & ancillary", description: "Precast stair flights", uom: "m3",
      qty: "include_stairs * stair_flights * stair_flight_volume_m3",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "stair" },
    { code: "fix", group: "Stairs & ancillary", description: "Lifting inserts and fixings", uom: "nr",
      qty: "ceil(wall_perimeter_m / panel_width_m) * floors * lifting_inserts_per_panel",
      component: "materials", cost: { kind: "rate", rate: "fixing_cost_nr" } },

    // ── Boundary wall ──
    { code: "bwp", group: "Boundary wall", description: "Boundary wall panels", uom: "m3",
      qty: "boundary_wall_length_m * boundary_wall_height_m * boundary_wall_thickness_m",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "boundary_panel" },
    { code: "bwf", group: "Boundary wall", description: "Boundary wall footings", uom: "m3",
      qty: "boundary_wall_length_m * boundary_footing_section_m2",
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },

    // ── Production (across every element above) ──
    { code: "rbr", group: "Production", description: "Reinforcement steel", uom: "kg",
      qty: `${ALL_VOLUME} * rebar_kg_per_m3`,
      waste_pct: "wastage_pct", component: "materials", cost: { kind: "rate", rate: "rebar_cost_kg" } },
    { code: "frm", group: "Production", description: "Formwork consumables (contact area)", uom: "m2",
      qty: `${ALL_VOLUME} * formwork_m2_per_m3`,
      component: "moulds", cost: { kind: "rate", rate: "formwork_consumable_m2" } },
    { code: "mld", group: "Production", description: "Mould usage", uom: "m3",
      qty: ALL_VOLUME,
      component: "moulds", cost: { kind: "rate", rate: "mould_cost_m3" } },
    { code: "lab", group: "Production", description: "Production labour", uom: "h",
      qty: `${ALL_VOLUME} * labour_hours_per_m3`,
      component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },

    // ── Transport & erection ──
    { code: "trl", group: "Transport & erection", description: "Transport to site (loads by weight)", uom: "load",
      qty: `ceil(${ALL_VOLUME} * concrete_density_t_m3 / transport_load_capacity_t)`,
      component: "transport", cost: { kind: "rate", rate: "transport_cost_load" } },
    { code: "crn", group: "Transport & erection", description: "Crane mobilisation", uom: "nr",
      qty: `if(${ALL_VOLUME} > 0, 1, 0)`,
      component: "erection", cost: { kind: "rate", rate: "crane_mobilisation" } },
    { code: "ere", group: "Transport & erection", description: "Erection", uom: "m3",
      qty: ALL_VOLUME,
      component: "erection", cost: { kind: "rate", rate: "erection_cost_m3" } },

    // ── Overhead: a share of the factory-side cost (transport and erection excluded) ──
    { code: "ovh", group: "Overhead", description: "Factory and yard overhead", uom: "cost",
      qty: "sub_structure + sub_envelope + sub_stairs_ancillary + sub_boundary_wall + sub_production",
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } },
  ],
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [PRECAST_VILLA_STARTER];
