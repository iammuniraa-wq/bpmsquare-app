import type { TenantConfig } from "@/lib/constants";
import { MAX_BOM_DEPTH, depthIfAdded, wouldCreateCycle, type BomLine } from "@/lib/products/bom";
import { parseBomLineInput, type BomLineFields } from "@/lib/products/bomInput";
import { canHaveComponents, itemTypeLabel } from "@/lib/products/itemTypes";

// Data Workbench import of BOM lines, as a pure plan: every row is checked
// against the products of THIS tenant (the caller loads them tenant-scoped),
// the lines that already exist, and the lines accepted earlier in the same
// file, so a loop that only appears across two rows of the file is caught too.

export type BomImportProduct = {
  id: string;
  ref: string | null;
  sku: string | null;
  name: string;
  item_type: string | null;
  uom: string | null;
};

export type BomImportPlan =
  | { rowNum: number; ok: true; parentId: string; componentId: string; fields: Required<Pick<BomLineFields, "qty" | "scrap_pct" | "line_kind" | "sort_order">> & { uom: string | null; note: string | null } }
  | { rowNum: number; ok: false; reason: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

type Lookup = { byRef: Map<string, BomImportProduct>; bySku: Map<string, BomImportProduct[]> };

function buildLookup(products: readonly BomImportProduct[]): Lookup {
  const byRef = new Map<string, BomImportProduct>();
  const bySku = new Map<string, BomImportProduct[]>();
  for (const p of products) {
    if (p.ref) byRef.set(norm(p.ref), p);
    if (p.sku) bySku.set(norm(p.sku), [...(bySku.get(norm(p.sku)) ?? []), p]);
  }
  return { byRef, bySku };
}

/** A typed product reference: the product ID (PRD-0001) first, then the SKU.
 *  A SKU two products share is ambiguous, never guessed. */
export function resolveProductToken(token: string, lookup: Lookup): { ok: true; product: BomImportProduct } | { ok: false; reason: "unknown" | "ambiguous" } {
  const key = norm(token);
  const byRef = lookup.byRef.get(key);
  if (byRef) return { ok: true, product: byRef };
  const hits = lookup.bySku.get(key) ?? [];
  if (hits.length === 1) return { ok: true, product: hits[0] };
  return { ok: false, reason: hits.length === 0 ? "unknown" : "ambiguous" };
}

function kindOf(raw: string): string | undefined {
  const v = norm(raw);
  if (!v) return undefined;
  if (v.startsWith("used")) return "used";
  if (v.startsWith("consum")) return "consumed";
  return v;
}

export function planBomImport(
  rows: readonly { rowNum: number; values: Record<string, string> }[],
  products: readonly BomImportProduct[],
  existing: readonly BomLine[],
  config: Pick<TenantConfig, "item_types"> | null | undefined
): BomImportPlan[] {
  const lookup = buildLookup(products);
  const byId = new Map(products.map((p) => [p.id, p]));
  const working: BomLine[] = [...existing];
  const linesOf = (parentId: string) => working.filter((l) => l.parent_product_id === parentId);
  let tempId = 0;

  return rows.map(({ rowNum, values }): BomImportPlan => {
    const fail = (reason: string): BomImportPlan => ({ rowNum, ok: false, reason });
    const parentToken = (values.parent ?? "").trim();
    const componentToken = (values.component ?? "").trim();
    if (!parentToken) return fail("BOM / kit is required");
    if (!componentToken) return fail("Component is required");

    const p = resolveProductToken(parentToken, lookup);
    if (!p.ok) return fail(p.reason === "ambiguous" ? `BOM / kit "${parentToken}" matches more than one product — use the product ID` : `BOM / kit "${parentToken}" was not found — import products first`);
    const c = resolveProductToken(componentToken, lookup);
    if (!c.ok) return fail(c.reason === "ambiguous" ? `Component "${componentToken}" matches more than one product — use the product ID` : `Component "${componentToken}" was not found — import products first`);
    const parent = p.product;
    const component = c.product;

    if (!canHaveComponents(config, parent.item_type)) {
      const t = itemTypeLabel(config, parent.item_type);
      return fail(`${parent.name} is ${t ? `a ${t}` : "not classified"}; only ${itemTypeLabel(config, "bom_kit") ?? "BOM / kit"} items can have components`);
    }
    if (parent.id === component.id) return fail("An item can't be a component of itself");

    const body: Record<string, unknown> = { qty: values.qty ?? "" };
    if ((values.uom ?? "").trim()) body.uom = values.uom;
    if ((values.scrap_pct ?? "").trim()) body.scrap_pct = values.scrap_pct;
    const kind = kindOf(values.line_kind ?? "");
    if (kind) body.line_kind = kind;
    if ((values.note ?? "").trim()) body.note = values.note;
    const parsed = parseBomLineInput(body, { requireQty: true });
    if (!parsed.ok) return fail(parsed.message);

    if (working.some((l) => l.parent_product_id === parent.id && l.component_product_id === component.id)) {
      return fail(`${component.name} is already a component of ${parent.name}`);
    }
    if (wouldCreateCycle(parent.id, component.id, linesOf)) return fail(`${component.name} already contains ${parent.name}, so this would make a loop`);
    if (depthIfAdded(parent.id, component.id, working) > MAX_BOM_DEPTH) return fail(`Kits can be nested at most ${MAX_BOM_DEPTH} levels deep`);

    const sortOrder = Math.max(-1, ...linesOf(parent.id).map((l) => l.sort_order ?? 0)) + 1;
    const fields = {
      qty: parsed.fields.qty!,
      scrap_pct: parsed.fields.scrap_pct ?? 0,
      line_kind: parsed.fields.line_kind ?? ("consumed" as const),
      sort_order: sortOrder,
      uom: parsed.fields.uom !== undefined ? parsed.fields.uom : component.uom,
      note: parsed.fields.note ?? null,
    };
    working.push({
      id: `import-${++tempId}`, parent_product_id: parent.id, component_product_id: component.id,
      qty: fields.qty, scrap_pct: fields.scrap_pct, line_kind: fields.line_kind, sort_order: sortOrder,
    });
    return { rowNum, ok: true, parentId: parent.id, componentId: component.id, fields };
  });
}
