import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { emitOrderCancelled } from "@/lib/events/emitters";
import { cleanText } from "@/lib/salesOrders/clean";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { buildOrderView } from "@/lib/salesOrders/view";

// POST /api/sales-orders/[id]/cancel { reason }
//   Draft or Confirmed -> Cancelled, for an order made here that no ERP has accepted. A reason is required (it is
//   kept on the order and in the change history). An order the ERP has accepted is cancelled in the ERP, not here.
//   -> the order view.

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order, erpLinked } = loaded.value;

  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = cleanText(body?.reason, 500);
  if (!reason) return NextResponse.json({ error: "Say why the order is cancelled." }, { status: 400 });

  if (order.status === "cancelled") return NextResponse.json({ error: "This order is already cancelled." }, { status: 409 });
  if (order.origin !== "bpmsquare") return NextResponse.json({ error: "This order comes from the ERP and is read-only here. Cancel it in the ERP.", lock_reason: "erp" }, { status: 409 });
  if (erpLinked) return NextResponse.json({ error: "The ERP has accepted this order. Cancel it in the ERP.", lock_reason: "erp" }, { status: 409 });

  const now = new Date().toISOString();
  const { error } = await supabase.from("sales_orders").update({ status: "cancelled", spine: "cancelled", cancelled_at: now, cancel_reason: reason, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "status", from: order.status, to: "cancelled" }, { field: "cancel_reason", from: null, to: reason }],
  });
  await emitOrderCancelled(tenantId, { orderId: id, ref: order.ref, total: Number(order.total), accountId: order.account_id, contactId: order.contact_id, actorId: user?.id, reason });

  const after = await loadOrder(supabase, tenantId, id);
  if (after.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(supabase, tenantId, after.value.order, after.value.erpLinked));
}
