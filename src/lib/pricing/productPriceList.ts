// A product's own price list as an engine rule (docs/pricing-engine-
// architecture.md §21). The product carries its list price and its quantity
// breaks (replicated from the ERP or kept here); when the routed Price Book
// has a quantity-scaled PRICE component and none of its own rules speaks for
// this product, the line gets ONE synthesised rule for the call, so nobody
// re-keys a price list as rules. Pure: no database, no framework imports.

import type { DimensionRegistry, PriceComponent, PriceRule } from "@/lib/pricing-core";
import { parseQtyBreaks } from "@/lib/products/qtyBreaks";

export type PriceListProduct = {
  id: string;
  sku?: string | null;
  name?: string | null;
  list_price?: number | null;
  qty_breaks?: unknown;
};

const RULE_ID = /^product:(.+):price-list$/;

export const productPriceListRuleId = (productId: string) => `product:${productId}:price-list`;
export const isProductPriceListRuleId = (ruleId: string | undefined | null): boolean => !!ruleId && RULE_ID.test(ruleId);

/** The PRICE component the product's list is poured into: quantity-scaled
 *  (SCALE_TIERED against QUANTITY), the Price list template's LIST_PRICE. */
export function priceListComponent(components: PriceComponent[]): PriceComponent | null {
  return components.find((c) => c.class === "PRICE" && c.calc_type === "SCALE_TIERED" && c.calc_basis === "QUANTITY") ?? null;
}

/** A book rule "speaks for" the product when it names it: by id, by SKU, or
 *  by the product's name (the base_model dimension the catalogue books use). */
function ruleNamesProduct(rule: PriceRule, product: PriceListProduct): boolean {
  const m = rule.match_attributes;
  if (m["product.id"] === product.id) return true;
  if (product.sku && m["product.sku"] === product.sku) return true;
  if (product.name && m["product.base_model"] === product.name) return true;
  return false;
}

/**
 * The synthesised rule for one product, or null when nothing should be
 * injected: no quantity-scaled PRICE component in the book, no list price on
 * the product, or a book rule for that component already names the product
 * (the book's own rules always win -- the tenant's explicit configuration is
 * never second-guessed by catalogue data).
 */
export function productPriceListRule(
  book: { components: PriceComponent[]; rules: PriceRule[] },
  product: PriceListProduct
): PriceRule | null {
  const component = priceListComponent(book.components);
  if (!component) return null;
  const list = typeof product.list_price === "number" ? product.list_price : Number(product.list_price);
  if (!Number.isFinite(list) || list <= 0) return null;
  if (book.rules.some((r) => r.component_code === component.code && ruleNamesProduct(r, product))) return null;

  const bands = parseQtyBreaks(product.qty_breaks).filter((b) => b.rate !== null) as { from: number; rate: number }[];
  return {
    rule_id: productPriceListRuleId(product.id),
    component_code: component.code,
    match_attributes: { "product.id": product.id },
    value: null,
    scale: { entries: [{ from: 0, value: list }, ...bands.map((b) => ({ from: b.from, value: b.rate }))] },
    formula: null,
    currency: null,
    uom: null,
    valid_from: null,
    valid_to: null,
    created_at: null,
  };
}

/** The weight an attribute that is not in the tenant's registry gets when a
 *  synthesised rule uses it: one above the heaviest dimension of the same
 *  family ("product.*"), so the product's own list outranks a category or
 *  model grouping but still loses to a named customer. */
export function extraDimensionWeight(attribute: string, registry: DimensionRegistry): number {
  const family = `${attribute.split(".")[0]}.`;
  const weights = Object.entries(registry).filter(([k]) => k.startsWith(family)).map(([, w]) => w);
  return (weights.length > 0 ? Math.max(...weights) : 0) + 1;
}
