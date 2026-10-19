import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { bomContext, isUuid, loadBomGraph, rollUpFor, slimRollUp, tenantProduct } from "@/lib/products/bomServer";
import { canHaveComponents, itemTypeLabel } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";

type Params = { params: Promise<{ id: string }> };

/** Write the rolled-up BOM cost to products.cost_price and stamp cost_price_as_of
 *  with today. This is how the pricing engine picks a kit's cost up: it already
 *  reads cost_price / cost_price_as_of, so it needs no change. An incomplete
 *  roll-up (a component with no cost) is refused unless { allowIncomplete: true }. */
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await bomContext(true);
  if (ctx instanceof Response) return ctx;
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { allowIncomplete?: unknown };
  const allowIncomplete = body?.allowIncomplete === true;

  const product = await tenantProduct(supabase, tenantId, id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await getTenantItemTypeConfig(supabase, tenantId);
  if (!canHaveComponents(config, product.item_type)) {
    return NextResponse.json({ error: `Only ${itemTypeLabel(config, "bom_kit")} items have a rolled-up cost.` }, { status: 400 });
  }

  const graph = await loadBomGraph(supabase, tenantId, id);
  if (graph.getLines(id).length === 0) return NextResponse.json({ error: "Add components before applying a cost." }, { status: 400 });
  const rollup = rollUpFor(graph, id);
  if (rollup.incomplete && !allowIncomplete) {
    return NextResponse.json({
      error: rollup.errors.length > 0
        ? "The components contain a loop or are nested too deeply, so the cost can't be worked out."
        : `${rollup.missing.length} component${rollup.missing.length === 1 ? " has" : "s have"} no cost, so the total would be understated.`,
      missing: rollup.missing,
      rollup: slimRollUp(rollup),
    }, { status: 409 });
  }
  if (rollup.errors.length > 0) {
    return NextResponse.json({ error: "The components contain a loop or are nested too deeply, so the cost can't be applied." }, { status: 409 });
  }

  const patch = { cost_price: rollup.total, cost_price_as_of: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() };
  const { data: before } = await supabase.from("products").select("cost_price, cost_price_as_of").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  const { error } = await supabase.from("products").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("products", (before as Record<string, unknown>) ?? {}, { cost_price: patch.cost_price, cost_price_as_of: patch.cost_price_as_of });
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: product.name, action: "update",
      actorId: user?.id, actorEmail: user?.email,
      changes: [...changes, { field: "Cost source", from: null, to: rollup.incomplete ? "BOM roll-up (incomplete, applied anyway)" : "BOM roll-up" }],
    });
  }
  return NextResponse.json({ cost_price: patch.cost_price, cost_price_as_of: patch.cost_price_as_of, incomplete: rollup.incomplete });
}
