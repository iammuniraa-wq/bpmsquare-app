// Pricing setup wizard — starter templates for the four enterprise pricing
// methods (PROJECT.md §11 "Enterprise methods taxonomy", owner's frame,
// agreed 2026-08-16/17). Pure data + small formatting helpers: no framework
// imports, so both the wizard page (client) and any server-side seeding can
// import it. NOT part of src/lib/pricing-core (that boundary is CI-enforced
// and reserved for the engine itself) — this is authoring convenience that
// happens to reuse its types.
//
// A method here is just a starting shape for a DRAFT config version: picking
// one seeds dimensions/components/procedure/cost-model that the wizard's
// later steps let the tenant edit before "Go live". All four methods coexist
// per tenant via Price Books (pricing_area) — nothing here prevents a tenant
// from running more than one.
//
// A price element is never one flat number for every customer -- real B2B
// margin/discount/price varies by segment, region, product line, deal size
// (the SAP "condition table" / access-sequence pattern, and every modern
// pricing tool's segmented price bands). The engine already supports this
// fully: PriceRule.match_attributes on any combination of DimensionRegistry
// attributes, resolved most-specific-wins. What used to be a single
// StarterRule per component here is now an EditableComponent whose rate
// table can carry any number of RateRows, each independently conditioned.

import type {
  PriceComponent, PricingProcedure, CostModel, EntryMode, AttrValue,
} from "@/lib/pricing-core";

export type PricingMethodKey = "cost_based" | "price_list" | "value_based" | "variant";

export type ScaleEntry = { from: number; value: number };

export type RateRow = {
  id?: string;
  match_attributes: Record<string, AttrValue>;
  value: number | null;       // flat components (calc_type PERCENT / FIXED_AMOUNT)
  tiers?: ScaleEntry[];       // volume-tiered components (calc_type SCALE_TIERED) — at least one band
};

export type EditableComponent = {
  component_code: string;
  label: string;
  help?: string;
  unit: "currency" | "percent";
  /** Dimensions this component's rate table may condition on (a subset of
   * the template's own DimensionRegistry) -- e.g. margin by tier + region. */
  factors: string[];
  /** True for a component whose calc_type is SCALE_TIERED (calc_basis
   * QUANTITY/WEIGHT) -- a genuine "the more they buy, the better the unit
   * rate" ladder. Deliberately NOT offered for percent-of-subtotal
   * components (margin, discount, tax): the engine's SCALE_TIERED picks a
   * band by the basis value and, for a non-quantity/weight basis, returns
   * that band's number AS THE AMOUNT rather than as a percent applied to
   * the basis -- so "margin % tiered by deal size" needs a FORMULA + scale()
   * DSL combination, not this. Tracked as follow-up, not faked here. */
  tiered: boolean;
  defaultRows: RateRow[];
};

/** A margin floor check: a purely statistical component storing the
 * tenant's minimum acceptable margin, surfaced as a warning on the Sample
 * bill (actual margin = revenueSubtotal - costSubtotal, compared against the
 * stored floor) -- never a hard block, since approval routing on a breach
 * is Phase 2 (PROJECT.md §11 Governance) and not built yet. Only offered
 * for methods with a real cost basis to floor against. */
export type MarginGuardrail = {
  componentCode: string;
  costSubtotal: string;
  revenueSubtotal: string;
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
  editableComponents: EditableComponent[];
  marginGuardrail?: MarginGuardrail;
};

const comp = (over: PriceComponent): PriceComponent => over;

// ── 1. Cost-based — "Cost simulator" (COST_UP) ──────────────────────────────
// Mirrors the Vikas cost-up shape (pricing-core calc.test.ts exit criterion
// 2): roll up material + labour into a total cost, mark up, discount, tax.
// Margin is conditioned on tier/region/document type, and a minimum-margin
// guardrail flags a breach on the Sample bill.

const COST_BASED_FACTORS = ["customer.tier", "region", "document_type"];

const COST_BASED: MethodTemplate = {
  key: "cost_based",
  label: "Cost-based",
  tagline: "Start from what it costs you, then mark up — by segment, not one number for everyone.",
  description:
    "Best when your price has to track real input costs — materials, labour, " +
    "equipment. Margin can vary by customer tier, region or document type, " +
    "and you can set a floor below which a quote should never go.",
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
    comp({ code: "MARGIN_FLOOR", name: "Minimum acceptable margin", class: "STATISTICAL", calc_type: "FIXED_AMOUNT", calc_basis: "GROSS", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: true }),
    comp({ code: "TAX", name: "Tax", class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE", manual_override: "FORBIDDEN", is_statistical: false, rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  procedure: {
    procedure_id: "COST_SIMULATOR",
    entry_mode: "COST_UP",
    steps: [
      { step: 10, component: "MATERIAL_COST", cost_model: "STANDARD_COST", ...( { rollup_kind: "MATERIAL" } as object) },
      { step: 20, component: "LABOUR_COST", cost_model: "STANDARD_COST", ...( { rollup_kind: "LABOUR" } as object) },
      { step: 30, subtotal: "TOTAL_COST" },
      { step: 35, component: "MARGIN_FLOOR", statistical: true },
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
  editableComponents: [
    {
      component_code: "MARGIN_MARKUP", label: "Margin", unit: "percent",
      factors: COST_BASED_FACTORS, tiered: false,
      defaultRows: [{ match_attributes: {}, value: 25 }],
    },
    {
      component_code: "CUST_DISC", label: "Customer discount", unit: "percent",
      factors: COST_BASED_FACTORS, tiered: false,
      defaultRows: [{ match_attributes: {}, value: 0 }],
    },
    {
      component_code: "MARGIN_FLOOR", label: "Minimum acceptable margin", unit: "percent",
      help: "Warns on the sample bill (and later, any quote) when a price would fall below this — never blocks on its own.",
      factors: [], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 15 }],
    },
    {
      component_code: "TAX", label: "Tax", unit: "percent",
      factors: [], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 18 }],
    },
  ],
  marginGuardrail: { componentCode: "MARGIN_FLOOR", costSubtotal: "TOTAL_COST", revenueSubtotal: "NET_1" },
};

// ── 2. Price-list — multi-dimensional, most-specific-wins (LIST_DOWN) ──────
// Mirrors the SAP-style waterfall (calc.test.ts exit criterion 1): a list
// price, a customer discount, freight, tax. List price is volume-tiered
// (a genuine per-unit break — SCALE_TIERED against calc_basis QUANTITY).

const PRICE_LIST_FACTORS = ["customer.id", "customer.tier", "region", "document_type"];

const PRICE_LIST: MethodTemplate = {
  key: "price_list",
  label: "Price list",
  tagline: "One list price per customer group, most specific wins.",
  description:
    "Best when you sell from a catalog and different customer groups or regions " +
    "get different prices off the same list. Add a row per group; the most " +
    "specific match always wins — no ordering to think about. List price can " +
    "also step down by order volume.",
  entryMode: "LIST_DOWN",
  dimensions: [
    { attribute: "customer.id", weight: 100, label: "Specific customer" },
    { attribute: "customer.tier", weight: 30, label: "Customer tier" },
    { attribute: "region", weight: 20, label: "Region" },
    { attribute: "document_type", weight: 15, label: "Document type" },
  ],
  components: [
    comp({ code: "LIST_PRICE", name: "List price", class: "PRICE", calc_type: "SCALE_TIERED", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
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
  editableComponents: [
    {
      component_code: "LIST_PRICE", label: "List price", unit: "currency",
      factors: PRICE_LIST_FACTORS, tiered: true,
      defaultRows: [{ match_attributes: {}, value: null, tiers: [{ from: 0, value: 100 }] }],
    },
    {
      component_code: "CUST_DISC", label: "Customer discount", unit: "percent",
      factors: PRICE_LIST_FACTORS, tiered: false,
      defaultRows: [
        { match_attributes: { "customer.tier": "A" }, value: 3 },
        { match_attributes: {}, value: 0 },
      ],
    },
    {
      component_code: "FREIGHT", label: "Freight", unit: "currency",
      factors: ["region"], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 50 }],
    },
    {
      component_code: "TAX", label: "Tax", unit: "percent",
      factors: [], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 18 }],
    },
  ],
};

// ── 3. Value-based — adjustment sentences on value-driver dimensions ───────

const VALUE_BASED_FACTORS = ["customer.segment", "use_case", "document_type"];

const VALUE_BASED: MethodTemplate = {
  key: "value_based",
  label: "Value-based",
  tagline: "Adjust from a base value by what the customer values.",
  description:
    "Best when the same offering is worth more to some customers than others — " +
    "a use case, a segment, an urgency. Write one adjustment sentence per " +
    "situation on top of a base value instead of a full list per combination.",
  entryMode: "LIST_DOWN",
  dimensions: [
    { attribute: "customer.segment", weight: 40, label: "Customer segment" },
    { attribute: "use_case", weight: 35, label: "Use case" },
    { attribute: "document_type", weight: 15, label: "Document type" },
  ],
  components: [
    comp({ code: "BASE_VALUE", name: "Base value", class: "PRICE", calc_type: "SCALE_TIERED", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
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
  editableComponents: [
    {
      component_code: "BASE_VALUE", label: "Base value", unit: "currency",
      factors: VALUE_BASED_FACTORS, tiered: true,
      defaultRows: [{ match_attributes: {}, value: null, tiers: [{ from: 0, value: 100 }] }],
    },
    {
      component_code: "ADJUSTMENT", label: "Value adjustment", unit: "percent",
      help: "Positive = premium, negative = discount — signed because it can go either way.",
      factors: VALUE_BASED_FACTORS, tiered: false,
      defaultRows: [
        { match_attributes: { use_case: "mission_critical" }, value: 15 },
        { match_attributes: {}, value: 0 },
      ],
    },
    {
      component_code: "TAX", label: "Tax", unit: "percent",
      factors: [], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 18 }],
    },
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
    comp({ code: "BASE_PRICE", name: "Base price", class: "PRICE", calc_type: "SCALE_TIERED", calc_basis: "QUANTITY", sign: "POSITIVE", manual_override: "ALLOWED_WITH_REASON", is_statistical: false }),
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
  editableComponents: [
    {
      component_code: "BASE_PRICE", label: "Base model price", unit: "currency",
      factors: ["product.base_model"], tiered: true,
      defaultRows: [{ match_attributes: {}, value: null, tiers: [{ from: 0, value: 1000 }] }],
    },
    {
      component_code: "OPTION_PRICE", label: "Option price", unit: "currency",
      factors: ["option.code"], tiered: false,
      defaultRows: [{ match_attributes: { "option.code": "PREMIUM_FINISH" }, value: 150 }],
    },
    {
      component_code: "TAX", label: "Tax", unit: "percent",
      factors: [], tiered: false,
      defaultRows: [{ match_attributes: {}, value: 18 }],
    },
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

// ── Price Book (pricing_area) naming ────────────────────────────────────────
// A pricing_area is just a text key -- there's no separate display-name
// column, so a tenant-typed label ("Service parts") IS slugified into the
// key ("service_parts") and the key is humanized back for display. Shared so
// the picker, the "+ New price book" prompt and every page's URL param all
// agree on the same shape.

export function slugifyAreaLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function humanizeArea(area: string): string {
  if (area === "default") return "Default";
  return area.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// ── Draft-seeding mutations ─────────────────────────────────────────────────
// Ordered list of POST /api/settings/pricing-engine/config bodies that build
// a template out on a version. Dimensions are version-independent (no
// `version` field); components/cost model shell/procedure are version-scoped
// and safely re-syncable (the config route upserts all three on
// tenant_id+config_version+code). Rules are deliberately NOT included here —
// the wizard's "Numbers" step collects the tenant's own rate table
// (defaultRows are just its seed) and submits each row itself.
//
// Cost input RATES are handled separately (missingCostInputMutations, below)
// rather than folded into this function: pricing_cost_inputs has no
// config_version column at all (spec §3 -- "cost inputs resolve by
// effective date only", shared across every version/draft of a tenant's
// cost model) and the config route's cost_input case is a plain
// insert/update-by-id, not an upsert keyed on (cost_model_code, path). If
// this function re-pushed them on every draft resume the way it does the
// version-scoped entities, a tenant would accumulate duplicate rate rows
// with identical (null) valid_from every time they reopened Pricing setup
// -- which the engine correctly refuses to resolve (AMBIGUOUS_COST_INPUT)
// rather than silently picking one.

export type ConfigMutation = {
  entity: "dimension" | "component" | "procedure" | "cost_model" | "cost_input";
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

/**
 * Seeds a cost model's starter rates, but ONLY for (cost_model_code, path)
 * pairs that don't already have a rate on file for this tenant -- pass in
 * whatever pricing_cost_inputs rows the caller already has (any version's
 * snapshot carries the full tenant-wide list, since these aren't
 * version-scoped). Safe to call on every entry into the wizard: a brand-new
 * cost model gets its full starter rate sheet, an already-seeded one (from
 * an earlier draft, or a rate an admin has since edited) is left untouched
 * rather than duplicated.
 */
export function missingCostInputMutations(
  template: MethodTemplate,
  existingCostInputs: { cost_model_code: string; path: string }[],
  area = "default"
): ConfigMutation[] {
  if (!template.costModel) return [];
  const have = new Set(existingCostInputs.filter((i) => i.cost_model_code === template.costModel!.code).map((i) => i.path));
  return template.costModel.inputs
    .filter((input) => !have.has(input.path))
    .map((input) => ({
      entity: "cost_input" as const, op: "upsert" as const, area,
      data: { cost_model_code: template.costModel!.code, path: input.path, kind: input.kind, value: input.value, uom: input.uom ?? null, currency: input.currency ?? null },
    }));
}

// ── Plain-language rule sentences ───────────────────────────────────────────
// Turns a rule's match_attributes into the "adjustment sentence" the owner's
// UX doctrine calls for (PROJECT.md §11.3: "adjustment sentences on
// value-driver dimensions", never raw JSON). Shared by the setup wizard and
// every read view so the phrasing never drifts between them.

function formatDimensionLabel(template: MethodTemplate, attribute: string): string {
  return template.dimensions.find((d) => d.attribute === attribute)?.label ?? attribute;
}

export function describeCondition(template: MethodTemplate, matchAttributes: Record<string, AttrValue>): string {
  const entries = Object.entries(matchAttributes);
  if (entries.length === 0) return "Everyone else";
  const parts = entries.map(([attr, val]) => `${formatDimensionLabel(template, attr)} is ${val}`);
  return `When ${parts.join(" and ")}`;
}

export function formatRateValue(value: number | null, unit: "currency" | "percent"): string {
  if (value === null) return "—";
  return unit === "percent" ? `${value}%` : value.toLocaleString();
}

export function formatTiers(tiers: ScaleEntry[] | null | undefined, unit: "currency" | "percent"): string {
  if (!tiers || tiers.length === 0) return "—";
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  return sorted
    .map((t, i) => {
      const next = sorted[i + 1];
      const range = next ? `${t.from.toLocaleString()}–${(next.from - 1).toLocaleString()}` : `${t.from.toLocaleString()}+`;
      return `${range}: ${formatRateValue(t.value, unit)}`;
    })
    .join(" · ");
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
