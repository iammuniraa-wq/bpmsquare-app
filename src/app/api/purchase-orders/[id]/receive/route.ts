import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

// The only place qty_on_hand is ever incremented from a purchase order -- one qty_received
// update per line, plus an adjust_inventory_qty RPC call (ledgered) for any line that's
// linked to an inventory item. Free-text lines (no inventory_item_id) just record receipt.
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
  const receiveLines: { line_id: string; qty_now: number }[] = Array.isArray(body.lines) ? body.lines : [];
  if (receiveLines.length === 0) {
    return NextResponse.json({ error: "lines is required" }, { status: 400 });
  }

  const { data: po } = await supabase.from("purchase_orders").select("id, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (po.status === "cancelled" || po.status === "received") {
    return NextResponse.json({ error: `Cannot receive against a ${po.status} purchase order` }, { status: 409 });
  }

  const { data: allLines } = await supabase.from("purchase_order_lines").select("*").eq("po_id", id);
  const lineById = new Map((allLines ?? []).map((l) => [l.id, l]));

  for (const rl of receiveLines) {
    const line = lineById.get(rl.line_id);
    const qtyNow = parseFloat(String(rl.qty_now));
    if (!line || !qtyNow || qtyNow <= 0) continue;
    const remaining = line.qty_ordered - line.qty_received;
    if (qtyNow > remaining) {
      return NextResponse.json({ error: `Cannot receive ${qtyNow} on line "${line.description}" — only ${remaining} remaining` }, { status: 400 });
    }

    const { error: updErr } = await supabase
      .from("purchase_order_lines")
      .update({ qty_received: line.qty_received + qtyNow })
      .eq("id", line.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (line.inventory_item_id) {
      const { error: rpcErr } = await supabase.rpc("adjust_inventory_qty", {
        p_tenant_id: tenantId,
        p_item_id: line.inventory_item_id,
        p_delta: qtyNow,
        p_type: "receipt",
        p_reference_type: "purchase_order_line",
        p_reference_id: line.id,
        p_note: body.note || null,
        p_created_by: userId,
      });
      if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
  }

  // Recompute PO status from actual received quantities across all lines.
  const { data: refreshedLines } = await supabase.from("purchase_order_lines").select("qty_ordered, qty_received").eq("po_id", id);
  const allReceived = (refreshedLines ?? []).every((l) => l.qty_received >= l.qty_ordered);
  const anyReceived = (refreshedLines ?? []).some((l) => l.qty_received > 0);
  const newStatus = allReceived ? "received" : anyReceived ? "partially_received" : po.status;

  const { data: updatedPo, error: statusErr } = await supabase
    .from("purchase_orders")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (statusErr) return NextResponse.json({ error: statusErr.message }, { status: 500 });

  return NextResponse.json(updatedPo);
}
