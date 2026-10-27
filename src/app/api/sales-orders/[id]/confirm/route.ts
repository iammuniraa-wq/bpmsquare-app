import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { emitOrderConfirmed } from "@/lib/events/emitters";
import { refreshOrderAvailability } from "@/lib/salesOrders/availabilityServer";
import { orderLockReason } from "@/lib/salesOrders/lock";
import { failure, guard, loadLines, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { orderEditable } from "@/lib/salesOrders/types";
import { buildOrderView } from "@/lib/salesOrders/view";

// POST /api/sales-orders/[id]/confirm
//   Draft -> Confirmed, only for an order made here that no ERP has accepted (orderEditable()). Needs at least one
//   line with a quantity. Sets confirmed_at, re-runs the master-data availability check (stock, lead time) and
//   emits order.confirmed. -> the order view.

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order, erpLinked } = loaded.value;

  if (!orderEditable(order, erpLinked)) {
    const reason = order.status === "confirmed" ? "This order is already confirmed." : orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason }, { status: 409 });
  }
  const lines = await loadLines(supabase, tenantId, id);
  if (lines.length === 0) return NextResponse.json({ error: "Add at least one line before confirming." }, { status: 422 });
  if (lines.some((l) => !(Number(l.qty) > 0))) return NextResponse.json({ error: "Every line needs a quantity above zero before confirming." }, { status: 422 });

  const now = new Date();
  try {
    await refreshOrderAvailability(supabase, tenantId, id, now);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not check availability" }, { status: 500 });
  }
  const { error } = await supabase.from("sales_orders").update({ status: "confirmed", spine: "open", confirmed_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "status", from: "draft", to: "confirmed" }],
  });
  await emitOrderConfirmed(tenantId, { orderId: id, ref: order.ref, total: Number(order.total), accountId: order.account_id, contactId: order.contact_id, actorId: user?.id });

  const after = await loadOrder(supabase, tenantId, id);
  if (after.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(supabase, tenantId, after.value.order, after.value.erpLinked));
}
