import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();
  const qtyDelta = parseFloat(body.qty_delta);

  if (!qtyDelta || Number.isNaN(qtyDelta)) {
    return NextResponse.json({ error: "qty_delta is required and must be non-zero" }, { status: 400 });
  }

  const { data: newQty, error } = await supabase.rpc("adjust_inventory_qty", {
    p_tenant_id: tenantId,
    p_item_id: id,
    p_delta: qtyDelta,
    p_type: "adjustment",
    p_reference_type: "manual",
    p_reference_id: null,
    p_note: body.note || null,
    p_created_by: userId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ qty_on_hand: newQty });
}
