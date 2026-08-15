// PricingEngine domain types (spec §2–§4). Pure data — the persistence layer
// maps DB rows into these shapes; the core never sees a database.

export type ComponentClass =
  | "PRICE" | "COST_BUILDUP" | "MARKUP" | "DISCOUNT" | "SURCHARGE"
  | "FREIGHT" | "TAX" | "REBATE_ACCRUAL" | "STATISTICAL";

export type CalcType =
  | "FIXED_AMOUNT" | "PERCENT" | "PER_UNIT"
  | "SCALE_TIERED" | "SCALE_GRADUATED" | "FORMULA" | "COST_ROLLUP";

export type CalcBasis =
  | "GROSS" | "NET_SO_FAR" | "QUANTITY" | "WEIGHT"
  | "SUBTOTAL_REF" | "COST_REF" | "CUSTOM_METRIC";

export type Sign = "POSITIVE" | "NEGATIVE" | "BOTH";
export type ManualOverride = "FORBIDDEN" | "ALLOWED_WITH_REASON" | "FREE";
export type ResolutionStrategy = "MOST_SPECIFIC" | "BEST_FOR_CUSTOMER" | "ALL_APPLY";

export type RoundingRule = {
  precision: number;                       // decimal places
  mode: "HALF_UP" | "COMMERCIAL";
  charm?: "END_99" | "END_95" | null;
};

export type PriceComponent = {
  code: string;
  name: string;
  class: ComponentClass;
  calc_type: CalcType;
  calc_basis: CalcBasis;
  sign: Sign;
  rounding_rule?: RoundingRule | null;
  manual_override: ManualOverride;
  is_statistical: boolean;
  resolution_strategy?: ResolutionStrategy; // default MOST_SPECIFIC
};

export type ProcedureStep = {
  step: number;
  component?: string;                      // component code — either this or subtotal
  subtotal?: string;                       // named subtotal accumulator
  required?: boolean;
  requirement?: string;                    // "dsl:<expr>" gate
  exclusion_group?: string;
  calc_basis_ref?: string;                 // subtotal name used as basis
  cost_model?: string;                     // for COST_ROLLUP steps
  statistical?: boolean;
  formula?: string;                        // step-level formula override
};

export type EntryMode = "LIST_DOWN" | "COST_UP";

export type PricingProcedure = {
  procedure_id: string;
  entry_mode: EntryMode;
  steps: ProcedureStep[];
};

/** Scalar attribute values a rule may match on / a context may carry. */
export type AttrValue = string | number | boolean;

export type ScaleTable = { entries: { from: number; value: number }[]; scale_basis?: string };

export type PriceRule = {
  rule_id: string;
  component_code: string;
  match_attributes: Record<string, AttrValue>;
  value: number | null;                    // amount / percent (null when scale/formula carries it)
  scale?: ScaleTable | null;
  formula?: string | null;
  currency?: string | null;
  uom?: string | null;
  valid_from?: string | null;              // ISO yyyy-mm-dd inclusive
  valid_to?: string | null;                // ISO yyyy-mm-dd inclusive
  created_at?: string | null;              // ISO timestamp — final tie-break
};

/**
 * DimensionRegistry (spec §4): the attributes usable in rule matching, each
 * with a specificity weight. `document_type` is a conventional dimension so
 * in-app consumers (quote, standard_quote, service_order, work_order, wfm_ot)
 * can carry per-module rules with zero schema change (spec §11.2 client #3).
 */
export type DimensionRegistry = Record<string, number>;

export type CostInputKind = "MATERIAL" | "LABOUR" | "EQUIPMENT" | "SALVAGE_CREDIT" | "OVERHEAD" | "INDEX";

export type CostInput = {
  path: string;                            // e.g. "material.copper_per_kg"
  kind: CostInputKind;
  value: number;
  uom?: string | null;
  currency?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type CostModel = {
  code: string;
  name: string;
  inputs: CostInput[];
};
