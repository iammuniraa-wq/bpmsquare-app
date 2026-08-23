// Pricing setup wizard — starter templates for the four enterprise pricing
// methods (PROJECT.md §11 "Enterprise methods taxonomy", owner's frame,
// agreed 2026-08-16/17). Pure data + small formatting helpers: no framework
// imports, so both the wizard page (client) and any server-side seeding can
// import it. NOT part of src/lib/pricing-core (that boundary is CI-enforced
// and reserved for the engine itself) — this is authoring convenience that
// happens to reuse its types.
//
// A method here is just a starting shape for a DRAFT config version: picking
// one seeds dimensions/components/procedure/cost-model/starter rules that the
// wizard's later steps let the tenant edit before "Go live". All four methods
// coexist per tenant via Price Books (pricing_area) — nothing here prevents a
// tenant from running more than one.

import type {
  PriceComponent, PricingProcedure, CostModel, EntryMode, AttrValue,
} from "@/lib/pricing-core";

export type PricingMethodKey = "cost_based" | "price_list" | "value_based" | "variant";

export type StarterRule = {
  component_code: string;
  label: string;                      // shown in the wizard's "Numbers" step
  help?: string;
  match_attributes: Record<string, AttrValue>;
  value: number | null;               // sensible default — always tenant-editable before Go live
  unit: "currency" | "percent";
};

export type MethodTemplate = {
  key: PricingMethodKey;
  label: string;
  tagline: string;
  description: string;
  entryMode: EntryMode;
  dimensions: { attribute: string; weight: number; label: string }[];
  components: PriceComponent[];
  procedure: PricingProcedure;
  costModel?: CostModel;
  starterRules: StarterRule[];
};

const comp = (over: PriceComponent): PriceComponent => over;

// ── 1. Cost-based — "Cost simulator" (COST_UP) ──────────────────────────────
// Mirrors the Vikas cost-up shape (pricing-core calc.test.ts exit criterion
// 2): roll up material + labour into a total cost, mark up, discount, tax.

const COST_BASED: MethodTemplate = {
  key: "cost_based",
  label: "Cost-based",
  tagline: "Start from what it costs you, then mark up.",
  description:
    "Best when your price has to track real input costs — materials, labour, " +
    "equipment. You set the cost rates once; the margin on top is a single number.",
  entryMode: "COST_UP",
  dimensions: [
    { attribute: "customer.tier", weight: 30, label: "Customer tier" },
    { attribute: "region", weight: 20, label: "Region" },
    { attribute: "document_type", weight: 15, label: "Document type" },
  ],
  components: [
    comp({ code: "MATERIAL_COST", name: "Material cost", class: "COST_BUILDUP", calc_type: "COST_ROLLUP", calc_basis: "COST_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false }),
    comp({ code: "LABOUR_COST", name: "Labour cost", class: "COST_BUILDUP", calc_type: "COST_ROLLUP", calc_basis: "COST_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false }),
    comp({ code: "MARGIN_MARKUP", name: "Margin", class: "MARKUP", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "CUST_DISC", name: "Customer discount", class: "DISCOUNT", calc_type: "PERCENT", calc_basis: "NET_SO_FAR", sign: "NEGATIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "TAX", name: "Tax", class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false, rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  procedure: {
    procedure_id: "COST_SIMULATOR",
    entry_mode: "COST_UP",
    steps: [
      { step: 10, component: "MATERIAL_COST", cost_model: "STANDARD_COST", ...( { rollup_kind: "MATERIAL" } as object) },
      { step: 20, component: "LABOUR_COST", cost_model: "STANDARD_COST", ...( { rollup_kind: "LABOUR" } as object) },
      { step: 30, subtotal: "TOTAL_COST" },
      { step: 40, component: "MARGIN_MARKUP", calc_basis_ref: "TOTAL_COST" },
      { step: 50, subtotal: "NET_1" },
      { step: 60, component: "CUST_DISC" },
      { step: 70, subtotal: "NET_2" },
      { step: 80, component: "TAX", calc_basis_ref: "NET_2" },
      { step: 90, subtotal: "FINAL" },
    ],
  },
  costModel: {
    code: "STANDARD_COST",
    name: "Standard cost",
    inputs: [
      { path: "material.rate_per_unit", kind: "MATERIAL", value: 100 },
      { path: "labour.rate_per_hour", kind: "LABOUR", value: 450 },
    ],
  },
  starterRules: [
    { component_code: "MARGIN_MARKUP", label: "Margin on cost", match_attributes: {}, value: 25, unit: "percent" },
    { component_code: "CUST_DISC", label: "Standard customer discount", match_attributes: {}, value: 0, unit: "percent" },
    { component_code: "TAX", label: "Tax rate", match_attributes: {}, value: 18, unit: "percent" },
  ],
};

// ── 2. Price-list — multi-dimensional, most-specific-wins (LIST_DOWN) ──────
// Mirrors the SAP-style waterfall (calc.test.ts exit criterion 1): a list
// price, a customer discount, freight, tax.

const PRICE_LIST: MethodTemplate = {
  key: "price_list",
  label: "Price list",
  tagline: "One list price per customer group, most specific wins.",
  description:
    "Best when you sell from a catalog and different customer groups or regions " +
    "get different prices off the same list. Add a row per group; the most " +
    "specific match always wins — no ordering to think about.",
  entryMode: "LIST_DOWN",
  dimensions: [
    { attribute: "customer.id", weight: 100, label: "Specific customer" },
    { attribute: "customer.tier", weight: 30, label: "Customer tier" },
    { attribute: "region", weight: 20, label: "Region" },
    { attribute: "document_type", weight: 15, label: "Document type" },
  ],
  components: [
    comp({ code: "LIST_PRICE", name: "List price", class: "PRICE", calc_type: "PER_UNIT", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "CUST_DISC", name: "Customer discount", class: "DISCOUNT", calc_type: "PERCENT", calc_basis: "NET_SO_FAR", sign: "NEGATIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "FREIGHT", name: "Freight", class: "FREIGHT", calc_type: "FIXED_AMOUNT", calc_basis: "NET_SO_FAR", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "TAX", name: "Tax", class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false, rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  procedure: {
    procedure_id: "PRICE_LIST",
    entry_mode: "LIST_DOWN",
    steps: [
      { step: 10, component: "LIST_PRICE", required: true },
      { step: 20, component: "CUST_DISC", requirement: "dsl:ctx.customer.tier != null" },
      { step: 30, subtotal: "NET_1" },
      { step: 40, component: "FREIGHT" },
      { step: 50, subtotal: "NET_2" },
      { step: 60, component: "TAX", calc_basis_ref: "NET_2" },
      { step: 70, subtotal: "FINAL" },
    ],
  },
  starterRules: [
    { component_code: "LIST_PRICE", label: "List price", match_attributes: {}, value: 100, unit: "currency" },
    { component_code: "CUST_DISC", label: "Discount for Tier A customers", match_attributes: { "customer.tier": "A" }, value: 3, unit: "percent" },
    { component_code: "FREIGHT", label: "Standard freight", match_attributes: {}, value: 50, unit: "currency" },
    { component_code: "TAX", label: "Tax rate", match_attributes: {}, value: 18, unit: "percent" },
  ],
};

// ── 3. Value-based — adjustment sentences on value-driver dimensions ───────

const VALUE_BASED: MethodTemplate = {
  key: "value_based",
  label: "Value-based",
  tagline: "Adjust from a base value by what the customer values.",
  description:
    "Best when the same offering is worth more to some customers than others — " +
    "a use case, a segment, an urgency. You write plain adjustment sentences " +
    "on top of one base value instead of a full list per combination.",
  entryMode: "LIST_DOWN",
  dimensions: [
    { attribute: "customer.segment", weight: 40, label: "Customer segment" },
    { attribute: "use_case", weight: 35, label: "Use case" },
    { attribute: "document_type", weight: 15, label: "Document type" },
  ],
  components: [
    comp({ code: "BASE_VALUE", name: "Base value", class: "PRICE", calc_type: "PER_UNIT", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "ADJUSTMENT", name: "Value adjustment", class: "SURCHARGE", calc_type: "PERCENT", calc_basis: "NET_SO_FAR", sign: "BOTH", manual_override: "ALLOWED_WITH_REASON", is_statistical: false, resolution_strategy: "ALL_APPLY" }),
    comp({ code: "TAX", name: "Tax", class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false, rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  procedure: {
    procedure_id: "VALUE_BASED",
    entry_mode: "LIST_DOWN",
    steps: [
      { step: 10, component: "BASE_VALUE", required: true },
      { step: 20, component: "ADJUSTMENT" },
      { step: 30, subtotal: "NET_1" },
      { step: 40, component: "TAX", calc_basis_ref: "NET_1" },
      { step: 50, subtotal: "FINAL" },
    ],
  },
  starterRules: [
    { component_code: "BASE_VALUE", label: "Base value", match_attributes: {}, value: 100, unit: "currency" },
    { component_code: "ADJUSTMENT", label: "Premium for high-value use case", match_attributes: { use_case: "mission_critical" }, value: 15, unit: "percent" },
    { component_code: "TAX", label: "Tax rate", match_attributes: {}, value: 18, unit: "percent" },
  ],
};

// ── 4. Variant — configured products, options ALL_APPLY ────────────────────

const VARIANT: MethodTemplate = {
  key: "variant",
  label: "Variant",
  tagline: "A base model plus options that each add their own price.",
  description:
    "Best for configured products — one base model, and a menu of options a " +
    "customer picks from. Every option a line has adds its own price; there's " +
    "no single \"most specific\" winner because they all apply together.",
  entryMode: "LIST_DOWN",
  dimensions: [
    { attribute: "product.base_model", weight: 50, label: "Base model" },
    { attribute: "option.code", weight: 40, label: "Option" },
  ],
  components: [
    comp({ code: "BASE_PRICE", name: "Base price", class: "PRICE", calc_type: "PER_UNIT", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
    comp({ code: "OPTION_PRICE", name: "Option price", class: "PRICE", calc_type: "FIXED_AMOUNT", calc_basis: "NET_SO_FAR", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false, resolution_strategy: "ALL_APPLY" }),
    comp({ code: "TAX", name: "Tax", class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false, rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  procedure: {
    procedure_id: "VARIANT_PRICING",
    entry_mode: "LIST_DOWN",
    steps: [
      { step: 10, component: "BASE_PRICE", required: true },
      { step: 20, component: "OPTION_PRICE" },
      { step: 30, subtotal: "NET_1" },
      { step: 40, component: "TAX", calc_basis_ref: "NET_1" },
      { step: 50, subtotal: "FINAL" },
    ],
  },
  starterRules: [
    { component_code: "BASE_PRICE", label: "Base model price", match_attributes: {}, value: 1000, unit: "currency" },
    { component_code: "OPTION_PRICE", label: "Add-on option price", match_attributes: { "option.code": "PREMIUM_FINISH" }, value: 150, unit: "currency" },
    { component_code: "TAX", label: "Tax rate", match_attributes: {}, value: 18, unit: "percent" },
  ],
};

export const PRICING_METHODS: MethodTemplate[] = [COST_BASED, PRICE_LIST, VALUE_BASED, VARIANT];

export function getMethodTemplate(key: PricingMethodKey): MethodTemplate {
  const found = PRICING_METHODS.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown pricing method "${key}"`);
  return found;
}

/**
 * Identifies which method template a loaded config-version snapshot was
 * built from, by matching its first procedure's code + entry mode against
 * the templates' own procedure_id/entryMode. Shared by every wizard-aware
 * screen (setup, Today's rates, History) so "what method is this" is
 * computed exactly once rather than three times with a chance to drift.
 * Returns null for a snapshot this wizard didn't create (hand-edited in
 * Advanced) — callers fall back to a generic/JSON view in that case.
 */
export function matchMethodTemplate(procedures: { code: string; entry_mode: string }[]): MethodTemplate | null {
  const proc = procedures[0];
  if (!proc) return null;
  return PRICING_METHODS.find((t) => t.procedure.procedure_id === proc.code && t.entryMode === proc.entry_mode) ?? null;
}

// ── Draft-seeding mutations ─────────────────────────────────────────────────
// Ordered list of POST /api/settings/pricing-engine/config bodies that build
// a template out on a fresh DRAFT version. Dimensions are version-independent
// (no `version` field); components/cost model/procedure are version-scoped.
// Rules are deliberately NOT included here — the wizard's "Numbers" step
// collects the tenant's own values (starterRules are just its defaults) and
// submits them itself, one rule mutation per number the tenant confirms.

export type ConfigMutation = {
  entity: "dimension" | "component" | "procedure" | "cost_model";
  op: "upsert";
  version?: number;
  area?: string;
  data: Record<string, unknown>;
};

export function templateMutations(template: MethodTemplate, version: number, area = "default"): ConfigMutation[] {
  const mutations: ConfigMutation[] = [];
  for (const dim of template.dimensions) {
    mutations.push({ entity: "dimension", op: "upsert", area, data: { attribute: dim.attribute, weight: dim.weight, label: dim.label } });
  }
  if (template.costModel) {
    mutations.push({ entity: "cost_model", op: "upsert", version, area, data: { code: template.costModel.code, name: template.costModel.name } });
  }
  for (const component of template.components) {
    mutations.push({ entity: "component", op: "upsert", version, area, data: { ...component } });
  }
  mutations.push({
    entity: "procedure", op: "upsert", version, area,
    data: { code: template.procedure.procedure_id, name: template.label, entry_mode: template.procedure.entry_mode, steps: template.procedure.steps },
  });
  return mutations;
}

// ── Plain-language rule sentences ───────────────────────────────────────────
// Turns a rule's match_attributes + value into the "adjustment sentence" the
// owner's UX doctrine calls for (PROJECT.md §11.3: "adjustment sentences on
// value-driver dimensions", never raw JSON). Shared by the setup wizard and
// the Today's rates read view so the phrasing never drifts between the two.

function formatDimensionLabel(template: MethodTemplate, attribute: string): string {
  return template.dimensions.find((d) => d.attribute === attribute)?.label ?? attribute;
}

function formatValue(value: number | null, unit: "currency" | "percent"): string {
  if (value === null) return "a scale";
  return unit === "percent" ? `${value}%` : value.toLocaleString();
}

export function describeCondition(template: MethodTemplate, matchAttributes: Record<string, AttrValue>): string {
  const entries = Object.entries(matchAttributes);
  if (entries.length === 0) return "For everyone";
  const parts = entries.map(([attr, val]) => `${formatDimensionLabel(template, attr)} is ${val}`);
  return `When ${parts.join(" and ")}`;
}

export function describeStarterRule(template: MethodTemplate, rule: StarterRule): string {
  const componentName = template.components.find((c) => c.code === rule.component_code)?.name ?? rule.component_code;
  return `${describeCondition(template, rule.match_attributes)} → ${componentName}: ${formatValue(rule.value, rule.unit)}`;
}

// ── Sample document for the wizard's "Sample bill" step ─────────────────────
// A single synthetic line so a tenant can see what the numbers they just
// entered actually produce, before going live. COST_UP methods need
// cost_items (one unit of each cost input the template's cost model
// defines); everything else just needs a quantity.

export function sampleDocumentLine(template: MethodTemplate, quantity: number) {
  if (template.entryMode === "COST_UP" && template.costModel) {
    return {
      line_no: 10,
      quantity,
      cost_items: template.costModel.inputs.map((input) => ({ path: input.path, qty: 1 })),
    };
  }
  return { line_no: 10, quantity };
}
