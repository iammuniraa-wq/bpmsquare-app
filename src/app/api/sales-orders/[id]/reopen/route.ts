import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { buildOrderView } from "@/lib/salesOrders/view";

// POST /api/sales-orders/[id]/reopen
//   Confirmed -> Draft, only while no ERP link exists for the order (once the ERP has accepted it, it stays locked).
//   A cancelled order stays cancelled. -> the order view.

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

  if (order.origin !== "bpmsquare") return NextResponse.json({ error: "This order comes from the ERP and is read-only here.", lock_reason: "erp" }, { status: 409 });
  if (order.status !== "confirmed") {
    return NextResponse.json({ error: order.status === "cancelled" ? "A cancelled order can't be reopened." : "Only a confirmed order can be reopened." }, { status: 409 });
  }
  if (erpLinked) return NextResponse.json({ error: "The ERP has accepted this order, so it can't be reopened here.", lock_reason: "erp" }, { status: 409 });

  const { error } = await supabase.from("sales_orders").update({ status: "draft", spine: "open", confirmed_at: null, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "reopen", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "status", from: "confirmed", to: "draft" }],
  });

  const after = await loadOrder(supabase, tenantId, id);
  if (after.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(supabase, tenantId, after.value.order, after.value.erpLinked));
}
