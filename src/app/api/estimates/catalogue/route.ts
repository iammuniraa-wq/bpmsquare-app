import { NextResponse, type NextRequest } from "next/server";
import { isKitType } from "@/lib/estimator/productItems";
import { searchCatalogue } from "@/lib/estimator/catalogue";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";
import { itemTypeLabel } from "@/lib/products/itemTypes";

// GET /api/estimates/catalogue?q=text
// The picker behind "Add a line": this workspace's active products and BOM kits
// whose name, SKU or reference contains the text (at most 25). Costs are NOT
// returned -- the line is priced when it is added -- so the list is safe to show
// anyone who can edit an estimate. { available: false } means the workspace has
// no Products module (or the database update is pending): the form then offers
// free-text lines only. Estimator edit access, the same as adding a line.
export async function GET(req: NextRequest) {
  try {
    const { supabase, tenantId } = await estimatorAccess("edit");
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const { items, available } = await searchCatalogue(supabase, tenantId, q);
    const config = available ? await getTenantItemTypeConfig(supabase, tenantId) : {};
    return NextResponse.json({
      available,
      items: items.map((p) => ({
        id: p.id, ref: p.ref, sku: p.sku, name: p.name, uom: p.uom,
        item_type: p.item_type, item_type_label: itemTypeLabel(config, p.item_type), is_kit: isKitType(p.item_type),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
