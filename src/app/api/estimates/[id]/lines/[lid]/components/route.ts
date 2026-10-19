import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { loadLineProducts, kitComponents } from "@/lib/estimator/catalogue";
import { estimatorAccess, errorResponse, loadEstimate, pendingResponse } from "@/lib/estimator/server";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";
import { itemTypeLabel } from "@/lib/products/itemTypes";

// GET /api/estimates/[id]/lines/[lid]/components
// The components behind a kit line, read-only: what one unit of the kit is made
// of and what each part costs, from the products module's own roll-up. Never
// changes anything. { components: null } when the line has no product, the
// product is not a kit, or it has no components yet. Internal (carries costs):
// estimator view access, like the bill of materials itself.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; lid: string }> }) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const { id, lid } = await params;
    if (!isUuid(id) || !isUuid(lid)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

    const { data: line } = await supabase.from("estimate_lines").select("id, product_id")
      .eq("id", lid).eq("estimate_id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const productId = (line as { product_id: string | null }).product_id;
    if (!productId || !(await tenantOwnsObject(tenantId, "products"))) return NextResponse.json({ components: null });

    const product = (await loadLineProducts(supabase, tenantId, [productId])).get(productId);
    if (!product) return NextResponse.json({ components: null });
    const found = await kitComponents(supabase, tenantId, product);
    if (!found) return NextResponse.json({ components: null });

    const config = await getTenantItemTypeConfig(supabase, tenantId);
    return NextResponse.json({
      components: { ...found, rows: found.rows.map((r) => ({ ...r, itemTypeLabel: itemTypeLabel(config, r.itemType) })) },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
