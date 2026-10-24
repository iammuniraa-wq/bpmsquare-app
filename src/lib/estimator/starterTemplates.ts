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

import { TILES_STARTERS } from "./starterTemplatesTiles";
import { CABIN_STARTERS } from "./starterTemplatesCabin";
import { groupSlug } from "./types";
import type { EstimateTemplateBody, QuoteGranularity } from "./types";

// Group names are what the customer reads on the quote (one line per group), so
// they are plain words. Rules refer to a group's subtotal as sub_<slug>.
const G_STRUCTURE = "Structure (floors, beams, inner walls)";
const G_EXTERNAL = "External walls and parapet";
const G_STAIRS = "Stairs";
const G_BOUNDARY = "Boundary wall";
const G_DELIVERY = "Delivery and erection";
const sub = (group: string) => `sub_${groupSlug(group)}`;

export type StarterTemplate = EstimateTemplateBody & {
  name: string;
  description: string;
  trade: string;
  quote_granularity: QuoteGranularity;
  /** Words an email might use for this job; the AI template pick reads them (never prices). */
  keywords?: string[];
  /** Icon key for the template card (components/estimator/TemplateIcon). */
  icon?: string;
  /** Installed read-only: a workspace changes it by "Copy to customise". */
  locked?: boolean;
  customer_visible?: boolean;
};

/** Design attribute options for a precast surface: the number is never read by a formula; `visual` is what the 3D model shows. */
const PRECAST_SURFACE_OPTIONS = [
  { key: "grey", label: "Precast grey", value: 1, visual: "concrete_precast" },
  { key: "smooth", label: "Smooth concrete", value: 2, visual: "concrete_smooth" },
  { key: "sand", label: "Sand", value: 3, visual: "#d9ccb4" },
  { key: "white", label: "White", value: 4, visual: "#ecebe7" },
] as const;

export const PRECAST_VILLA_STARTER: StarterTemplate = {
  name: "Precast villa (illustrative)",
  description:
    "ILLUSTRATIVE starter for a precast villa with a boundary wall, built from an exact piece model (wall panels, planks, beams, columns, stairs, boundary panels). All rates, ratios and rules are placeholders to demonstrate the estimator, not any company's real prices or method. Duplicate it and replace them with your own.",
  trade: "precast",
  quote_granularity: "group",
  geometry: "precast_villa",
  keywords: ["precast", "villa", "house", "building", "prefab", "wall panels", "hollow core", "boundary wall", "residential", "floors"],
  icon: "building",

  inputs: [
    // ILLUSTRATIVE ranges and defaults. The first seven keys are read by the
    // precast_villa geometry module.
    { key: "floors", label: "Number of floors", type: "number", default: 2, min: 1, max: 4, unit: "floors", section: "Building" },
    { key: "built_up_area_m2", label: "Built-up area per floor", type: "number", default: 150, min: 20, max: 2000, unit: "m²", section: "Building", help: "Area of ONE floor; every floor is the same shape." },
    { key: "wall_perimeter_m", label: "External wall perimeter (one floor)", type: "number", default: 50, min: 10, max: 500, unit: "m", section: "Building", help: "With the area, this fixes the length and depth of the building." },
    { key: "wall_height_m", label: "Floor-to-floor wall height", type: "number", default: 3, min: 2.4, max: 6, unit: "m", section: "Building" },
    { key: "ext_wall_thickness_m", label: "External wall thickness", type: "number", default: 0.2, min: 0.1, max: 0.5, unit: "m", section: "Building" },
    { key: "finish_level", label: "External finish", type: "select", default: "standard", section: "Building",
      help: "Standard adds 8% and Premium 18% to the concrete price of the faces that show.",
      quote_alternatives: true, options: [
      // The option value is the concrete price multiplier on visible faces.
      { key: "basic", label: "Basic", value: 1 },
      { key: "standard", label: "Standard", value: 1.08 },
      { key: "premium", label: "Premium", value: 1.18 },
    ] },
    { key: "include_stairs", label: "Include precast stairs", type: "boolean", default: true, section: "Stairs" },
    { key: "stair_flights", label: "Stair flights", type: "number", default: 2, min: 0, max: 10, unit: "flights", section: "Stairs" },
    { key: "boundary_wall_length_m", label: "Boundary wall length", type: "number", default: 60, min: 0, max: 2000, unit: "m", section: "Boundary wall" },
    { key: "boundary_wall_height_m", label: "Boundary wall height", type: "number", default: 2.4, min: 1, max: 4, unit: "m", section: "Boundary wall" },
    // Design attributes: they repaint the 3D model only. No rule or formula reads these keys, so the bill of
    // materials and the price do not change with the choice.
    { key: "wall_colour", label: "Wall colour", type: "select", default: "grey", section: "Appearance", paints: "wall", options: PRECAST_SURFACE_OPTIONS.map((o) => ({ ...o })) },
    { key: "slab_colour", label: "Roof and slab colour", type: "select", default: "grey", section: "Appearance", paints: "slab", options: PRECAST_SURFACE_OPTIONS.map((o) => ({ ...o })) },
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
    // ── Structure (floors, beams, inner walls) ──
    { code: "iw", group: G_STRUCTURE, description: "Internal wall panels", uom: "m3",
      qty: "vol_IW", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },
    { code: "sl", group: G_STRUCTURE, description: "Hollow-core floor and roof planks", uom: "m3",
      qty: "vol_SL", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "slab" },
    { code: "fr", group: G_STRUCTURE, description: "Beams and columns", uom: "m3",
      qty: "vol_FR", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "beam" },

    // ── External walls and parapet ──
    { code: "ew", group: G_EXTERNAL, description: "External wall panels (insulated)", uom: "m3",
      qty: "vol_EW", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "wall_panel" },
    { code: "pr", group: G_EXTERNAL, description: "Parapet panels", uom: "m3",
      qty: "vol_PR", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "parapet_panel" },
    // The finish premium is priced on the visible-face pieces as extra
    // concrete; "m3" here is volume-equivalent, zero (and dropped) for Basic.
    { code: "fin", group: G_EXTERNAL, description: "External finish premium (extra concrete cost on the faces that show)", uom: "m3",
      qty: "(vol_EW + vol_PR + vol_BW) * (finish_level - 1)",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },

    // ── Stairs ──
    { code: "st", group: G_STAIRS, description: "Stair flights", uom: "m3",
      qty: "vol_ST", waste_pct: "wastage_pct",
      component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" }, element_type: "stair" },

    // ── Boundary wall ──
    { code: "bw", group: G_BOUNDARY, description: "Boundary wall panels", uom: "m3",
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

    // ── Delivery and erection ──
    { code: "trl", group: G_DELIVERY, description: "Transport to site (loads by weight)", uom: "load",
      qty: "ceil(weight_total / transport_load_capacity_t)",
      component: "transport", cost: { kind: "rate", rate: "transport_cost_load" } },
    { code: "ere", group: G_DELIVERY, description: "Erection", uom: "m3",
      qty: "vol_total",
      component: "erection", cost: { kind: "rate", rate: "erection_cost_m3" } },

    // ── Overhead: a share of the factory-side cost (insulation, fixings, transport and erection excluded) ──
    { code: "ovh", group: "Overhead", description: "Factory and yard overhead", uom: "cost",
      qty: `${sub(G_STRUCTURE)} + ${sub(G_EXTERNAL)} + ${sub(G_STAIRS)} + ${sub(G_BOUNDARY)} + sub_production`,
      component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } },
  ],
};

// ── Chain-link fence ─────────────────────────────────────────────────────────
//
// The Fence configurator (src/lib/fence, 0122) expressed as a template. The
// `chainlink_fence` layout module returns the post and fabric COUNTS (n_LP, n_SP,
// n_CP, n_TP, n_GP, area_FB); the hardware rules below replicate src/lib/fence/bom.ts
// line for line, and every line is priced from the workspace's own catalogue by the
// tags on its products (`custom_data.fence_kind` and the pipe class, mesh and coating
// the customer chose), exactly how materialMatch.ts picked them. fence.parity.test.ts
// holds the two to the same numbers. There are no rates: a fence is priced from products.
//
// Unlike the precast villa this is a REAL method (the configurator's), not an
// illustration; what is workspace-specific is the product catalogue and the choices
// below (pipe classes, meshes, coatings), which a workspace changes by copying the
// template ("Copy to customise") and editing the copy.

const G_FENCE_POSTS = "Posts";
const G_FENCE_FABRIC = "Chain-link fabric";
const G_FENCE_FITTINGS = "Fittings and hardware";
const G_FENCE_WIRE = "Wire";

/** The pipe class each security profile uses, with the post spacing it needs (the option's number). */
export const FENCE_PROFILE_OPTIONS = [
  { key: "general", label: "General yard and storage", value: 3, attrs: { pipe_class: "Schedule 40" } },
  { key: "vehicle", label: "Vehicle and equipment compound", value: 2.5, attrs: { pipe_class: "SS20" } },
  { key: "bonded", label: "Bonded or high-value storage", value: 2, attrs: { pipe_class: "SS40" } },
] as const;

export const FENCE_MESH_OPTIONS = [
  { key: "standard", label: "Standard 50x50, 2.5 mm", value: 1, attrs: { mesh_spec: "Chain-link 50x50 . 2.5mm" } },
  { key: "high_security", label: "High security 25x25, 3.0 mm", value: 2, attrs: { mesh_spec: "Chain-link 25x25 . 3.0mm (high security)" } },
  { key: "mini_mesh", label: "Mini-mesh 16x16, 4.9 mm", value: 3, attrs: { mesh_spec: "Chain-link 16x16 . 4.9mm (mini-mesh)" } },
] as const;

export const FENCE_COATING_OPTIONS = [
  { key: "pvc", label: "PVC coated", value: 1, attrs: { coating: "PVC coated" } },
] as const;

/** Design attribute options: the number is never read by a formula; `visual` is what the 3D model shows. */
const FENCE_COLOUR_OPTIONS = [
  { key: "galvanised", label: "Galvanised", value: 1, visual: "galvanised" },
  { key: "green", label: "Green PVC", value: 2, visual: "pvc_green" },
  { key: "black", label: "Black PVC", value: 3, visual: "pvc_black" },
  { key: "blue", label: "Blue PVC", value: 4, visual: "pvc_blue" },
] as const;

const fenceProduct = (fence_kind: string, from: string[]) => ({ kind: "product" as const, match: { attrs: { fence_kind }, from } });
const POST_FROM = ["post_spacing_m", "coating"];
const HARDWARE_FROM = ["coating"];
/** Posts that take bands, rail ends and bolts (everything but line posts), as bom.ts counts them. */
const TERMINAL_TYPE = "(n_CP + n_TP + n_SP + n_GP)";

export const CHAINLINK_FENCE_STARTER: StarterTemplate = {
  name: "Chain-link fence",
  description: "Perimeter or straight-run chain-link fence: posts, fabric, gates and fittings, priced from your catalogue.",
  trade: "fencing",
  quote_granularity: "line",
  geometry: "chainlink_fence",
  keywords: ["fence", "fencing", "chain link", "chainlink", "perimeter", "boundary", "compound", "yard", "gate", "posts", "mesh", "security fence", "barbed wire"],
  icon: "fence",
  locked: true,

  inputs: [
    { key: "total_length_m", label: "Fence length", type: "number", default: 500, min: 1, max: 5000, unit: "m", section: "The fence",
      help: "The whole length of fence, gates included." },
    { key: "closed_perimeter", label: "Goes all the way round", type: "boolean", default: true, section: "The fence",
      help: "Yes for a closed boundary (four corners). No for a single straight run (two end posts)." },
    { key: "post_spacing_m", label: "What is being protected", type: "select", default: "general", section: "The fence",
      help: "Sets how far apart the posts are and which pipe class they use.",
      options: FENCE_PROFILE_OPTIONS.map((o) => ({ ...o, attrs: { ...o.attrs } })) },
    { key: "fabric_height_m", label: "Fence height", type: "number", default: 2, min: 1, max: 6, unit: "m", section: "The fence" },
    { key: "mesh", label: "Mesh", type: "select", default: "standard", section: "The fence",
      options: FENCE_MESH_OPTIONS.map((o) => ({ ...o, attrs: { ...o.attrs } })) },
    { key: "coating", label: "Coating", type: "select", default: "pvc", section: "The fence",
      options: FENCE_COATING_OPTIONS.map((o) => ({ ...o, attrs: { ...o.attrs } })) },
    { key: "straining_spacing_m", label: "Distance between straining posts", type: "number", default: 100, min: 10, max: 500, unit: "m", section: "The fence" },

    { key: "gates_single_n", label: "Single gates", type: "number", default: 0, min: 0, max: 20, unit: "gates", section: "Gates" },
    { key: "gates_single_w", label: "Single gate width", type: "number", default: 1.2, min: 0.6, max: 3, unit: "m", section: "Gates" },
    { key: "gates_double_n", label: "Double gates", type: "number", default: 2, min: 0, max: 20, unit: "gates", section: "Gates" },
    { key: "gates_double_w", label: "Double gate width", type: "number", default: 5, min: 2, max: 12, unit: "m", section: "Gates" },
    { key: "gates_sliding_n", label: "Sliding gates", type: "number", default: 0, min: 0, max: 20, unit: "gates", section: "Gates" },
    { key: "gates_sliding_w", label: "Sliding gate width", type: "number", default: 6, min: 2, max: 20, unit: "m", section: "Gates" },

    { key: "truss_rods", label: "Truss rods at corners and straining posts", type: "boolean", default: true, section: "Fittings" },
    { key: "tension_wire", label: "Tension wire (3 rows)", type: "boolean", default: true, section: "Fittings" },
    { key: "tie_wire", label: "Tie wire", type: "boolean", default: true, section: "Fittings" },
    { key: "barbed_wire", label: "Barbed wire on top (3 strands)", type: "boolean", default: false, section: "Fittings" },

    // Design attributes: they repaint the 3D model only. No rule or formula reads these keys, so the bill of
    // materials and the price do not change with the choice.
    { key: "mesh_colour", label: "Mesh colour", type: "select", default: "green", section: "Appearance", paints: "mesh", options: FENCE_COLOUR_OPTIONS.map((o) => ({ ...o })) },
    { key: "post_colour", label: "Post colour", type: "select", default: "green", section: "Appearance", paints: "posts", options: FENCE_COLOUR_OPTIONS.map((o) => ({ ...o })) },
  ],

  rates: [],

  rules: [
    { code: "line_posts", group: G_FENCE_POSTS, description: "Line posts", uom: "pcs", qty: "n_LP", component: "materials", cost: fenceProduct("line_post", POST_FROM) },
    { code: "straining_posts", group: G_FENCE_POSTS, description: "Straining posts", uom: "pcs", qty: "n_SP", component: "materials", cost: fenceProduct("straining_post", POST_FROM) },
    { code: "corner_posts", group: G_FENCE_POSTS, description: "Corner posts", uom: "pcs", qty: "n_CP", component: "materials", cost: fenceProduct("corner_post", POST_FROM) },
    { code: "terminal_posts", group: G_FENCE_POSTS, description: "Terminal posts", uom: "pcs", qty: "n_TP", component: "materials", cost: fenceProduct("terminal_post", POST_FROM) },
    { code: "gate_posts", group: G_FENCE_POSTS, description: "Gate posts", uom: "pcs", qty: "n_GP", component: "materials", cost: fenceProduct("gate_post", POST_FROM) },

    { code: "fabric", group: G_FENCE_FABRIC, description: "Chain-link fabric", uom: "m2", qty: "area_FB", component: "materials", cost: fenceProduct("fabric", ["mesh", "coating"]) },

    { code: "tension_bands", group: G_FENCE_FITTINGS, description: "Tension bands", uom: "pcs", qty: `${TERMINAL_TYPE} * max(3, ceil(fabric_height_m / 0.3))`, component: "materials", cost: fenceProduct("tension_band", HARDWARE_FROM) },
    { code: "brace_bands", group: G_FENCE_FITTINGS, description: "Brace bands", uom: "pcs", qty: `${TERMINAL_TYPE} * 2`, component: "materials", cost: fenceProduct("brace_band", HARDWARE_FROM) },
    { code: "rail_ends", group: G_FENCE_FITTINGS, description: "Rail ends", uom: "pcs", qty: `${TERMINAL_TYPE} * 2`, component: "materials", cost: fenceProduct("rail_end", HARDWARE_FROM) },
    { code: "carriage_bolts", group: G_FENCE_FITTINGS, description: "Carriage bolt sets", uom: "sets", qty: "qty_tension_bands + qty_brace_bands", component: "materials", cost: fenceProduct("carriage_bolt_set", HARDWARE_FROM) },
    { code: "truss_sets", group: G_FENCE_FITTINGS, description: "Truss rod sets", uom: "sets", qty: "truss_rods * (n_CP + n_SP)", component: "materials", cost: fenceProduct("truss_rod_set", HARDWARE_FROM) },

    { code: "tension_wire_m", group: G_FENCE_WIRE, description: "Tension wire", uom: "m", qty: "tension_wire * round(total_length_m * 3)", component: "materials", cost: fenceProduct("tension_wire", HARDWARE_FROM) },
    { code: "tie_wire_kg", group: G_FENCE_WIRE, description: "Tie wire", uom: "kg", qty: "tie_wire * round(total_length_m * 0.0186, 1)", component: "materials", cost: fenceProduct("tie_wire", HARDWARE_FROM) },
    { code: "barbed_wire_m", group: G_FENCE_WIRE, description: "Barbed wire", uom: "m", qty: "barbed_wire * total_length_m * 3", component: "materials", cost: fenceProduct("barbed_wire", HARDWARE_FROM) },
  ],
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  PRECAST_VILLA_STARTER, CHAINLINK_FENCE_STARTER,
  // The tiles and porta cabin starters carry illustrative rates; installed locked like the fence, copied to customise.
  ...TILES_STARTERS.map((t) => ({ ...t, locked: true })),
  ...CABIN_STARTERS.map((t) => ({ ...t, locked: true })),
];
