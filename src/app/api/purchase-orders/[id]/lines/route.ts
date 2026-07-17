import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

async function recomputeTotal(supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"], poId: string, tenantId: string) {
  const { data: lines } = await supabase.from("purchase_order_lines").select("amount").eq("po_id", poId);
  const total = (lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
  await supabase.from("purchase_orders").update({ total }).eq("id", poId).eq("tenant_id", tenantId);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (po.status !== "draft") return NextResponse.json({ error: "Only draft purchase orders can have lines added" }, { status: 409 });

  const body = await request.json();
  const { description, uom, qty_ordered, rate, inventory_item_id } = body;
  if (!description?.trim()) return NextResponse.json({ error: "description is required" }, { status: 400 });

  const { count } = await supabase.from("purchase_order_lines").select("id", { count: "exact", head: true }).eq("po_id", id);
  const qty = Math.max(0, parseFloat(qty_ordered) || 1);
  const r = Math.max(0, parseFloat(rate) || 0);

  const { data, error } = await supabase
    .from("purchase_order_lines")
    .insert({
      tenant_id: tenantId,
      po_id: id,
      inventory_item_id: inventory_item_id || null,
      sl_no: (count ?? 0) + 1,
      description: description.trim(),
      uom: uom || null,
      qty_ordered: qty,
      rate: r,
      amount: qty * r,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recomputeTotal(supabase, id, tenantId);
  return NextResponse.json(data, { status: 201 });
}
