import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { MAX_BOM_DEPTH, depthIfAdded, wouldCreateCycle } from "@/lib/products/bom";
import { parseBomLineInput } from "@/lib/products/bomInput";
import { bomContext, isUuid, loadBomGraph, rollUpFor, slimRollUp, tenantProduct } from "@/lib/products/bomServer";
import { canHaveComponents, itemTypeLabel } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";

type Params = { params: Promise<{ id: string }> };

/** The product's component lines with each component's name, type and cost, plus the cost roll-up. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await bomContext(false);
  if (ctx instanceof Response) return ctx;
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = await tenantProduct(supabase, tenantId, id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await getTenantItemTypeConfig(supabase, tenantId);

  const graph = await loadBomGraph(supabase, tenantId, id);
  const rollup = rollUpFor(graph, id);
  const lines = graph.getLines(id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((l) => {
    const comp = graph.getProduct(l.component_product_id);
    return {
      ...l,
      component: comp ? { id: comp.id, name: comp.name, sku: comp.sku ?? null, item_type: comp.item_type ?? null, item_type_label: itemTypeLabel(config, comp.item_type), cost_price: comp.cost_price, cost_price_as_of: comp.cost_price_as_of ?? null } : null,
    };
  });

  return NextResponse.json({
    product: { id: product.id, name: product.name, item_type: product.item_type ?? null, can_have_components: canHaveComponents(config, product.item_type), cost_price: product.cost_price, cost_price_as_of: product.cost_price_as_of ?? null },
    lines,
    rollup: slimRollUp(rollup),
  });
}

/** Add a component. The parent must be a BOM / kit; the component is verified to
 *  be one of this tenant's products and must not create a loop. */
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await bomContext(true);
  if (ctx instanceof Response) return ctx;
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const componentId = body.component_product_id;
  if (!isUuid(componentId)) return NextResponse.json({ error: "Choose an item to add" }, { status: 400 });
  const parsed = parseBomLineInput(body, { requireQty: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  const parent = await tenantProduct(supabase, tenantId, id);
  if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await getTenantItemTypeConfig(supabase, tenantId);
  if (!canHaveComponents(config, parent.item_type)) {
    return NextResponse.json({ error: `Only ${itemTypeLabel(config, "bom_kit")} items can have components. Change this item's type first.` }, { status: 400 });
  }
  if (componentId === id) return NextResponse.json({ error: "An item can't be a component of itself" }, { status: 400 });
  const component = await tenantProduct(supabase, tenantId, componentId);
  if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

  const graph = await loadBomGraph(supabase, tenantId, id, [componentId]);
  if (graph.getLines(id).some((l) => l.component_product_id === componentId)) {
    return NextResponse.json({ error: `${component.name} is already a component. Edit its quantity instead.` }, { status: 409 });
  }
  if (wouldCreateCycle(id, componentId, graph.getLines)) {
    return NextResponse.json({ error: `${component.name} already contains ${parent.name}, so adding it would make a loop.` }, { status: 400 });
  }
  if (depthIfAdded(id, componentId, graph.lines) > MAX_BOM_DEPTH) {
    return NextResponse.json({ error: `Kits can be nested at most ${MAX_BOM_DEPTH} levels deep.` }, { status: 400 });
  }

  const nextOrder = Math.max(-1, ...graph.getLines(id).map((l) => l.sort_order ?? 0)) + 1;
  const row = {
    tenant_id: tenantId,
    parent_product_id: id,
    component_product_id: componentId,
    qty: parsed.fields.qty,
    uom: parsed.fields.uom !== undefined ? parsed.fields.uom : component.uom,
    scrap_pct: parsed.fields.scrap_pct ?? 0,
    line_kind: parsed.fields.line_kind ?? "consumed",
    note: parsed.fields.note ?? null,
    sort_order: parsed.fields.sort_order ?? nextOrder,
  };
  const { data, error } = await supabase.from("product_bom_lines").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `${component.name} is already a component.` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "products", objectId: id, objectLabel: parent.name, action: "update",
    actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Component added", from: null, to: `${component.name} × ${row.qty}${row.uom ? ` ${row.uom}` : ""}${row.line_kind === "used" ? " (used, not consumed)" : ""}` }],
  });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
