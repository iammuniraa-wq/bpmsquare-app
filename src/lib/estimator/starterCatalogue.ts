// The catalogue items the GCC starter templates (pipes, precast elements, civil basics) price their materials from.
// Pure data and pure helpers: no I/O, no "server-only", so the template files, the seed generator, the install step
// and the rate-sheet import all read one list.
//
// EVERY COST HERE IS AN ILLUSTRATIVE PLACEHOLDER, in no particular currency. The item is marked so in the catalogue:
//   - its name ends " (illustrative)" (the estimate shows the product name on the line),
//   - custom_data.illustrative is true and custom_data.cost_source says "Illustrative placeholder",
//   - cost_price_as_of is empty (an undated cost reads as stale to the BOQ price sources).
// Importing a rate sheet (Settings > Estimate templates) replaces the cost, stamps the date and source, drops the suffix and
// the flag (rateSheet/plan.ts). A workspace that never imports keeps pricing from the placeholders, visibly.
//
// A template rule finds its item by SKU, or by the tags in `attrs` (custom_data) through the chosen options of a select
// input (productMatch.ts), exactly how the chain-link fence picks its posts.

import type { StarterTemplate } from "./starterTemplates";
import { STARTER_TEMPLATES } from "./starterTemplates";
import { computeEstimate } from "./compute";
import type { ComputeOptions, ComputeSuccess } from "./compute";
import { parseMatchKey, productHasAttrs } from "./productMatch";
import type { EstimateTemplateBody } from "./types";

export type StarterFamily = "pipes" | "precast" | "civil";

export type StarterCatalogueItem = {
  /** Stable key a template rule can name, and the key a rate sheet can carry in its SKU column. */
  sku: string;
  /** Plain name without the illustrative suffix (the install adds it). */
  name: string;
  uom: string;
  /** The placeholder internal cost for one unit. */
  cost: number;
  /** Tags on the product (custom_data) that a rule's `match` can look for. */
  attrs: Record<string, string>;
  family: StarterFamily;
};

export const ILLUSTRATIVE_SUFFIX = " (illustrative)";
export const ILLUSTRATIVE_SOURCE = "Illustrative placeholder";
/** The first words of the description of an installed placeholder; a rate-sheet import removes exactly this prefix. */
export const ILLUSTRATIVE_DESCRIPTION = "ILLUSTRATIVE placeholder cost, not a supplier's price. Import a rate sheet to replace it.";

/** The product row an install writes for one item (columns of `products`, before tenant_id and ref). */
export type ProductSeedRow = {
  name: string;
  sku: string;
  uom: string;
  description: string;
  cost_price: number;
  status: "active";
  custom_data: Record<string, unknown>;
};

export function productRowFor(item: StarterCatalogueItem): ProductSeedRow {
  return {
    name: `${item.name}${ILLUSTRATIVE_SUFFIX}`,
    sku: item.sku,
    uom: item.uom,
    description: ILLUSTRATIVE_DESCRIPTION,
    cost_price: item.cost,
    status: "active",
    custom_data: { ...item.attrs, illustrative: true, cost_source: ILLUSTRATIVE_SOURCE, starter: item.family },
  };
}

/** Is this product still a placeholder? (custom_data.illustrative; the name suffix alone does not count.) */
export function isIllustrativeProduct(p: { custom_data?: Record<string, unknown> | null }): boolean {
  return p.custom_data?.illustrative === true;
}

/** The name without the placeholder suffix, for comparing a product with a name in a rate sheet. */
export function plainProductName(name: string): string {
  return name.endsWith(ILLUSTRATIVE_SUFFIX) ? name.slice(0, -ILLUSTRATIVE_SUFFIX.length) : name;
}

/** Every item the starters need, one per SKU, in a stable order (the order the starters list them). */
export function starterCatalogue(starters: readonly StarterTemplate[] = STARTER_TEMPLATES): StarterCatalogueItem[] {
  const out = new Map<string, StarterCatalogueItem>();
  for (const s of starters) for (const item of s.catalogue ?? []) if (!out.has(item.sku)) out.set(item.sku, item);
  return [...out.values()];
}

/** The items one starter prices from. */
export const catalogueOf = (s: Pick<StarterTemplate, "catalogue">): readonly StarterCatalogueItem[] => s.catalogue ?? [];

/**
 * The unit cost each product rule of a template resolves to against a list of catalogue items: by SKU, or by the tags of the
 * chosen options. This is what the pricing step does against `products`, in memory, so seeds, tests and previews can price a
 * template without a database. A rule whose item is not in the list is left out (it stays unpriced).
 */
export function unitCostsFromCatalogue(computed: ComputeSuccess, items: readonly StarterCatalogueItem[]): Record<string, number> {
  const bySku = new Map(items.map((i) => [i.sku, i]));
  const out: Record<string, number> = {};
  for (const l of computed.lines) {
    if (l.cost_kind !== "product" || !l.sku) continue;
    const attrs = parseMatchKey(l.sku);
    const hit = attrs ? items.find((i) => productHasAttrs(i.attrs, attrs)) : bySku.get(l.sku);
    if (hit) out[l.code] = hit.cost;
  }
  return out;
}

/** Two passes like computeAndPrice: quantities, price the product lines from the catalogue items, then the totals. */
export function computePricedFromCatalogue(
  template: EstimateTemplateBody, params: Record<string, unknown>, items: readonly StarterCatalogueItem[],
  opts: Omit<ComputeOptions, "unit_costs"> = {},
): ComputeSuccess {
  const first = computeEstimate(template, params, opts);
  if (!first.ok) throw new Error(first.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  const second = computeEstimate(template, params, { ...opts, unit_costs: unitCostsFromCatalogue(first, items) });
  if (!second.ok) throw new Error(second.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return second;
}
