// Catalogue products and BOM kits as estimate items (docs/estimator-architecture.md
// "Products and kits as estimate items"). Pure, no I/O: the server step loads the
// products and the kit roll-ups and hands them in, so every rule here is tested
// on its own.

import { KIT_ITEM_TYPE } from "@/lib/products/itemTypes";
import type { EstimateComponent } from "./types";

/** The slice of a product the estimator reads. */
export type CatalogueProduct = {
  id: string;
  sku: string | null;
  ref: string | null;
  name: string;
  item_type: string | null;
  uom: string | null;
  cost_price: number | null;
  status: string | null;
  created_at: string | null;
};

const rank = (p: CatalogueProduct) => (p.status === "active" ? 0 : 1);

/** If a key matches several products an active one wins, then the oldest, so the answer does not change between runs. */
export function betterProduct(cur: CatalogueProduct | undefined, next: CatalogueProduct): CatalogueProduct {
  if (!cur) return next;
  if (rank(next) < rank(cur)) return next;
  if (rank(next) === rank(cur) && (next.created_at ?? "") < (cur.created_at ?? "")) return next;
  return cur;
}

const refKey = (s: string) => s.trim().toUpperCase();

/**
 * Index products by the key a template rule names. A key matches a SKU first
 * (exact), then a product reference (PRD-0012, any case). A SKU therefore wins
 * over a reference that happens to look the same.
 */
export function indexByKey(products: readonly CatalogueProduct[], keys: readonly string[]): Map<string, CatalogueProduct> {
  const bySku = new Map<string, CatalogueProduct>();
  const byRef = new Map<string, CatalogueProduct>();
  for (const p of products) {
    if (p.sku) bySku.set(p.sku, betterProduct(bySku.get(p.sku), p));
    if (p.ref) byRef.set(refKey(p.ref), betterProduct(byRef.get(refKey(p.ref)), p));
  }
  const out = new Map<string, CatalogueProduct>();
  for (const k of keys) {
    const hit = bySku.get(k) ?? byRef.get(refKey(k));
    if (hit) out.set(k, hit);
  }
  return out;
}

export const isKitType = (itemType: string | null | undefined): boolean => itemType === KIT_ITEM_TYPE;

/** A kit's rolled-up cost, reduced to what pricing needs. */
export type KitCost = {
  /** Cost of ONE unit of the kit (2 dp), from the existing roll-up. */
  total: number;
  /** A component has no cost, or a loop / depth error cut a branch. */
  incomplete: boolean;
  /** Names of the components with no cost. */
  missing: string[];
};

export type KitDecision = { cost: number | null; source: "kit_rollup" | null; note: string | null };

/**
 * Does the kit's own roll-up give the unit cost? Only a complete, positive roll-up
 * does: a roll-up with a hole in it is never used as if it were the whole cost
 * (the same rule the product page applies before "Apply to product cost").
 */
export function kitDecision(name: string, kit: KitCost | null): KitDecision {
  if (!kit) return { cost: null, source: null, note: null };
  if (kit.incomplete) {
    const who = kit.missing.length > 0 ? `: ${kit.missing.slice(0, 3).join(", ")}${kit.missing.length > 3 ? ", ..." : ""} has no cost` : "";
    return { cost: null, source: null, note: `The kit "${name}" has components without a cost${who}, so its stored cost is used if it has one.` };
  }
  if (!(kit.total > 0)) return { cost: null, source: null, note: null };
  return { cost: kit.total, source: "kit_rollup", note: null };
}

/** The cost bucket a catalogue item most likely belongs to; the person can change it. */
export function defaultComponentFor(itemType: string | null | undefined): EstimateComponent {
  switch (itemType) {
    case "tool_equipment": return "moulds";
    case "service": return "other";
    case null:
    case undefined:
    case "": return "materials";
    default: return "materials";
  }
}

// ── Flags on a line ──────────────────────────────────────────────────────────

export type LineFlag = "unresolved" | "no_cost" | "kit_incomplete";

export const LINE_FLAG_LABEL: Record<LineFlag, string> = {
  unresolved: "Needs a product",
  no_cost: "Needs a cost",
  kit_incomplete: "Kit cost incomplete",
};

export const LINE_FLAG_HELP: Record<LineFlag, string> = {
  unresolved: "No product in your catalogue matches this item. Add the product (or correct the SKU in the template), then recalculate.",
  no_cost: "This line has no cost yet, so the estimate cannot become a quote. Give the product a cost price, or enter a unit cost here.",
  kit_incomplete: "A component of this kit has no cost, so the kit's cost is not the full cost. Open the kit and add the missing costs.",
};

export type FlagInput = {
  source: "rule" | "schedule" | "manual";
  qty: number;
  cost_total: number | null;
  product_id: string | null;
  custom_data: Record<string, unknown> | null;
};

/** The item key a line was written with (the template's SKU or reference). */
export function itemKeyOf(l: Pick<FlagInput, "custom_data">): string | null {
  const sku = l.custom_data?.sku;
  if (typeof sku === "string" && sku.trim()) return sku;
  const ref = l.custom_data?.product_ref;
  return typeof ref === "string" && ref.trim() ? ref : null;
}

/**
 * What is wrong with a line, in the order it matters. A product line whose key
 * matched nothing needs a product; a line with a quantity and no cost needs a
 * cost; a kit costed from a roll-up with holes in it is flagged even when it has
 * a (stored) cost. A line with no quantity is never flagged.
 */
export function lineFlags(l: FlagInput): LineFlag[] {
  if (!(l.qty > 0)) return [];
  const out: LineFlag[] = [];
  if (!l.product_id && l.source !== "manual" && itemKeyOf(l)) out.push("unresolved");
  else if (l.cost_total === null) out.push("no_cost");
  if (out.length === 0 && l.custom_data?.kit_incomplete === true) out.push("kit_incomplete");
  return out;
}
