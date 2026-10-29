// Starter template: pipes and fittings (docs/design/gcc-tender-deals.md, "Slice 3c-2 as built").
//
// THE RATES, RATIOS AND CATALOGUE COSTS BELOW ARE ILLUSTRATIVE PLACEHOLDERS, in no particular currency. They make the template
// demonstrable and testable; they are not any supplier's prices or contractor's method. Pipe, fittings, joints, valves, bedding
// and reinstatement are CATALOGUE items (priced from the workspace's products, flagged illustrative until a rate sheet is
// imported); plant, labour, haulage and testing are template rates, which a workspace changes by "Copy to customise".
//
// A formula-only template (no 3D layout): a pipeline of a given length, in steel, GRP or HDPE, at a nominal diameter, laid in a
// trench of a given depth through a given soil. The trench is the pipe's outside diameter plus a working space each side.
//
// Group names carry the MasterFormat section where the code is certain: 31 23 16 Excavation, 31 23 23 Fill (bedding and
// backfill), 33 11 00 Water utility distribution piping. The template format has no cost-code field of its own yet, so the code
// rides in the group name, which is also what the WBS and the quote show.

import { groupSlug } from "./types";
import type { StarterCatalogueItem } from "./starterCatalogue";
import type { CatalogueStarter } from "./starterTemplatesTiles";
import type { TemplateRule } from "./types";

const G_EXC = "31 23 16 Excavation";
const G_BED = "31 23 23 Bedding and backfill";
const G_SUP = "33 11 00 Pipe, fittings and valves";
const G_LAY = "33 11 00 Laying, jointing and testing";
const G_REIN = "Surface reinstatement";
const sub = (group: string) => `sub_${groupSlug(group)}`;

/** Pipe material: the number a formula sees (1 steel, 2 GRP, 3 HDPE) and the tag the catalogue item carries. */
export const PIPE_MATERIALS = [
  { key: "steel", label: "Steel, coated", value: 1, name: "Steel pipe" },
  { key: "grp", label: "GRP", value: 2, name: "GRP pipe" },
  { key: "hdpe", label: "HDPE (PE100)", value: 3, name: "HDPE pipe" },
] as const;

/** Nominal diameters in millimetres: the number a formula sees is the diameter itself. */
export const PIPE_DIAMETERS = [100, 200, 300, 400, 600] as const;

type Row = readonly [number, number, number, number, number];
const at = (row: Row, dn: number) => row[PIPE_DIAMETERS.indexOf(dn as (typeof PIPE_DIAMETERS)[number])];

// ILLUSTRATIVE unit costs by diameter (DN 100, 200, 300, 400, 600), per metre of pipe, per fitting, per joint, per valve.
const PIPE_PER_M: Record<string, Row> = {
  steel: [95, 210, 340, 520, 880],
  grp: [85, 150, 240, 360, 640],
  hdpe: [38, 120, 245, 410, 760],
};
const FITTING_EACH: Record<string, Row> = {
  steel: [180, 420, 760, 1250, 2600],
  grp: [260, 520, 900, 1400, 2900],
  hdpe: [70, 230, 520, 980, 2100],
};
const JOINT_EACH: Record<string, Row> = {
  steel: [45, 110, 190, 300, 520],
  grp: [60, 130, 210, 330, 560],
  hdpe: [30, 95, 180, 290, 510],
};
const VALVE_EACH: Row = [650, 1500, 3100, 5200, 11500];

const JOINT_NAME: Record<string, string> = { steel: "Steel pipe weld joint, coated", grp: "GRP pipe coupling", hdpe: "HDPE electrofusion joint" };

export const PIPES_CATALOGUE: readonly StarterCatalogueItem[] = [
  ...PIPE_MATERIALS.flatMap((m) => PIPE_DIAMETERS.map((dn): StarterCatalogueItem => ({
    sku: `EST-PIPE-${m.key.toUpperCase()}-${dn}`, name: `${m.name} DN${dn}`, uom: "m", cost: at(PIPE_PER_M[m.key], dn),
    attrs: { est_kind: "pipe_supply", pipe_material: m.key, pipe_dn: String(dn) }, family: "pipes",
  }))),
  ...PIPE_MATERIALS.flatMap((m) => PIPE_DIAMETERS.map((dn): StarterCatalogueItem => ({
    sku: `EST-FIT-${m.key.toUpperCase()}-${dn}`, name: `${m.name.replace(" pipe", "")} fitting DN${dn} (bend, tee or reducer, average)`, uom: "nr", cost: at(FITTING_EACH[m.key], dn),
    attrs: { est_kind: "pipe_fitting", pipe_material: m.key, pipe_dn: String(dn) }, family: "pipes",
  }))),
  ...PIPE_MATERIALS.flatMap((m) => PIPE_DIAMETERS.map((dn): StarterCatalogueItem => ({
    sku: `EST-JNT-${m.key.toUpperCase()}-${dn}`, name: `${JOINT_NAME[m.key]} DN${dn}`, uom: "nr", cost: at(JOINT_EACH[m.key], dn),
    attrs: { est_kind: "pipe_joint", pipe_material: m.key, pipe_dn: String(dn) }, family: "pipes",
  }))),
  ...PIPE_DIAMETERS.map((dn): StarterCatalogueItem => ({
    sku: `EST-VLV-${dn}`, name: `Isolation valve DN${dn} (gate or butterfly)`, uom: "nr", cost: at(VALVE_EACH, dn),
    attrs: { est_kind: "pipe_valve", pipe_dn: String(dn) }, family: "pipes",
  })),
  { sku: "EST-PIPE-BED", name: "Granular bedding and surround, delivered", uom: "m3", cost: 62, attrs: { est_kind: "pipe_bedding" }, family: "pipes" },
  { sku: "EST-REIN-GRAVEL", name: "Gravel surface reinstatement", uom: "m2", cost: 38, attrs: { est_kind: "reinstatement", surface: "gravel" }, family: "pipes" },
  { sku: "EST-REIN-ASPHALT", name: "Asphalt surface reinstatement", uom: "m2", cost: 95, attrs: { est_kind: "reinstatement", surface: "asphalt" }, family: "pipes" },
];

// The trench: the pipe's diameter plus a working space each side, for a given length and depth.
const WIDTH = "(pipe_dn / 1000 + 2 * trench_clearance_m)";
const TRENCH = `length_m * ${WIDTH} * depth_m`;
const SUPPLY_FROM = ["pipe_material", "pipe_dn"];

const rule = (r: TemplateRule): TemplateRule => r;

export const PIPES_FITTINGS_STARTER: CatalogueStarter = {
  name: "Pipes and fittings (illustrative)",
  description:
    "ILLUSTRATIVE starter for a buried pipeline in steel, GRP or HDPE: excavation, bedding, pipe, fittings and valves, joints, laying, pressure test, backfill and surface reinstatement, with the cost per metre and the totals. Pipe and fitting costs come from catalogue items marked illustrative until you import a rate sheet; plant and labour rates are placeholders. Copy it and replace them with your own.",
  trade: "pipelines",
  icon: "grid",
  keywords: [
    "pipe", "pipes", "pipeline", "piping", "water main", "main", "steel pipe", "GRP", "HDPE", "PE100", "ductile", "fittings", "valves",
    "trench", "trenching", "laying", "jointing", "pressure test", "hydrotest", "backfill", "reinstatement", "network", "irrigation", "sewer", "per metre",
  ],
  quote_granularity: "group",
  catalogue: PIPES_CATALOGUE,
  visual: { run: "length_m", count: "valves_n" },

  inputs: [
    { key: "pipe_material", label: "Pipe material", type: "select", default: "steel", section: "Pipeline",
      help: "Picks the pipe, fittings and joints from your catalogue, and how long a joint takes to make.",
      options: PIPE_MATERIALS.map((m) => ({ key: m.key, label: m.label, value: m.value, attrs: { pipe_material: m.key } })) },
    { key: "pipe_dn", label: "Nominal diameter", type: "select", default: "dn300", section: "Pipeline", unit: "mm",
      options: PIPE_DIAMETERS.map((dn) => ({ key: `dn${dn}`, label: `DN ${dn}`, value: dn, attrs: { pipe_dn: String(dn) } })) },
    { key: "length_m", label: "Pipeline length", type: "number", default: 1000, min: 1, max: 100000, unit: "m", section: "Pipeline" },
    { key: "fittings_n", label: "Fittings (bends, tees, reducers)", type: "number", default: 10, min: 0, max: 5000, unit: "nr", section: "Fittings and valves" },
    { key: "valves_n", label: "Valves", type: "number", default: 2, min: 0, max: 1000, unit: "nr", section: "Fittings and valves" },
    { key: "depth_m", label: "Trench depth", type: "number", default: 1.8, min: 1, max: 8, unit: "m", section: "Trench",
      help: "Average depth from the ground to the bottom of the trench." },
    { key: "soil_type", label: "Soil", type: "select", default: "sand", section: "Trench",
      help: "Clay digs slower than sand, and rock needs a breaker as well as the excavator.",
      options: [
        { key: "sand", label: "Sand or loose soil", value: 1 },
        { key: "clay", label: "Stiff clay", value: 1.4 },
        { key: "rock", label: "Rock", value: 2.5 },
      ] },
    { key: "surface", label: "Surface to reinstate", type: "select", default: "natural", section: "Trench",
      options: [
        { key: "natural", label: "Natural ground (none)", value: 0 },
        { key: "gravel", label: "Gravel", value: 1, attrs: { surface: "gravel" } },
        { key: "asphalt", label: "Asphalt", value: 2, attrs: { surface: "asphalt" } },
      ] },
  ],

  rates: [
    // ILLUSTRATIVE placeholders. `low` and `high` are the risk range for the Simulation tab.
    { key: "trench_clearance_m", label: "Working space each side of the pipe", unit: "m", value: 0.3 },
    { key: "bed_thickness_m", label: "Bedding under and over the pipe", unit: "m", value: 0.15 },
    { key: "exc_m3_per_h", label: "Excavator production in sand", unit: "m³/h", value: 25 },
    { key: "excavator_rate_hr", label: "Excavator with operator", unit: "per h", value: 145, low: 130, high: 175 },
    { key: "breaker_h_per_m3", label: "Breaker time in rock", unit: "h/m³", value: 0.15 },
    { key: "breaker_rate_hr", label: "Hydraulic breaker with operator", unit: "per h", value: 190, low: 170, high: 230 },
    { key: "backfill_cost_m3", label: "Backfill and compaction, labour and plant", unit: "per m³", value: 18, low: 15, high: 24 },
    { key: "spoil_swell", label: "Loose volume of spoil per m³ in place", unit: "factor", value: 1.25 },
    { key: "spoil_cart_cost_m3", label: "Spoil carted to tip", unit: "per m³", value: 14, low: 12, high: 19 },
    { key: "pipe_length_m", label: "Length of one pipe", unit: "m", value: 12 },
    { key: "deliv_load_m_dn300", label: "Metres of DN 300 pipe on one delivery", unit: "m/load", value: 120 },
    { key: "delivery_cost_load", label: "Delivery of pipe, per load", unit: "per load", value: 900, low: 800, high: 1150 },
    { key: "lay_h_per_m", label: "Gang hours to lay one metre of DN 300", unit: "h/m", value: 0.35, low: 0.3, high: 0.5 },
    { key: "lay_crew_rate_hr", label: "Pipe gang (foreman, fitter, two labourers)", unit: "per h", value: 85, low: 75, high: 105 },
    { key: "lay_plant_rate_hr", label: "Laying plant (side boom or excavator)", unit: "per h", value: 160, low: 140, high: 200 },
    { key: "joint_h_steel", label: "Hours to weld and coat one steel joint", unit: "h", value: 2.5 },
    { key: "joint_h_grp", label: "Hours to make one GRP coupling", unit: "h", value: 1.2 },
    { key: "joint_h_hdpe", label: "Hours to make one HDPE electrofusion joint", unit: "h", value: 1.5 },
    { key: "test_section_m", label: "Length of one pressure-test section", unit: "m", value: 500 },
    { key: "test_cost_section", label: "Pressure test of one section (pump, water, gauges, crew)", unit: "per section", value: 2400, low: 2000, high: 3200 },
    { key: "overhead_factor", label: "Overhead (share of all the cost above)", unit: "fraction", value: 0.1 },
  ],

  rules: [
    // ── Excavation ──
    rule({ code: "exc", group: G_EXC, description: "Trench excavation (excavator with operator)", uom: "h",
      qty: `${TRENCH} * soil_type / exc_m3_per_h`, component: "other", cost: { kind: "rate", rate: "excavator_rate_hr" } }),
    rule({ code: "rock", group: G_EXC, description: "Rock breaking (hydraulic breaker)", uom: "h",
      qty: `(soil_type > 2) * ${TRENCH} * breaker_h_per_m3`, component: "other", cost: { kind: "rate", rate: "breaker_rate_hr" } }),

    // ── Bedding and backfill ──
    rule({ code: "bed", group: G_BED, description: "Granular bedding and surround", uom: "m3",
      qty: `length_m * ${WIDTH} * min(depth_m, 2 * bed_thickness_m + pipe_dn / 1000)`, waste_pct: 5,
      component: "materials", cost: { kind: "product", sku: "EST-PIPE-BED" } }),
    rule({ code: "bkf", group: G_BED, description: "Backfill and compaction (labour and plant)", uom: "m3",
      qty: `max(0, ${TRENCH} - qty_bed)`, component: "other", cost: { kind: "rate", rate: "backfill_cost_m3" } }),
    rule({ code: "spl", group: G_BED, description: "Surplus spoil carted to tip (bedding and pipe take the room of soil)", uom: "m3",
      qty: `(qty_bed + length_m * 0.7854 * (pipe_dn / 1000) * (pipe_dn / 1000)) * spoil_swell`,
      component: "transport", cost: { kind: "rate", rate: "spoil_cart_cost_m3" } }),

    // ── Pipe, fittings and valves ──
    rule({ code: "pipe", group: G_SUP, description: "Pipe, supplied", uom: "m", qty: "length_m", waste_pct: 2,
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "pipe_supply" }, from: SUPPLY_FROM } } }),
    rule({ code: "fit", group: G_SUP, description: "Fittings (bends, tees, reducers)", uom: "nr", qty: "fittings_n",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "pipe_fitting" }, from: SUPPLY_FROM } } }),
    rule({ code: "val", group: G_SUP, description: "Isolation valves", uom: "nr", qty: "valves_n",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "pipe_valve" }, from: ["pipe_dn"] } } }),
    rule({ code: "jnt", group: G_SUP, description: "Joints (one between pipes, two at every fitting and valve)", uom: "nr",
      qty: "max(0, ceil(length_m / pipe_length_m) - 1) + 2 * (fittings_n + valves_n)",
      component: "materials", cost: { kind: "product", match: { attrs: { est_kind: "pipe_joint" }, from: SUPPLY_FROM } } }),
    rule({ code: "dlv", group: G_SUP, description: "Delivery of pipe to site (loads by diameter)", uom: "load",
      qty: "ceil(length_m * pipe_dn / (deliv_load_m_dn300 * 300))", component: "transport", cost: { kind: "rate", rate: "delivery_cost_load" } }),

    // ── Laying, jointing and testing ──
    rule({ code: "lay", group: G_LAY, description: "Laying pipe (pipe gang)", uom: "h",
      qty: "length_m * lay_h_per_m * pipe_dn / 300", component: "labour", cost: { kind: "rate", rate: "lay_crew_rate_hr" } }),
    rule({ code: "layp", group: G_LAY, description: "Laying plant (side boom or excavator)", uom: "h",
      qty: "qty_lay", component: "other", cost: { kind: "rate", rate: "lay_plant_rate_hr" } }),
    rule({ code: "jlab", group: G_LAY, description: "Jointing labour", uom: "h",
      qty: "qty_jnt * if(pipe_material == 1, joint_h_steel, if(pipe_material == 2, joint_h_grp, joint_h_hdpe))",
      component: "labour", cost: { kind: "rate", rate: "lay_crew_rate_hr" } }),
    rule({ code: "tst", group: G_LAY, description: "Hydrostatic pressure test (per section)", uom: "section",
      qty: "ceil(length_m / test_section_m)", component: "other", cost: { kind: "rate", rate: "test_cost_section" } }),

    // ── Surface reinstatement ──
    rule({ code: "rein", group: G_REIN, description: "Surface reinstatement over the trench", uom: "m2",
      qty: `(surface > 0) * length_m * ${WIDTH}`, component: "materials",
      cost: { kind: "product", match: { attrs: { est_kind: "reinstatement" }, from: ["surface"] } } }),

    // ── Overhead ──
    rule({ code: "ovh", group: "Overhead", description: "Overhead", uom: "cost",
      qty: `${sub(G_EXC)} + ${sub(G_BED)} + ${sub(G_SUP)} + ${sub(G_LAY)} + ${sub(G_REIN)}`, component: "overhead", cost: { kind: "rate", rate: "overhead_factor" } }),
  ],
};

export const PIPES_STARTERS: readonly CatalogueStarter[] = [PIPES_FITTINGS_STARTER];
