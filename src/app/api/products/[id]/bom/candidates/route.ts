import { NextResponse, type NextRequest } from "next/server";
import { bomContext, isUuid, loadBomGraph, tenantProduct } from "@/lib/products/bomServer";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";
import { itemTypeLabel } from "@/lib/products/itemTypes";

const LIMIT = 20;

/** Items that can be added under this kit, for the "Add component" picker: a
 *  name / SKU search over this tenant's products, minus the kit itself, what it
 *  already contains, and anything that contains it (adding those would loop). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bomContext(false);
  if (ctx instanceof Response) return ctx;
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await tenantProduct(supabase, tenantId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  // % _ \ are LIKE wildcards; a typed one is matched literally.
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

  const graph = await loadBomGraph(supabase, tenantId, id);
  const excluded = new Set<string>([id, ...graph.getLines(id).map((l) => l.component_product_id)]);
  // Everything that contains this kit, directly or not.
  const parentsOf = new Map<string, string[]>();
  for (const l of graph.lines) parentsOf.set(l.component_product_id, [...(parentsOf.get(l.component_product_id) ?? []), l.parent_product_id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const p of parentsOf.get(stack.pop()!) ?? []) if (!excluded.has(p)) { excluded.add(p); stack.push(p); }
  }

  const select = "id, ref, name, sku, item_type, uom, cost_price, status";
  const [byName, bySku] = await Promise.all([
    supabase.from("products").select(select).eq("tenant_id", tenantId).ilike("name", pattern).order("name").limit(LIMIT + excluded.size),
    q ? supabase.from("products").select(select).eq("tenant_id", tenantId).ilike("sku", pattern).order("name").limit(LIMIT + excluded.size) : Promise.resolve({ data: [] }),
  ]);
  const seen = new Set<string>();
  const config = await getTenantItemTypeConfig(supabase, tenantId);
  const items = [...(byName.data ?? []), ...(bySku.data ?? [])]
    .filter((p) => !excluded.has(p.id as string) && (seen.has(p.id as string) ? false : (seen.add(p.id as string), true)))
    .slice(0, LIMIT)
    .map((p) => ({
      id: p.id as string, ref: (p.ref as string | null) ?? null, name: p.name as string, sku: (p.sku as string | null) ?? null,
      item_type: (p.item_type as string | null) ?? null, item_type_label: itemTypeLabel(config, p.item_type as string | null),
      uom: (p.uom as string | null) ?? null, has_cost: p.cost_price != null,
    }));
  return NextResponse.json({ items });
}
