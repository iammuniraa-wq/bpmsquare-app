// Shared, client-safe enum lists + human labels for the pricing-engine
// ontology. Single source of truth for both the config mutation route
// (server-side validation) and the Advanced cockpit (structured forms) --
// previously each kept its own inline copy of the enum lists, a drift risk
// this removes. The labels exist purely for display: the wire format is
// always the raw enum value (PRICE, FIXED_AMOUNT, ...), never the label.

export const COMPONENT_ENUMS = {
  class: ["PRICE", "COST_BUILDUP", "MARKUP", "DISCOUNT", "SURCHARGE", "FREIGHT", "TAX", "REBATE_ACCRUAL", "STATISTICAL"],
  calc_type: ["FIXED_AMOUNT", "PERCENT", "PER_UNIT", "SCALE_TIERED", "SCALE_GRADUATED", "FORMULA", "COST_ROLLUP"],
  calc_basis: ["GROSS", "NET_SO_FAR", "QUANTITY", "WEIGHT", "SUBTOTAL_REF", "COST_REF", "CUSTOM_METRIC"],
  sign: ["POSITIVE", "NEGATIVE", "BOTH"],
  manual_override: ["FORBIDDEN", "ALLOWED_WITH_REASON", "FREE"],
  resolution_strategy: ["MOST_SPECIFIC", "BEST_FOR_CUSTOMER", "ALL_APPLY"],
} as const;

export const COST_INPUT_KINDS = ["MATERIAL", "LABOUR", "EQUIPMENT", "SALVAGE_CREDIT", "OVERHEAD", "INDEX"];

const LABELS: Record<string, string> = {
  PRICE: "Price", COST_BUILDUP: "Cost roll-up", MARKUP: "Markup", DISCOUNT: "Discount",
  SURCHARGE: "Surcharge", FREIGHT: "Freight", TAX: "Tax", REBATE_ACCRUAL: "Rebate accrual",
  STATISTICAL: "Statistical — shown in trace, never added to price",

  FIXED_AMOUNT: "Fixed amount", PERCENT: "Percent", PER_UNIT: "Per unit",
  SCALE_TIERED: "Volume-tiered (banded rate by quantity)", SCALE_GRADUATED: "Volume-graduated (each band priced separately)",
  FORMULA: "Formula", COST_ROLLUP: "Rolls up a cost model's inputs",

  GROSS: "Gross (before any deductions)", NET_SO_FAR: "Net so far (after earlier steps)",
  QUANTITY: "Line quantity", WEIGHT: "Line weight",
  SUBTOTAL_REF: "A named subtotal from an earlier step", COST_REF: "A cost model", CUSTOM_METRIC: "A custom metric",

  POSITIVE: "Always adds to the price", NEGATIVE: "Always subtracts from the price", BOTH: "Can add or subtract",

  FORBIDDEN: "Never editable by hand", ALLOWED_WITH_REASON: "Editable by hand, with a reason logged", FREE: "Freely editable by hand",

  MOST_SPECIFIC: "The most specific matching rule wins", BEST_FOR_CUSTOMER: "The best price for the customer wins",
  ALL_APPLY: "Every matching rule applies (stacks)",

  MATERIAL: "Material", LABOUR: "Labour", EQUIPMENT: "Equipment",
  SALVAGE_CREDIT: "Salvage credit", OVERHEAD: "Overhead", INDEX: "Index",
};

export function enumLabel(value: string): string {
  return LABELS[value] ?? value;
}
