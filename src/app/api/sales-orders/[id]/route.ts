import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { cfOnly } from "@/lib/customData";
import { cleanCurrency, cleanParty, cleanText } from "@/lib/salesOrders/clean";
import { ANNOTATABLE_FIELDS, EDITABLE_FIELDS, orderLockReason } from "@/lib/salesOrders/lock";
import { chooseOrderType } from "@/lib/salesOrders/typeSelect";
import { failure, guard, loadLines, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { cleanDate, clampMoney, computeOrderTotals } from "@/lib/salesOrders/totals";
import { orderAnnotatable, orderDeletable, orderEditable } from "@/lib/salesOrders/types";
import { buildOrderView } from "@/lib/salesOrders/view";
import { ORDER_ATTACHMENT_BUCKET } from "@/lib/salesOrders/attachments";

// GET    /api/sales-orders/[id]  -> the order view: the row, `lines`, `account`, `contact`, `type`, `source_ref`,
//        `pricing_label`, `attachment_count`, `needs_attention` and what may be done (`erp_linked`, `editable`,
//        `annotatable`, `deletable`, `lock_reason`).
// PATCH  /api/sales-orders/[id]  explicit allowlist. Header fields (account_id, contact_id, type_id, bill_to, ship_to,
//        requested_date, terms, shipping_amount, currency, opportunity_id) only while orderEditable(); notes, customer_po
//        and custom_data also on a confirmed order made here (orderAnnotatable()). Lines have their own route; the
//        status moves through confirm / cancel / reopen.
// DELETE /api/sales-orders/[id]  only a draft made here that no ERP has accepted (orderDeletable()).

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { id } = await params;
  const loaded = await loadOrder(ctx.supabase, ctx.tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(ctx.supabase, ctx.tenantId, loaded.value.order, loaded.value.erpLinked));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order, erpLinked } = loaded.value;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if ("status" in body) return NextResponse.json({ error: "The status changes through confirm, cancel and reopen." }, { status: 400 });

  const editableKeys = EDITABLE_FIELDS.filter((k) => k in body);
  const annotatableKeys = ANNOTATABLE_FIELDS.filter((k) => k in body);
  if (editableKeys.length === 0 && annotatableKeys.length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  if (editableKeys.length > 0 && !orderEditable(order, erpLinked)) {
    const reason = orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason, fields: editableKeys }, { status: 409 });
  }
  if (annotatableKeys.length > 0 && !orderAnnotatable(order)) {
    const reason = orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason, fields: annotatableKeys }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};

  if ("account_id" in body) {
    if (typeof body.account_id !== "string" || !body.account_id) return NextResponse.json({ error: "account_id can't be empty" }, { status: 400 });
    const { data: acc } = await supabase.from("accounts").select("id").eq("id", body.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    patch.account_id = body.account_id;
  }
  if ("contact_id" in body) {
    if (body.contact_id) {
      const { data: c } = await supabase.from("contacts").select("id").eq("id", body.contact_id as string).eq("tenant_id", tenantId).maybeSingle();
      if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      patch.contact_id = body.contact_id;
    } else patch.contact_id = null;
  }
  if ("opportunity_id" in body) {
    if (body.opportunity_id) {
      const { data: o, error } = await supabase.from("opportunities").select("id").eq("id", body.opportunity_id as string).eq("tenant_id", tenantId).maybeSingle();
      if (error || !o) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
      patch.opportunity_id = body.opportunity_id;
    } else patch.opportunity_id = null;
  }
  if ("type_id" in body) {
    if (typeof body.type_id !== "string" || !body.type_id) return NextResponse.json({ error: "An order always has a type" }, { status: 400 });
    const choice = await chooseOrderType(supabase, tenantId, { typeId: body.type_id, sourceType: order.source_type });
    if (!choice.ok) return choice.needsUpdate ? needsUpdate() : NextResponse.json({ error: choice.error }, { status: choice.status });
    patch.type_id = choice.type.id;
    // A type decides the pricing mode only where no quote already did: an order made from a quote keeps that quote's mode.
    if (["direct", "lead", "email"].includes(order.source_type)) patch.pricing_mode = choice.type.pricing_mode;
  }
  if ("bill_to" in body) patch.bill_to = cleanParty(body.bill_to);
  if ("ship_to" in body) patch.ship_to = cleanParty(body.ship_to);
  if ("requested_date" in body) {
    const d = cleanDate(body.requested_date);
    if (body.requested_date && !d) return NextResponse.json({ error: "requested_date must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.requested_date = d;
  }
  if ("terms" in body) patch.terms = cleanText(body.terms, 4000);
  if ("notes" in body) patch.notes = cleanText(body.notes, 4000);
  if ("customer_po" in body) patch.customer_po = cleanText(body.customer_po, 100);
  if ("currency" in body) {
    const c = cleanCurrency(body.currency);
    if (!c) return NextResponse.json({ error: "Unknown currency" }, { status: 400 });
    patch.currency = c;
  }
  if ("custom_data" in body) {
    const cf = cfOnly(body.custom_data);
    patch.custom_data = cf && Object.keys(cf).length > 0 ? cf : null;
  }
  if ("shipping_amount" in body) {
    const lines = await loadLines(supabase, tenantId, id);
    Object.assign(patch, computeOrderTotals(lines.map((l) => ({ qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_pct: Number(l.tax_pct) })), clampMoney(body.shipping_amount)));
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from("sales_orders").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { updated_at: _u, ...diffPatch } = patch;
  const changes = diffForLog("sales_orders", order as unknown as Record<string, unknown>, diffPatch);
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, { tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  }

  const after = await loadOrder(supabase, tenantId, id);
  if (after.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(supabase, tenantId, after.value.order, after.value.erpLinked));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order, erpLinked } = loaded.value;

  if (!orderDeletable(order, erpLinked)) {
    const reason = order.status === "draft" && order.origin === "bpmsquare" ? orderLockReason(order, erpLinked) : "Only a draft that was never sent to the ERP can be deleted. Cancel the order instead.";
    return NextResponse.json({ error: reason, lock_reason: reason }, { status: 409 });
  }

  // Uploaded files live in a private bucket: remove them with the order (best effort, a leftover file is harmless).
  const { data: files } = await supabase.from("sales_order_attachments").select("ref").eq("order_id", id).eq("tenant_id", tenantId).eq("type", "file");
  const paths = ((files ?? []) as { ref: string }[]).map((f) => f.ref).filter((p) => p.startsWith(`${tenantId}/`));
  if (paths.length > 0) {
    try { await createAdminSupabase().storage.from(ORDER_ATTACHMENT_BUCKET).remove(paths); } catch (e) { console.error("[sales-orders] file cleanup failed", e); }
  }

  const { error } = await supabase.from("sales_orders").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "delete", actorId: user?.id, actorEmail: user?.email });
  return new NextResponse(null, { status: 204 });
}
