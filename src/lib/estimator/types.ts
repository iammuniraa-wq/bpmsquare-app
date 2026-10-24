// Shared shapes for the Project Estimator (docs/estimator-architecture.md).
// Pure types and constants only -- no "server-only", no I/O -- so the
// formula engine, the compute pipeline and the client screens can all import
// them. Template shapes are what lives in estimate_templates' jsonb columns
// (migration 0131).

/** The cost build-up buckets (architecture §4). Every rule line carries one. */
export const ESTIMATE_COMPONENTS = [
  "materials", "moulds", "labour", "overhead", "transport", "erection", "other",
] as const;
export type EstimateComponent = (typeof ESTIMATE_COMPONENTS)[number];

export const ESTIMATE_COMPONENT_LABEL: Record<EstimateComponent, string> = {
  materials: "Materials",
  moulds: "Moulds and formwork",
  labour: "Production labour",
  overhead: "Factory and yard overhead",
  transport: "Transport",
  erection: "Erection",
  other: "Other",
};

export type TemplateInputType = "number" | "select" | "boolean";

/** A select option carries the number a formula sees when it is chosen, so
 *  the formula language can stay numbers-only: `finish_level == 2`. */
export type TemplateInputOption = {
  key: string;
  label: string;
  value: number;
  /** Catalogue attributes this choice stands for (e.g. { pipe_class: "SS20" }). A product rule
   *  that lists the input in its `match.from` looks for a product with these attributes. */
  attrs?: Record<string, string>;
  /** Design attribute: a material key (materialCatalog.ts) or "#rrggbb" this choice paints on the input's `paints` slot. */
  visual?: string;
};

export type TemplateInput = {
  /** Formula identifier: lower snake_case. */
  key: string;
  label: string;
  type: TemplateInputType;
  /** number -> number, select -> the default option's key, boolean -> boolean. */
  default: number | string | boolean;
  min?: number;
  max?: number;
  /** select only. */
  options?: TemplateInputOption[];
  unit?: string;
  help?: string;
  /** Card the input form groups this under. */
  section?: string;
  /** select only: quote every option as an alternative (e.g. finish levels)
   *  instead of only the chosen one. Read by the quote assembler. */
  quote_alternatives?: boolean;
  /** select only: the geometry design slot (GeometryModule.slots) this input repaints; its options carry `visual`. */
  paints?: string;
};

/** A named constant: usable as an identifier in any formula AND as the unit
 *  cost of a rule line (`cost: { kind: "rate", rate: key }`). */
export type TemplateRate = {
  key: string;
  label: string;
  unit: string;
  value: number;
  /** Optional risk range (Simulation, architecture doc section 10): the cheapest and the dearest this
   *  rate is expected to be. Both or neither; low <= value <= high. The
   *  formula engine ignores them. */
  low?: number;
  high?: number;
};

/** A product named by attributes of `products.custom_data` instead of a SKU (productMatch.ts). */
export type ProductMatch = {
  /** Attributes that must equal these text values, e.g. { fence_kind: "line_post" }. */
  attrs: Record<string, string>;
  /** Select inputs whose chosen option's `attrs` are added to the attributes. */
  from?: string[];
};

export type TemplateRuleCost =
  /** A catalogue product named by its SKU or by its product reference (PRD-0012),
   *  or by attributes (`match`): at least one of the three. Resolved to a product per
   *  tenant when the estimate is calculated; a BOM / kit product is costed from its
   *  rolled-up components. A rule that names several looks the SKU up first, then the
   *  reference, then the attributes. */
  | { kind: "product"; sku?: string; ref?: string; match?: ProductMatch }
  /** A template rate (rate key) times the quantity. */
  | { kind: "rate"; rate: string };

export type TemplateRule = {
  /** Unique, lower snake_case; `qty_<code>` is this line's net quantity. */
  code: string;
  /** Display group; `sub_<slug(group)>` is its running cost subtotal. */
  group: string;
  description: string;
  uom: string;
  /** Formula for the NET quantity. */
  qty: string;
  /** Waste as a percent, a plain number or a formula. Default 0. */
  waste_pct?: number | string;
  component: EstimateComponent;
  cost: TemplateRuleCost;
  /** Element type (schedule import): rows of this type supply this line's
   *  quantity instead of the `qty` formula. */
  element_type?: string;
};

export type QuoteGranularity = "group" | "line";

/** What a DXF drawing measures into one input of a template (drawing intake): lengths and areas by layer, counts by block. */
export type DrawingMeasure = "length_m" | "area_m2" | "count";
export type DrawingMapRule = {
  /** The template input that receives the measured number. */
  input: string;
  measure: DrawingMeasure;
  /** Layers whose lines / closed shapes are summed (length_m, area_m2) or whose block inserts are counted (count). Case-insensitive. */
  layers?: string[];
  /** count only: block names counted (case-insensitive); empty = every insert on the layers. */
  blocks?: string[];
  /** Multiplier from drawing units to the input's unit when the drawing's own units are missing or wrong. */
  scale?: number;
};

export type EstimateTemplateBody = {
  /** Geometry module key (e.g. "precast_villa"): the template's pieces, 3D
   *  model and vol_/n_/area_ identifiers come from it. Absent = formula-only. */
  geometry?: string;
  inputs: TemplateInput[];
  rates: TemplateRate[];
  rules: TemplateRule[];
  /** Drawing intake (0215): which DXF layers feed which number input. Absent = none. */
  drawing_map?: DrawingMapRule[];
};

export type EstimateLineSource = "rule" | "schedule" | "manual";

/** Group display name -> identifier-safe slug used in `sub_<slug>`. */
export function groupSlug(group: string): string {
  return group
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
