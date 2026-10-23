// Starter template: porta cabin (docs/design/estimator-unification-and-inbox.md).
//
// THE RATES, RATIOS AND HOURS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no
// particular currency. They make the template demonstrable and testable; they
// are not any manufacturer's prices or build method. A workspace copies this
// template and replaces them with its own, as data.
//
// The template names the `porta_cabin` geometry module: the cabins are laid out
// as real units, wall panels (with their door and window openings), roofs and
// partitions, and the rules price the counts and areas the layout works out to
// (n_unit, area_wall, area_roof, area_floor, n_door, n_window, area_partition,
// len_joint). Group names are what the customer reads on the quote.

import { groupSlug } from "./types";
import type { CatalogueStarter } from "./starterTemplatesTiles";

const G_SHELL = "Cabin shell and cladding";
const G_FIT = "Fit-out and services";
const G_ASM = "Assembly and site installation";
const G_DEL = "Delivery";
const sub = (group: string) => `sub_${groupSlug(group)}`;

export const PORTA_CABIN_STARTER: CatalogueStarter = {
  name: "Porta cabin (illustrative)",
  description:
    "ILLUSTRATIVE starter for modular porta cabins: units on a grid (single, row, L-shape or stacked two high) with doors, windows, partitions and a basic, standard or premium fit-out, shown as a 3D model and priced from the pieces. All rates are placeholders, not any manufacturer's prices. Copy it and replace them with your own.",
  trade: "modular buildings",
  icon: "cabin",
  keywords: [
    "cabin", "cabins", "porta cabin", "portacabin", "porta-cabin", "portable", "site office", "office cabin", "modular", "prefab",
    "prefabricated", "container", "labour camp", "accommodation", "toilet block", "guard room", "site cabin", "temporary building",
  ],
  quote_granularity: "group",
  geometry: "porta_cabin",

  inputs: [
    // The inputs down to "partition_count" are read by the porta_cabin geometry module.
    { key: "unit_length_m", label: "Unit length", type: "number", default: 6, min: 2.4, max: 12.2, unit: "m", section: "Unit" },
    { key: "unit_width_m", label: "Unit width", type: "number", default: 2.4, min: 2.2, max: 3.6, unit: "m", section: "Unit" },
    { key: "unit_height_m", label: "Inside height", type: "number", default: 2.6, min: 2.1, max: 3.2, unit: "m", section: "Unit" },
    { key: "layout", label: "Layout", type: "select", default: "row", section: "Layout",
      help: "A row puts the units end to end; an L turns the corner; stacked puts a second storey on a row.",
      options: [
        { key: "single", label: "Single unit", value: 1 },
        { key: "row", label: "Row of units", value: 2 },
        { key: "l_shape", label: "L-shape", value: 3 },
        { key: "stacked", label: "Stacked, 2 high", value: 4 },
      ] },
    { key: "units_along", label: "Units along", type: "number", default: 2, min: 1, max: 12, unit: "units", section: "Layout" },
    { key: "units_across", label: "Units across (L-shape)", type: "number", default: 1, min: 1, max: 8, unit: "units", section: "Layout",
      help: "Only the L-shape uses this: the length of the second arm, counting the corner unit." },
    { key: "door_count", label: "Doors", type: "number", default: 1, min: 0, max: 20, unit: "doors", section: "Openings and rooms" },
    { key: "window_count", label: "Windows", type: "number", default: 2, min: 0, max: 40, unit: "windows", section: "Openings and rooms" },
    { key: "partition_count", label: "Partition walls", type: "number", default: 0, min: 0, max: 20, unit: "walls", section: "Openings and rooms" },
    { key: "wet_room_count", label: "Toilet / wet rooms", type: "number", default: 0, min: 0, max: 20, unit: "rooms", section: "Openings and rooms" },
    { key: "fit_out", label: "Fit-out level", type: "select", default: "standard", section: "Fit-out", quote_alternatives: true,
      help: "Basic is a shell with lights and sockets. Standard adds internal lining and more points; Premium adds an allowance for better finishes.",
      options: [
        { key: "basic", label: "Basic", value: 1 },
        { key: "standard", label: "Standard", value: 2 },
        { key: "premium", label: "Premium", value: 3 },
      ] },
    { key: "include_ac", label: "Air conditioning (one split unit per cabin)", type: "boolean", default: true, section: "Fit-out" },
    { key: "transport_distance_km", label: "Distance to site", type: "number", default: 150, min: 0, max: 3000, unit: "km", section: "Delivery" },
  ],

  rates: [
    // Materials: ILLUSTRATIVE unit prices. `low` and `high` are the risk range for the Simulation tab.
    { key: "shell_cost_m2", label: "Frame, floor and roof structure (per m² of floor)", unit: "per m²", value: 285, low: 256, high: 340 },
    { key: "wall_panel_cost_m2", label: "Insulated wall panel", unit: "per m²", value: 34, low: 30, high: 41 },
    { key: "roof_panel_cost_m2", label: "Insulated roof panel", unit: "per m²", value: 38, low: 34, high: 46 },
    { key: "door_cost", label: "Door, with frame and lock", unit: "per nr", value: 190 },
    { key: "window_cost", label: "Window, with frame", unit: "per nr", value: 150 },
    { key: "partition_cost_m2", label: "Partition wall", unit: "per m²", value: 30 },
    { key: "joint_cost_m", label: "Joint between units (sealing, flashing, bolts)", unit: "per m", value: 14 },
    { key: "flooring_cost_m2", label: "Flooring", unit: "per m²", value: 16 },
    { key: "lining_cost_m2", label: "Internal lining", unit: "per m²", value: 17 },
    { key: "electrical_points_per_unit", label: "Electrical points per cabin at basic fit-out", unit: "points", value: 4 },
    { key: "electrical_point_cost", label: "Electrical point (light, socket or switch)", unit: "per nr", value: 38 },
    { key: "db_cost", label: "Distribution board", unit: "per nr", value: 95 },
    { key: "ac_cost", label: "Air conditioning split unit", unit: "per nr", value: 430, low: 390, high: 520 },
    { key: "wet_room_cost", label: "Toilet / wet room fixtures and plumbing", unit: "per room", value: 680 },
    { key: "premium_allowance_m2", label: "Premium finishes allowance", unit: "per m²", value: 48 },
    // Labour and site
    { key: "labour_rate_hr", label: "Factory labour rate", unit: "per h", value: 15, low: 13.5, high: 18 },
    { key: "assembly_hours_per_m2", label: "Factory assembly time", unit: "h/m²", value: 4.5, low: 4, high: 5.6 },
    { key: "install_cost_unit", label: "Site installation (levelling, fixing, connections)", unit: "per unit", value: 320 },
    { key: "crane_day_cost", label: "Crane, per day", unit: "per day", value: 900 },
    // Delivery
    { key: "load_cost_unit", label: "Loading and unloading", unit: "per unit", value: 120 },
    { key: "haul_cost_km", label: "Haulage", unit: "per km", value: 2.4, low: 2.1, high: 3 },
    { key: "overhead_factor", label: "Overhead (share of shell, fit-out and assembly)", unit: "fraction", value: 0.1 },
  ],

  rules: [
    // ── Cabin shell and cladding ──
    { code: "shell", group: G_SHELL, description: "Frame, floor and roof structure", uom: "m2",
      qty: "area_floor", component: "materials", cost: { kind: "rate", rate: "shell_cost_m2" } },
    { code: "walls", group: G_SHELL, description: "Insulated wall panels", uom: "m2",
      qty: "area_wall", waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "wall_panel_cost_m2" } },
    { code: "roof", group: G_SHELL, description: "Insulated roof panels", uom: "m2",
      qty: "area_roof", waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "roof_panel_cost_m2" } },
    { code: "doors", group: G_SHELL, description: "Doors", uom: "nr",
      qty: "n_door", component: "materials", cost: { kind: "rate", rate: "door_cost" } },
    { code: "wins", group: G_SHELL, description: "Windows", uom: "nr",
      qty: "n_window", component: "materials", cost: { kind: "rate", rate: "window_cost" } },
    { code: "parts", group: G_SHELL, description: "Partition walls", uom: "m2",
      qty: "area_partition", waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "partition_cost_m2" } },
    { code: "jnt", group: G_SHELL, description: "Joints between units", uom: "m",
      qty: "len_joint", component: "materials", cost: { kind: "rate", rate: "joint_cost_m" } },

    // ── Fit-out and services ──
    { code: "flr", group: G_FIT, description: "Flooring", uom: "m2",
      qty: "area_floor", waste_pct: 8, component: "materials", cost: { kind: "rate", rate: "flooring_cost_m2" } },
    { code: "lin", group: G_FIT, description: "Internal wall and ceiling lining", uom: "m2",
      qty: "if(fit_out >= 2, area_wall + area_roof, 0)", waste_pct: 8, component: "materials", cost: { kind: "rate", rate: "lining_cost_m2" } },
    { code: "elec", group: G_FIT, description: "Electrical points (lights, sockets, switches)", uom: "nr",
      qty: "n_unit * electrical_points_per_unit * fit_out", component: "materials", cost: { kind: "rate", rate: "electrical_point_cost" } },
    { code: "db", group: G_FIT, description: "Distribution boards", uom: "nr",
      qty: "n_unit", component: "materials", cost: { kind: "rate", rate: "db_cost" } },
    { code: "ac", group: G_FIT, description: "Air conditioning split units", uom: "nr",
      qty: "n_unit * include_ac", component: "materials", cost: { kind: "rate", rate: "ac_cost" } },
    { code: "wet", group: G_FIT, description: "Toilet and wet room fixtures and plumbing", uom: "room",
      qty: "wet_room_count", component: "materials", cost: { kind: "rate", rate: "wet_room_cost" } },
    { code: "prem", group: G_FIT, description: "Premium finishes allowance", uom: "m2",
      qty: "if(fit_out == 3, area_floor, 0)", component: "materials", cost: { kind: "rate", rate: "premium_allowance_m2" } },

    // ── Assembly and site installation ──
    { code: "asm", group: G_ASM, description: "Factory assembly", uom: "h",
      qty: "area_floor * assembly_hours_per_m2", component: "labour", cost: { kind: "rate", rate: "labour_rate_hr" } },
    { code: "inst", group: G_ASM, description: "Site installation of the units", uom: "unit",
      qty: "n_unit", component: "erection", cost: { kind: "rate", rate: "install_cost_unit" } },
    { code: "crane", group: G_ASM, description: "Crane for stacking the second storey", uom: "day",
      qty: "if(n_storey > 1, n_unit / 4, 0)", component: "erection", cost: { kind: "rate", rate: "crane_day_cost" } },

    // ── Delivery ──
    { code: "load", group: G_DEL, description: "Loading and unloading", uom: "unit",
      qty: "n_unit", component: "transport", cost: { kind: "rate", rate: "load_cost_unit" } },
    { code: "haul", group: G_DEL, description: "Haulage to site (one unit per load)", uom: "km",
      qty: "n_unit * transport_distance_km", component: "transport", cost: { kind: "rate", rate: "haul_cost_km" } },

    // ── Overhead ──
    { code: "ovh", group: "Overhead", description: "Overhead", uom: "cost",
      qty: `${sub(G_SHELL)} + ${sub(G_FIT)} + ${sub(G_ASM)}`, component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } },
  ],
};

export const CABIN_STARTERS: readonly CatalogueStarter[] = [PORTA_CABIN_STARTER];
