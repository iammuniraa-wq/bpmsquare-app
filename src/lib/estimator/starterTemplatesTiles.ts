// Starter template: floor tiles (docs/design/estimator-unification-and-inbox.md).
//
// THE RATES, RATIOS AND HOURS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no
// particular currency. They make the template demonstrable and testable; they
// are not any supplier's prices or any fitter's method. A workspace copies this
// template and replaces them with its own, as data.
//
// The template names the `tiles_floor` geometry module: the floor is laid tile
// by tile, and the rules price its counts (n_tile, n_cut, n_order, area_floor,
// len_joint, len_skirting ...). Group names are what the customer reads on the
// quote, so they are plain words.

import { groupSlug } from "./types";
import type { StarterTemplate } from "./starterTemplates";

/** A starter as the template catalogue shows it: a template plus the words that find it and its picture. */
export type CatalogueStarter = StarterTemplate & {
  /** Words an email or a person might use; read by the template pick. */
  keywords: string[];
  /** Generic icon word for the card (the catalogue maps it to an SVG). */
  icon: string;
};

const G_MAT = "Tiles and materials";
const G_LAB = "Laying and finishing";
const G_DEL = "Delivery and site";
const sub = (group: string) => `sub_${groupSlug(group)}`;

export const TILES_FLOOR_STARTER: CatalogueStarter = {
  name: "Floor tiles (illustrative)",
  description:
    "ILLUSTRATIVE starter for a tiled floor: whole and cut tiles laid in a grid, brick or diagonal pattern over a rectangular or L-shaped room, with adhesive, grout, spacers, skirting and laying labour worked out from the layout. All rates are placeholders, not any supplier's or fitter's prices. Copy it and replace them with your own.",
  trade: "tiling",
  icon: "tiles",
  keywords: [
    "tile", "tiles", "tiling", "tiled", "floor", "flooring", "porcelain", "ceramic", "grout", "skirting", "bathroom", "kitchen",
    "terrace", "mosaic", "marble", "granite", "adhesive", "screed",
  ],
  quote_granularity: "group",
  geometry: "tiles_floor",

  inputs: [
    // The first block is read by the tiles_floor geometry module.
    { key: "room_length_m", label: "Room length", type: "number", default: 5, min: 0.5, max: 100, unit: "m", section: "Room" },
    { key: "room_width_m", label: "Room width", type: "number", default: 3.5, min: 0.5, max: 100, unit: "m", section: "Room" },
    { key: "cutout_length_m", label: "L-shape: corner length", type: "number", default: 0, min: 0, max: 99, unit: "m", section: "Room",
      help: "For an L-shaped room: the size of the corner that is not part of the floor. Leave both at 0 for a rectangle." },
    { key: "cutout_width_m", label: "L-shape: corner width", type: "number", default: 0, min: 0, max: 99, unit: "m", section: "Room" },
    { key: "tile_length_mm", label: "Tile length", type: "number", default: 600, min: 100, max: 1200, unit: "mm", section: "Tile" },
    { key: "tile_width_mm", label: "Tile width", type: "number", default: 600, min: 100, max: 1200, unit: "mm", section: "Tile" },
    { key: "tile_thickness_mm", label: "Tile thickness", type: "number", default: 10, min: 5, max: 30, unit: "mm", section: "Tile" },
    { key: "grout_mm", label: "Grout joint", type: "number", default: 3, min: 0, max: 10, unit: "mm", section: "Tile" },
    { key: "finish", label: "Tile finish", type: "select", default: "porcelain_white", section: "Tile", paints: "tile",
      help: "Paints the floor in the 3D room and the plan. Wood is drawn as planks of the tile size you give.",
      options: [
        { key: "porcelain_white", label: "White porcelain", value: 1, visual: "porcelain_white" },
        { key: "porcelain_grey", label: "Grey porcelain", value: 2, visual: "porcelain_grey" },
        { key: "marble_white", label: "White marble", value: 3, visual: "marble_white" },
        { key: "terrazzo", label: "Terrazzo", value: 4, visual: "terrazzo" },
        { key: "ceramic_beige", label: "Beige ceramic", value: 5, visual: "ceramic_beige" },
        { key: "wood_oak", label: "Oak plank", value: 6, visual: "wood_oak" },
      ] },
    { key: "tile_range", label: "Tile range", type: "select", default: "standard", section: "Tile", quote_alternatives: true,
      help: "Standard adds 25% and Premium 60% to the tile price.",
      options: [
        { key: "basic", label: "Basic", value: 1 },
        { key: "standard", label: "Standard", value: 1.25 },
        { key: "premium", label: "Premium", value: 1.6 },
      ] },
    { key: "pattern", label: "Pattern", type: "select", default: "grid", section: "Layout",
      help: "Brick and diagonal need more cuts and more labour than a straight grid.",
      options: [
        { key: "grid", label: "Straight grid", value: 1 },
        { key: "brick", label: "Brick (50% offset)", value: 2 },
        { key: "diagonal", label: "Diagonal (45°)", value: 3 },
      ] },
    { key: "direction", label: "Direction", type: "select", default: "lengthways", section: "Layout",
      options: [
        { key: "lengthways", label: "Along the room length", value: 1 },
        { key: "across", label: "Across the room", value: 2 },
      ] },
    { key: "border_mm", label: "Border width", type: "number", default: 0, min: 0, max: 300, unit: "mm", section: "Layout",
      help: "A strip of tile all round the room. Rectangular rooms only; 0 for none." },
    { key: "waste_pct", label: "Waste allowance", type: "number", default: 0, min: 0, max: 30, unit: "%", section: "Layout",
      help: "0 uses the usual allowance for the pattern (5% grid, 8% brick, 12% diagonal)." },
    { key: "include_skirting", label: "Skirting", type: "boolean", default: true, section: "Finish" },
    { key: "skirting_height_mm", label: "Skirting height", type: "number", default: 100, min: 50, max: 300, unit: "mm", section: "Finish" },
    { key: "door_width_m", label: "Door width (no skirting)", type: "number", default: 0.9, min: 0, max: 5, unit: "m", section: "Finish" },
    { key: "include_waterproofing", label: "Waterproofing membrane (wet area)", type: "boolean", default: false, section: "Finish" },
    { key: "adhesive_bed_mm", label: "Adhesive bed thickness", type: "number", default: 6, min: 2, max: 20, unit: "mm", section: "Finish" },
  ],

  rates: [
    // Materials: ILLUSTRATIVE unit prices. `low` and `high` are the risk range for the Simulation tab.
    { key: "tile_cost_m2", label: "Tile, supplied", unit: "per m²", value: 45, low: 36, high: 60 },
    { key: "adhesive_kg_m2_per_mm", label: "Adhesive used per m² for each mm of bed", unit: "kg", value: 1.4 },
    { key: "adhesive_cost_kg", label: "Tile adhesive", unit: "per kg", value: 0.55, low: 0.48, high: 0.7 },
    { key: "grout_density_kg_m3", label: "Grout density", unit: "kg/m³", value: 1600 },
    { key: "grout_cost_kg", label: "Grout", unit: "per kg", value: 2.4 },
    { key: "spacer_pitch_m", label: "One tile spacer for every", unit: "m of joint", value: 0.3 },
    { key: "spacer_cost_nr", label: "Tile spacer", unit: "per nr", value: 0.02 },
    { key: "skirting_cost_m", label: "Skirting tile, cut and supplied", unit: "per m", value: 7.5 },
    { key: "waterproof_cost_m2", label: "Waterproofing membrane", unit: "per m²", value: 11 },
    // Labour: hours and rates.
    { key: "labour_rate_hr", label: "Tiler labour rate", unit: "per h", value: 14, low: 12.6, high: 17 },
    { key: "prep_hours_per_m2", label: "Surface preparation", unit: "h/m²", value: 0.12 },
    { key: "lay_hours_per_m2", label: "Laying, straight grid", unit: "h/m²", value: 0.8, low: 0.7, high: 1 },
    { key: "pattern_labour_step", label: "Extra laying time per pattern step (brick, diagonal)", unit: "fraction", value: 0.15 },
    { key: "cut_minutes_per_tile", label: "Time to cut one tile", unit: "min", value: 6 },
    { key: "grout_hours_per_m2", label: "Grouting and cleaning", unit: "h/m²", value: 0.15 },
    { key: "skirting_hours_per_m", label: "Fixing skirting", unit: "h/m", value: 0.12 },
    { key: "delivery_cost_job", label: "Delivery of materials to site", unit: "per job", value: 85 },
    { key: "overhead_factor", label: "Overhead (share of materials and labour)", unit: "fraction", value: 0.08 },
  ],

  rules: [
    // ── Tiles and materials ──
    { code: "tiles", group: G_MAT, description: "Floor tiles, including the waste allowance", uom: "m2",
      qty: "n_order * area_tile", component: "materials", cost: { kind: "rate", rate: "tile_cost_m2" } },
    { code: "range", group: G_MAT, description: "Tile range premium", uom: "m2",
      qty: "n_order * area_tile * (tile_range - 1)", component: "materials", cost: { kind: "rate", rate: "tile_cost_m2" } },
    { code: "bdr", group: G_MAT, description: "Border tiles", uom: "m2",
      qty: "n_border_tiles * area_tile", waste_pct: "waste_pct_used", component: "materials", cost: { kind: "rate", rate: "tile_cost_m2" } },
    { code: "adh", group: G_MAT, description: "Tile adhesive", uom: "kg",
      qty: "area_floor * adhesive_bed_mm * adhesive_kg_m2_per_mm", waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "adhesive_cost_kg" } },
    { code: "grt", group: G_MAT, description: "Grout", uom: "kg",
      qty: "len_joint * (grout_mm / 1000) * (tile_thickness_mm / 1000) * grout_density_kg_m3", waste_pct: 15,
      component: "materials", cost: { kind: "rate", rate: "grout_cost_kg" } },
    { code: "spc", group: G_MAT, description: "Tile spacers", uom: "nr",
      qty: "ceil(len_joint / spacer_pitch_m)", waste_pct: 10, component: "materials", cost: { kind: "rate", rate: "spacer_cost_nr" } },
    { code: "skt", group: G_MAT, description: "Skirting tiles", uom: "m",
      qty: "len_skirting", waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "skirting_cost_m" } },
    { code: "wpf", group: G_MAT, description: "Waterproofing membrane", uom: "m2",
      qty: "area_floor * include_waterproofing", waste_pct: 10, component: "materials", cost: { kind: "rate", rate: "waterproof_cost_m2" } },

    // ── Laying and finishing ──
    { code: "prep", group: G_LAB, description: "Surface preparation", uom: "h",
      qty: "area_floor * prep_hours_per_m2", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },
    { code: "lay", group: G_LAB, description: "Laying tiles", uom: "h",
      qty: "area_floor * lay_hours_per_m2 * (1 + (pattern - 1) * pattern_labour_step)", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },
    { code: "cut", group: G_LAB, description: "Cutting tiles to fit", uom: "h",
      qty: "n_cut * cut_minutes_per_tile / 60", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },
    { code: "grl", group: G_LAB, description: "Grouting and cleaning", uom: "h",
      qty: "area_floor * grout_hours_per_m2", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },
    { code: "skl", group: G_LAB, description: "Fixing skirting", uom: "h",
      qty: "len_skirting * skirting_hours_per_m", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },

    // ── Delivery and site ──
    { code: "dlv", group: G_DEL, description: "Delivery of materials to site", uom: "job",
      qty: "1", component: "transport", cost: { kind: "rate", rate: "delivery_cost_job" } },

    // ── Overhead ──
    { code: "ovh", group: "Overhead", description: "Overhead", uom: "cost",
      qty: `${sub(G_MAT)} + ${sub(G_LAB)}`, component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } },
  ],
};

export const TILES_STARTERS: readonly CatalogueStarter[] = [TILES_FLOOR_STARTER];
