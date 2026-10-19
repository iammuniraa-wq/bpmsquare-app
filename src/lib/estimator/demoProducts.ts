// Illustrative catalogue and template for the precast demo (docs/estimator-architecture.md,
// "Products and kits as estimate items"). Pure data, no I/O. Two generators read it:
//
//   scripts/gen-estimator-demo-seed.ts           -> scripts/seed-estimator-demo.sql
//   scripts/gen-estimator-products-demo-seed.ts  -> scripts/seed-estimator-products-demo.sql
//
// so the products the SQL creates, the kits' roll-up, the template that names them and
// the sample estimate's figures all come from one place. EVERYTHING HERE IS ILLUSTRATIVE:
// placeholder Saudi precast costs in SAR to make the estimator demonstrable, not any
// company's real prices or method. The starter template (starterTemplates.ts) is left
// as it was; this file derives the demo's product-based variant from it.

import { rollUpBom, type BomLine, type BomProduct } from "../products/bom";
import { groupSlug } from "./types";
import type { EstimateTemplateBody, TemplateRule } from "./types";
import { PRECAST_VILLA_STARTER, type StarterTemplate } from "./starterTemplates";

export type DemoProduct = {
  sku: string;
  name: string;
  uom: string;
  item_type: string;
  description: string;
  /** Internal cost. A kit's is rolled up from its components (not stored here). */
  cost?: number;
  list_price?: number;
};

export type DemoBomLine = {
  kit: string; // SKU of the kit
  component: string; // SKU of the component
  qty: number;
  uom: string;
  scrap_pct: number;
  line_kind: "consumed" | "used";
  note?: string;
};

const T = 15; // tax percent on the demo products (the demo tenant's VAT)

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  // Finished precast elements
  { sku: "PC-HCS-200", name: "Hollow-core slab 200 mm", uom: "m2", item_type: "finished_product", cost: 145, list_price: 190, description: "Prestressed hollow-core floor and roof slab, 200 mm, per m² of slab." },
  { sku: "PC-WALL-SOLID", name: "Solid precast wall panel 150 mm", uom: "m2", item_type: "finished_product", cost: 210, list_price: 275, description: "Reinforced solid wall panel, 150 mm, per m² of wall." },
  { sku: "PC-WALL-SAND", name: "Sandwich insulated wall panel 200 mm", uom: "m2", item_type: "finished_product", cost: 340, list_price: 445, description: "Two concrete leaves around 50 mm insulation, per m² of wall." },
  { sku: "PC-COL", name: "Precast column", uom: "m3", item_type: "finished_product", cost: 1450, list_price: 1900, description: "Reinforced precast column, per m³ of concrete." },
  { sku: "PC-BEAM", name: "Precast beam", uom: "m3", item_type: "finished_product", cost: 1350, list_price: 1780, description: "Reinforced precast beam, per m³ of concrete." },
  { sku: "PC-STAIR", name: "Precast stair flight", uom: "Nos", item_type: "finished_product", cost: 6200, list_price: 8100, description: "Straight precast stair flight with landing, per flight." },
  { sku: "PC-PARAPET", name: "Precast parapet panel", uom: "lm", item_type: "finished_product", cost: 310, list_price: 405, description: "Roof parapet panel, per linear metre." },
  // Site consumables and fixings
  { sku: "CN-GROUT", name: "Non-shrink grout, 25 kg bag", uom: "Bag", item_type: "consumable", cost: 38, list_price: 52, description: "Cementitious non-shrink grout for panel and column joints." },
  { sku: "CN-SEALANT", name: "Joint sealant", uom: "lm", item_type: "consumable", cost: 14, list_price: 20, description: "Weather sealant with backing rod, per linear metre of joint." },
  { sku: "BO-PLATE", name: "Steel connection plate", uom: "Nos", item_type: "bought_out_component", cost: 85, list_price: 118, description: "Galvanised steel connection plate with anchors." },
  // Services
  { sku: "SV-TRANSPORT", name: "Transport to site (per trip)", uom: "Trip", item_type: "service", cost: 1800, list_price: 2300, description: "Low-bed trailer trip from the factory to site, up to 25 t." },
  { sku: "SV-ERECT", name: "Crane and erection crew (per day)", uom: "Day", item_type: "service", cost: 3200, list_price: 4200, description: "Mobile crane with operator and a four-person erection crew, per day." },
  { sku: "SV-CAST-LABOUR", name: "Casting labour (per hour)", uom: "Hr", item_type: "service", cost: 18, list_price: 26, description: "Factory casting and finishing labour." },
  // Tool
  { sku: "TL-MOULD-SET", name: "Wall panel mould set", uom: "Set", item_type: "tool_equipment", cost: 48000, description: "Steel mould set for wall panels. Used by the panel kits, not consumed by them." },
  // Materials that go into the kits
  { sku: "RM-CONCRETE", name: "Precast concrete C40", uom: "m3", item_type: "raw_material", cost: 330, description: "Ready-mixed C40 concrete for the casting yard." },
  { sku: "RM-REBAR", name: "Reinforcement steel, cut and bent", uom: "Kg", item_type: "raw_material", cost: 3.2, description: "Reinforcement bar, cut and bent to schedule." },
  { sku: "RM-INSUL", name: "Insulation board 50 mm", uom: "m2", item_type: "raw_material", cost: 38, description: "Rigid insulation board for sandwich panels." },
  { sku: "BO-CONNECTOR", name: "Sandwich panel connector", uom: "Nos", item_type: "bought_out_component", cost: 18, description: "Thermal connector tying the two leaves of a sandwich panel." },
  // BOM kits (cost rolled up from the lines below)
  { sku: "KIT-WALL-M2", name: "Villa wall panel kit (per m²)", uom: "m2", item_type: "bom_kit", description: "Insulated external wall panel: concrete, reinforcement, insulation, connectors and casting labour per m² of wall." },
  { sku: "KIT-BOUNDARY-M2", name: "Boundary wall panel kit (per m²)", uom: "m2", item_type: "bom_kit", description: "Solid boundary wall panel: concrete, reinforcement and casting labour per m² of wall." },
  { sku: "KIT-FRAME-M3", name: "Frame mix: columns and beams (per m³)", uom: "m3", item_type: "bom_kit", description: "One m³ of frame concrete as 35% columns and 65% beams." },
];

export const DEMO_BOM: readonly DemoBomLine[] = [
  { kit: "KIT-WALL-M2", component: "RM-CONCRETE", qty: 0.2, uom: "m3", scrap_pct: 3, line_kind: "consumed", note: "200 mm leaf-equivalent" },
  { kit: "KIT-WALL-M2", component: "RM-REBAR", qty: 20, uom: "Kg", scrap_pct: 5, line_kind: "consumed" },
  { kit: "KIT-WALL-M2", component: "RM-INSUL", qty: 1, uom: "m2", scrap_pct: 5, line_kind: "consumed" },
  { kit: "KIT-WALL-M2", component: "BO-CONNECTOR", qty: 2, uom: "Nos", scrap_pct: 0, line_kind: "consumed" },
  { kit: "KIT-WALL-M2", component: "SV-CAST-LABOUR", qty: 0.7, uom: "Hr", scrap_pct: 0, line_kind: "consumed" },
  { kit: "KIT-WALL-M2", component: "TL-MOULD-SET", qty: 1, uom: "Set", scrap_pct: 0, line_kind: "used", note: "Tool: listed, not costed" },
  { kit: "KIT-BOUNDARY-M2", component: "RM-CONCRETE", qty: 0.1, uom: "m3", scrap_pct: 3, line_kind: "consumed" },
  { kit: "KIT-BOUNDARY-M2", component: "RM-REBAR", qty: 8, uom: "Kg", scrap_pct: 5, line_kind: "consumed" },
  { kit: "KIT-BOUNDARY-M2", component: "SV-CAST-LABOUR", qty: 0.4, uom: "Hr", scrap_pct: 0, line_kind: "consumed" },
  { kit: "KIT-BOUNDARY-M2", component: "TL-MOULD-SET", qty: 1, uom: "Set", scrap_pct: 0, line_kind: "used", note: "Tool: listed, not costed" },
  { kit: "KIT-FRAME-M3", component: "PC-COL", qty: 0.35, uom: "m3", scrap_pct: 0, line_kind: "consumed" },
  { kit: "KIT-FRAME-M3", component: "PC-BEAM", qty: 0.65, uom: "m3", scrap_pct: 0, line_kind: "consumed" },
];

export const DEMO_TAX_PERCENT = T;

/** Unit cost of every demo product: its stored cost, or a kit's roll-up by the products module's own function. */
export function demoUnitCosts(): Map<string, number> {
  const bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
  const asProduct = (p: DemoProduct): BomProduct => ({ id: p.sku, name: p.name, sku: p.sku, item_type: p.item_type, cost_price: p.cost ?? null });
  const lines: BomLine[] = DEMO_BOM.map((l, i) => ({
    id: `l${i}`, parent_product_id: l.kit, component_product_id: l.component, qty: l.qty, uom: l.uom,
    scrap_pct: l.scrap_pct, line_kind: l.line_kind, sort_order: i,
  }));
  const out = new Map<string, number>();
  for (const p of DEMO_PRODUCTS) {
    if (p.item_type !== "bom_kit") { if (p.cost !== undefined) out.set(p.sku, p.cost); continue; }
    const r = rollUpBom(p.sku, (id) => (bySku.has(id) ? asProduct(bySku.get(id)!) : undefined), (parent) => lines.filter((l) => l.parent_product_id === parent));
    if (r.incomplete) throw new Error(`The demo kit ${p.sku} does not roll up completely.`);
    out.set(p.sku, r.total);
  }
  return out;
}

// ── The product-based variant of the precast villa template ──────────────────

const G_STRUCTURE = "Structure (floors, beams, inner walls)";
const G_EXTERNAL = "External walls and parapet";
const G_STAIRS = "Stairs";
const G_BOUNDARY = "Boundary wall";
const G_JOINTS = "Joints and fixings";
const G_DELIVERY = "Delivery and erection";
const sub = (group: string) => `sub_${groupSlug(group)}`;

const product = (sku: string) => ({ kind: "product" as const, sku });

const RATES_KEPT = new Set([
  "concrete_density_t_m3", "wastage_pct", "concrete_cost_m3", "mould_cost_m3", "transport_load_capacity_t", "overhead_factor",
  "cap_cast_m3_per_day", "cap_trucks_loads_per_day", "cap_crane_m3_per_day", "transport_start_day", "erection_start_day",
]);

/** The starter's rate-priced rules that stay as they are (not a catalogue item). */
const KEEP_RULES = new Set(["fin", "mld", "ovh"]);

/**
 * The same precast villa, priced from the catalogue instead of blank rate lines: wall
 * panels, boundary wall and the frame come from BOM kits, slabs, stairs and parapets from
 * products, joints from consumables, transport and erection from services. Moulds, the
 * finish premium and the overhead stay on template rates (they are not catalogue items).
 * Quantities still come from the exact piece model; a few small rates convert piece
 * volumes to the unit the product is sold in (a slab is bought per m², not per m³).
 */
export function precastVillaProductTemplate(): StarterTemplate {
  const s = PRECAST_VILLA_STARTER;
  const keep = new Map(s.rules.filter((r) => KEEP_RULES.has(r.code)).map((r) => [r.code, r]));
  const rule = (r: TemplateRule): TemplateRule => r;

  const rules: TemplateRule[] = [
    // ── Structure ──
    rule({ code: "iw", group: G_STRUCTURE, description: "Internal wall panels", uom: "m2", qty: "vol_IW / iw_thickness_m", waste_pct: "wastage_pct", component: "materials", cost: product("PC-WALL-SOLID") }),
    rule({ code: "sl", group: G_STRUCTURE, description: "Hollow-core floor and roof slabs", uom: "m2", qty: "vol_SL / slab_equiv_thickness_m", waste_pct: "wastage_pct", component: "materials", cost: product("PC-HCS-200"), element_type: "slab" }),
    rule({ code: "fr", group: G_STRUCTURE, description: "Beams and columns", uom: "m3", qty: "vol_FR", waste_pct: "wastage_pct", component: "materials", cost: product("KIT-FRAME-M3"), element_type: "beam" }),
    // ── External walls and parapet ──
    rule({ code: "ew", group: G_EXTERNAL, description: "External wall panels (insulated)", uom: "m2", qty: "area_EW", waste_pct: "wastage_pct", component: "materials", cost: product("KIT-WALL-M2"), element_type: "wall_panel" }),
    rule({ code: "pr", group: G_EXTERNAL, description: "Parapet panels", uom: "lm", qty: "n_PR * panel_pitch_m", waste_pct: "wastage_pct", component: "materials", cost: product("PC-PARAPET"), element_type: "parapet_panel" }),
    keep.get("fin")!,
    // ── Stairs ──
    rule({ code: "st", group: G_STAIRS, description: "Stair flights", uom: "nr", qty: "n_ST", component: "materials", cost: product("PC-STAIR"), element_type: "stair" }),
    // ── Boundary wall ──
    rule({ code: "bw", group: G_BOUNDARY, description: "Boundary wall panels", uom: "m2", qty: "vol_BW / bw_thickness_m", waste_pct: "wastage_pct", component: "materials", cost: product("KIT-BOUNDARY-M2"), element_type: "boundary_panel" }),
    // ── Production: moulds stay a template rate ──
    keep.get("mld")!,
    // ── Joints and fixings (outside the overhead base) ──
    rule({ code: "plt", group: G_JOINTS, description: "Steel connection plates (one per piece)", uom: "nr", qty: "n_total", component: "materials", cost: product("BO-PLATE") }),
    rule({ code: "grt", group: G_JOINTS, description: "Grout for joints", uom: "bag", qty: "ceil(n_total / 4)", component: "materials", cost: product("CN-GROUT") }),
    rule({ code: "sea", group: G_JOINTS, description: "Sealant to external wall joints", uom: "lm", qty: "n_EW * wall_height_m", component: "materials", cost: product("CN-SEALANT") }),
    // ── Delivery and erection ──
    rule({ code: "trl", group: G_DELIVERY, description: "Transport to site (loads by weight)", uom: "trip", qty: "ceil(weight_total / transport_load_capacity_t)", component: "transport", cost: product("SV-TRANSPORT") }),
    rule({ code: "ere", group: G_DELIVERY, description: "Crane and erection crew (days by crane capacity)", uom: "day", qty: "ceil(vol_total / cap_crane_m3_per_day)", component: "erection", cost: product("SV-ERECT") }),
    // ── Overhead: a share of the factory-side cost ──
    keep.get("ovh")!,
  ];

  const conversion = [
    { key: "iw_thickness_m", label: "Internal wall panel thickness", unit: "m", value: 0.15 },
    { key: "slab_equiv_thickness_m", label: "Hollow-core slab: concrete per m² of slab", unit: "m", value: 0.124 },
    { key: "bw_thickness_m", label: "Boundary wall panel thickness", unit: "m", value: 0.1 },
    { key: "panel_pitch_m", label: "Parapet panel pitch", unit: "m", value: 2.4 },
  ];
  const rates = [...s.rates.filter((r) => RATES_KEPT.has(r.key)), ...conversion];

  const body: EstimateTemplateBody = { geometry: s.geometry, inputs: s.inputs, rates, rules };
  return {
    ...s,
    description:
      "ILLUSTRATIVE precast villa priced from the product catalogue: wall panels, the frame and the boundary wall come from BOM kits, slabs, stairs and parapets from products, transport and erection from services. All costs are placeholders to demonstrate the estimator, not any company's real prices or method. Duplicate it and point the rules at your own products.",
    ...body,
  };
}
