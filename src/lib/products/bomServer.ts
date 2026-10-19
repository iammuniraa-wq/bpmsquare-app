import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter, canViewWorkcenter } from "@/lib/permissions";
import { fetchAllRows } from "@/lib/import/server";
import { rollUpBom, type BomLine, type BomProduct, type RollUp } from "@/lib/products/bom";

export const BOM_LINE_COLUMNS = "id, parent_product_id, component_product_id, qty, uom, scrap_pct, line_kind, sort_order, note";
const PRODUCT_COLUMNS = "id, name, sku, item_type, uom, cost_price, cost_price_as_of";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BomContext = { supabase: SupabaseClient; tenantId: string; userId: string };

/** Every BOM route starts here: authenticated tenant user, the Products module
 *  on for this tenant, and the Products workcenter grant (view for reads,
 *  edit for writes). Returns the context or the response to send back. */
export async function bomContext(write: boolean): Promise<BomContext | Response> {
  try {
    const { supabase, tenantId, userId, role } = await requireTenantUser();
    const gate = await assertObjectFeature(tenantId, "products");
    if (gate) return gate;
    const perms = await resolvePermissions(supabase, tenantId, userId, role);
    const allowed = write ? canEditWorkcenter(perms, "products") : canViewWorkcenter(perms, "products");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return { supabase, tenantId, userId };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export type BomGraph = {
  products: Map<string, BomProduct & { uom?: string | null }>;
  /** Every BOM line in the tenant. */
  lines: BomLine[];
  getProduct: (id: string) => BomProduct | undefined;
  getLines: (parentId: string) => BomLine[];
};

/** The tenant's whole BOM graph needed to reason about `rootId`: every line
 *  (loops and depth can pass through any kit) and the products the root can
 *  reach. All reads are tenant-scoped. */
export async function loadBomGraph(supabase: SupabaseClient, tenantId: string, rootId: string, extraIds: string[] = []): Promise<BomGraph> {
  const lines = (await fetchAllRows<BomLine & { qty: number | string; scrap_pct: number | string }>(supabase, "product_bom_lines", BOM_LINE_COLUMNS, tenantId))
    .map((l) => ({ ...l, qty: Number(l.qty), scrap_pct: Number(l.scrap_pct) }));
  const byParent = new Map<string, BomLine[]>();
  for (const l of lines) byParent.set(l.parent_product_id, [...(byParent.get(l.parent_product_id) ?? []), l]);

  const reachable = new Set<string>([rootId, ...extraIds]);
  const stack = [rootId, ...extraIds];
  while (stack.length > 0) {
    for (const l of byParent.get(stack.pop()!) ?? []) {
      if (!reachable.has(l.component_product_id)) { reachable.add(l.component_product_id); stack.push(l.component_product_id); }
    }
  }

  const products = new Map<string, BomProduct & { uom?: string | null }>();
  const ids = [...reachable];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("products").select(PRODUCT_COLUMNS).eq("tenant_id", tenantId).in("id", ids.slice(i, i + 150));
    for (const p of data ?? []) {
      const row = p as BomProduct & { uom?: string | null };
      products.set(row.id, { ...row, cost_price: row.cost_price == null ? null : Number(row.cost_price) });
    }
  }
  return { products, lines, getProduct: (id) => products.get(id), getLines: (id) => byParent.get(id) ?? [] };
}

export function rollUpFor(graph: BomGraph, rootId: string): RollUp {
  return rollUpBom(rootId, graph.getProduct, graph.getLines);
}

/** The roll-up without the nested sub-trees, for a response body. */
export function slimRollUp(r: RollUp): Omit<RollUp, "lines"> & { lines: (Omit<RollUp["lines"][number], "sub"> & { subTotal?: number })[] } {
  return { ...r, lines: r.lines.map(({ sub, ...rest }) => ({ ...rest, ...(sub ? { subTotal: sub.total } : {}) })) };
}

/** A product of THIS tenant by id (the foreign-id check for every BOM write). */
export async function tenantProduct(supabase: SupabaseClient, tenantId: string, id: string) {
  const { data } = await supabase.from("products").select("id, name, sku, item_type, uom, cost_price, cost_price_as_of").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data as (BomProduct & { uom: string | null }) | null;
}

/** The BOM parents that contain these products, for a readable "used in" message. */
export async function whereUsed(supabase: SupabaseClient, tenantId: string, componentId: string) {
  const { data: used } = await supabase
    .from("product_bom_lines")
    .select("id, parent_product_id, qty, uom, line_kind")
    .eq("tenant_id", tenantId).eq("component_product_id", componentId);
  const parentIds = [...new Set((used ?? []).map((u) => u.parent_product_id as string))];
  if (parentIds.length === 0) return [];
  const { data: parents } = await supabase.from("products").select("id, ref, name, sku, item_type").eq("tenant_id", tenantId).in("id", parentIds);
  const byId = new Map((parents ?? []).map((p) => [p.id as string, p]));
  return (used ?? []).flatMap((u) => {
    const p = byId.get(u.parent_product_id as string);
    return p ? [{ lineId: u.id as string, qty: Number(u.qty), uom: (u.uom as string | null) ?? null, lineKind: u.line_kind as "consumed" | "used", parent: p as { id: string; ref: string | null; name: string; sku: string | null; item_type: string | null } }] : [];
  });
}
