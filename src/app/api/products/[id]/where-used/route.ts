import { NextResponse, type NextRequest } from "next/server";
import { bomContext, isUuid, tenantProduct, whereUsed } from "@/lib/products/bomServer";

/** The BOM kits that contain this product, with the quantity each uses. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bomContext(false);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await tenantProduct(ctx.supabase, ctx.tenantId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ used_in: await whereUsed(ctx.supabase, ctx.tenantId, id) });
}
