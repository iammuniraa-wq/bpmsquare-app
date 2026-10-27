import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { diffLineItems, logChange, type LineSnapshot } from "@/lib/changeLog";
import { lineRows } from "@/lib/salesOrders/create";
import { orderLockReason } from "@/lib/salesOrders/lock";
import { checkLineProducts, failure, guard, loadLines, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { cleanOrderLines, computeOrderTotals, expectedDateOf } from "@/lib/salesOrders/totals";
import { orderEditable } from "@/lib/salesOrders/types";
import { buildOrderView } from "@/lib/salesOrders/view";

// PUT /api/sales-orders/[id]/lines { lines: [{ id?, product_id?, description, printed_text?, qty, uom?, unit_price,
//     discount_pct?, tax_pct?, requested_date? }] }
//   Replaces the set of lines while orderEditable(). A line that names the id of one of this order's own lines keeps that
//   id (so history and later ERP links stay attached); an unknown id is simply a new line. line_total, the header totals
//   and expected_date are worked out here, never taken from the request. Editing the lines marks availability stale
//   (availability_at is cleared; the earlier confirmed figures stay visible until the order is checked again).
//   -> the order view (see GET /api/sales-orders/[id]).

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
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
    const reason = orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null;
  if (!body || !Array.isArray(body.lines)) return NextResponse.json({ error: "lines must be an array" }, { status: 400 });

  const incoming = body.lines as { id?: unknown }[];
  const cleaned = cleanOrderLines(body.lines);
  // cleanOrderLines drops blank lines, so carry the optional ids across the same filter.
  const ids: (string | null)[] = [];
  for (const raw of incoming) {
    const d = (raw as { description?: unknown })?.description;
    if (typeof d === "string" && d.trim()) ids.push(typeof raw?.id === "string" ? raw.id : null);
    if (ids.length >= cleaned.length) break;
  }

  const checked = await checkLineProducts(supabase, tenantId, cleaned, true);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 404 });
  const lines = checked.lines;

  const existing = await loadLines(supabase, tenantId, id);
  const existingById = new Map(existing.map((l) => [l.id, l]));
  const keepIds = new Set<string>();
  const carry = lines.map((_, i) => {
    const old = ids[i] ? existingById.get(ids[i] as string) : undefined;
    if (old && !keepIds.has(old.id)) {
      keepIds.add(old.id);
      // The earlier answer stays on show but is stale: availability_at is cleared.
      return { id: old.id, confirmed_qty: old.confirmed_qty, confirmed_date: old.confirmed_date, availability_source: old.availability_source, availability_at: null };
    }
    return { id: null as string | null, confirmed_qty: null, confirmed_date: null, availability_source: null, availability_at: null };
  });

  const rows = lineRows(tenantId, id, lines, carry);
  const removed = existing.filter((l) => !keepIds.has(l.id)).map((l) => l.id);
  if (removed.length > 0) {
    const { error } = await supabase.from("sales_order_lines").delete().eq("tenant_id", tenantId).eq("order_id", id).in("id", removed);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const kept = rows.map((r, i) => ({ r, id: carry[i].id })).filter((x) => x.id);
  for (const { r, id: lineId } of kept) {
    const { error } = await supabase.from("sales_order_lines").update(r).eq("id", lineId as string).eq("order_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const fresh = rows.filter((_, i) => !carry[i].id);
  if (fresh.length > 0) {
    const { error } = await supabase.from("sales_order_lines").insert(fresh);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totals = computeOrderTotals(lines, Number(order.shipping_amount ?? 0));
  const expected = expectedDateOf(carry);
  const { error: headErr } = await supabase.from("sales_orders").update({ ...totals, expected_date: expected, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  if (headErr) return NextResponse.json({ error: headErr.message }, { status: 500 });

  const snap = (l: { description: string; qty: number; unit_price: number; line_total: number }): LineSnapshot => ({ label: l.description, qty: Number(l.qty), rate: Number(l.unit_price), amount: Number(l.line_total) });
  const changes = diffLineItems(existing.map(snap), lines.map(snap));
  if (changes.length > 0 || order.total !== totals.total) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [...changes, ...(Number(order.total) !== totals.total ? [{ field: "total", from: Number(order.total), to: totals.total }] : [])],
    });
  }

  const after = await loadOrder(supabase, tenantId, id);
  if (after.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await buildOrderView(supabase, tenantId, after.value.order, after.value.erpLinked));
}
