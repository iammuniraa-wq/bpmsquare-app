import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { ORDER_ATTACHMENT_BUCKET } from "@/lib/salesOrders/attachments";
import { orderLockReason } from "@/lib/salesOrders/lock";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { orderAnnotatable } from "@/lib/salesOrders/types";

// GET    /api/sales-orders/[id]/attachments/[aid]  a file: 302 to a 5-minute signed download of the private object, issued
//        only after the row is confirmed to be this tenant's and this order's. A link answers { url }.
// DELETE /api/sales-orders/[id]/attachments/[aid]  removes the row (and the stored file) while orderAnnotatable().

type Params = { params: Promise<{ id: string; aid: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id, aid } = await params;
  const { data: att } = await supabase.from("sales_order_attachments").select("*").eq("id", aid).eq("order_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const row = att as { type: string; ref: string; name: string };
  if (row.type === "link") return NextResponse.json({ url: row.ref });
  // The stored path must sit under this tenant's own folder, whatever the row says.
  if (!row.ref.startsWith(`${tenantId}/${id}/`)) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const { data: signed, error } = await createAdminSupabase().storage.from(ORDER_ATTACHMENT_BUCKET).createSignedUrl(row.ref, 300, { download: row.name });
  if (error || !signed?.signedUrl) return NextResponse.json({ error: error?.message ?? "Could not sign the download" }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id, aid } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  const { order, erpLinked } = loaded.value;
  if (!orderAnnotatable(order)) {
    const reason = orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason }, { status: 409 });
  }

  const { data: att } = await supabase.from("sales_order_attachments").select("*").eq("id", aid).eq("order_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const row = att as { id: string; type: string; ref: string; name: string };

  if (row.type === "file" && row.ref.startsWith(`${tenantId}/${id}/`)) {
    await createAdminSupabase().storage.from(ORDER_ATTACHMENT_BUCKET).remove([row.ref]).catch(() => {});
  }
  const { error } = await supabase.from("sales_order_attachments").delete().eq("id", row.id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: row.type === "link" ? "Link removed" : "File removed", from: row.name, to: null }],
  });
  return NextResponse.json({ ok: true });
}
