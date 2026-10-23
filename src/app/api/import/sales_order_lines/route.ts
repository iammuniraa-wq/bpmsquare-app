import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { fetchAllRows, insertRows, nameKey, readImportBody, type PreparedRow } from "@/lib/import/server";
import { editableOrderIds, recomputeSalesOrderTotals } from "@/lib/import/salesOrderLinesServer";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import { cleanDate, clampMoney, clampPercent, clampQty, lineNet } from "@/lib/salesOrders/totals";
import type { RowOutcome } from "@/lib/import/types";

type OrderRow = { id: string; ref: string; status: string; origin: string };

const num = (v: string | undefined, fallback: number): number => {
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Adds new lines to sales orders that already exist, found by Order ID. Only orders that are still editable (the one edit
 * rule: a draft made here that no ERP has accepted) take lines. A line made here is a free-text line (no product link),
 * so it carries no stock or lead time: its availability is asked for on the order. The order's totals and expected
 * delivery are re-derived afterwards with the order's own arithmetic. One change-history entry per order, not per line.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "sales_order_lines");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "sales_orders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const orders = await fetchAllRows<OrderRow>(supabase, "sales_orders", "id, ref, status, origin", tenantId);
  const orderByRef = new Map(orders.map((o) => [nameKey(o.ref), o]));
  const editable = await editableOrderIds(supabase, tenantId, orders);

  const prepared: (PreparedRow & { orderId: string })[] = [];
  const outcomes: RowOutcome[] = [];
  const resolved: { rowNum: number; order: OrderRow; values: Record<string, string> }[] = [];

  for (const { rowNum, values } of rows) {
    const order = orderByRef.get(nameKey(values.sales_order_ref ?? ""));
    if (!order) {
      outcomes.push({ rowNum, status: "failed", reason: `Order "${values.sales_order_ref ?? ""}" was not found. Check the Order ID against an export of Sales Orders` });
      continue;
    }
    if (!editable.has(order.id)) {
      outcomes.push({ rowNum, status: "failed", reason: `Order ${order.ref} is ${order.origin === "erp" ? "made by the ERP" : order.status}. Lines can only be added to a draft order that no ERP has accepted` });
      continue;
    }
    if (!values.description?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "description is required" });
      continue;
    }
    if (values.requested_date?.trim() && !cleanDate(values.requested_date.trim())) {
      outcomes.push({ rowNum, status: "failed", reason: "requested_date must be a date (YYYY-MM-DD)" });
      continue;
    }
    resolved.push({ rowNum, order, values });
  }

  // The next line number on each order the file touches.
  const existing = new Map<string, number>();
  const touched = [...new Set(resolved.map((r) => r.order.id))];
  for (let i = 0; i < touched.length; i += 150) {
    const { data } = await supabase.from("sales_order_lines").select("order_id").in("order_id", touched.slice(i, i + 150)).eq("tenant_id", tenantId);
    for (const l of (data ?? []) as { order_id: string }[]) existing.set(l.order_id, (existing.get(l.order_id) ?? 0) + 1);
  }

  for (const { rowNum, order, values } of resolved) {
    const qty = clampQty(num(values.qty, 1));
    const unitPrice = clampMoney(num(values.unit_price, 0));
    const discountPct = clampPercent(num(values.discount_pct, 0));
    const lineNo = (existing.get(order.id) ?? 0) + 1;
    existing.set(order.id, lineNo);
    prepared.push({
      rowNum,
      orderId: order.id,
      record: {
        tenant_id: tenantId,
        order_id: order.id,
        line_no: lineNo,
        description: values.description.trim().slice(0, 1000),
        printed_text: values.printed_text?.trim() ? values.printed_text.trim().slice(0, 4000) : null,
        uom: values.uom?.trim() ? values.uom.trim().slice(0, 20) : null,
        qty,
        unit_price: unitPrice,
        discount_pct: discountPct,
        tax_pct: clampPercent(num(values.tax_pct, 0)),
        line_total: lineNet(qty, unitPrice, discountPct),
        requested_date: values.requested_date?.trim() ? cleanDate(values.requested_date.trim()) : null,
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, failed: outcomes.length, outcomes });

  const result = await insertRows(supabase, "sales_order_lines", prepared, outcomes);

  const insertedRowNums = new Set(result.outcomes.filter((o) => o.status === "inserted").map((o) => o.rowNum));
  const touchedOrderIds = [...new Set(prepared.filter((p) => insertedRowNums.has(p.rowNum)).map((p) => p.orderId))];

  if (touchedOrderIds.length > 0) {
    await recomputeSalesOrderTotals(supabase, tenantId, touchedOrderIds, { markStale: true });

    const user = await getAuthUser();
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const logRows: ChangeLogEntryParams[] = touchedOrderIds.map((orderId) => ({
      tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: orderById.get(orderId)?.ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: prepared.filter((p) => p.orderId === orderId && insertedRowNums.has(p.rowNum)).map((l) => ({
        field: "Line added", from: null,
        to: `${l.record.description}: qty ${l.record.qty} × price ${l.record.unit_price} = ${l.record.line_total}`,
      })),
    }));
    await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}
