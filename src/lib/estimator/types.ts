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
export type TemplateInputOption = { key: string; label: string; value: number };

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
};

/** A named constant: usable as an identifier in any formula AND as the unit
 *  cost of a rule line (`cost: { kind: "rate", rate: key }`). */
export type TemplateRate = {
  key: string;
  label: string;
  unit: string;
  value: number;
};

export type TemplateRuleCost =
  /** Catalogue product by SKU; priced by the pricing engine (phase E2). */
  | { kind: "product"; sku: string }
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

export type EstimateTemplateBody = {
  /** Geometry module key (e.g. "precast_villa"): the template's pieces, 3D
   *  model and vol_/n_/area_ identifiers come from it. Absent = formula-only. */
  geometry?: string;
  inputs: TemplateInput[];
  rates: TemplateRate[];
  rules: TemplateRule[];
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
