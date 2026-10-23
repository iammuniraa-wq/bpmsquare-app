import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { editableOrderIds, recomputeSalesOrderTotals } from "@/lib/import/salesOrderLinesServer";
import { SALES_ORDER_LINE_NUMBER_KEYS, SALES_ORDER_LINE_TEXT_KEYS } from "@/lib/import/salesOrderLinesSchema";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import { cleanDate, clampMoney, clampPercent, clampQty, lineNet } from "@/lib/salesOrders/totals";
import type { RowOutcome } from "@/lib/import/types";

type LineBefore = { id: string; order_id: string; description: string; qty: number; unit_price: number; discount_pct: number; tax_pct: number };

/**
 * Bulk-edits lines already on a sales order, matched by their own Record ID (the export's "id" column), never by Order ID:
 * an order has many lines and Update always targets one row. Only lines of orders that are still editable change (the one
 * edit rule: a draft made here that no ERP has accepted). The line total and the order's totals and expected delivery are
 * re-derived with the order's own arithmetic, availability on the order is marked stale, and the change is logged against
 * the owning order.
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

  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x))];
  const beforeRows: LineBefore[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("sales_order_lines").select("*").in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId);
    beforeRows.push(...((data ?? []) as LineBefore[]));
  }
  const beforeById = new Map(beforeRows.map((b) => [b.id, b]));

  const orderIds = [...new Set(beforeRows.map((b) => b.order_id))];
  const orderById = new Map<string, { id: string; ref: string; status: string; origin: string }>();
  for (let i = 0; i < orderIds.length; i += 150) {
    const { data } = await supabase.from("sales_orders").select("id, ref, status, origin").in("id", orderIds.slice(i, i + 150)).eq("tenant_id", tenantId);
    for (const o of (data ?? []) as { id: string; ref: string; status: string; origin: string }[]) orderById.set(o.id, o);
  }
  const editable = await editableOrderIds(supabase, tenantId, [...orderById.values()]);

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const before = beforeById.get(id);
    if (!before) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }
    const order = orderById.get(before.order_id);
    if (!order || !editable.has(order.id)) {
      outcomes.push({ rowNum, status: "failed", reason: `Order ${order?.ref ?? ""} can't be changed (${order?.origin === "erp" ? "made by the ERP" : order?.status ?? "not available"}). Lines can only change on a draft order that no ERP has accepted` });
      continue;
    }

    const patch: Record<string, unknown> = {};
    if ("description" in values && !values.description?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "description cannot be empty" });
      continue;
    }
    for (const key of SALES_ORDER_LINE_TEXT_KEYS) if (key in values) patch[key] = values[key]?.trim() || null;
    if ("requested_date" in values) {
      const v = values.requested_date?.trim() ?? "";
      if (v && !cleanDate(v)) { outcomes.push({ rowNum, status: "failed", reason: "requested_date must be a date (YYYY-MM-DD)" }); continue; }
      patch.requested_date = v || null;
    }

    const numberKeys = SALES_ORDER_LINE_NUMBER_KEYS.filter((k) => k in values && values[k]?.trim());
    let bad = false;
    for (const key of numberKeys) {
      const n = Number(values[key].replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) { outcomes.push({ rowNum, status: "failed", reason: `${key} must be a number, zero or more` }); bad = true; break; }
      patch[key] = key === "qty" ? clampQty(n) : key === "unit_price" ? clampMoney(n) : clampPercent(n);
    }
    if (bad) continue;
    if (numberKeys.some((k) => k === "qty" || k === "unit_price" || k === "discount_pct")) {
      const qty = (patch.qty as number | undefined) ?? Number(before.qty);
      const price = (patch.unit_price as number | undefined) ?? Number(before.unit_price);
      const disc = (patch.discount_pct as number | undefined) ?? Number(before.discount_pct);
      patch.line_total = lineNet(qty, price, disc);
    }

    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));

  const result = await updateRows(supabase, "sales_order_lines", tenantId, prepared, outcomes);

  const updatedIds = new Set(
    result.outcomes.filter((o) => o.status === "updated").map((o) => prepared.find((p) => p.rowNum === o.rowNum)?.id).filter((x): x is string => !!x)
  );
  const touchedOrderIds = [...new Set([...updatedIds].map((id) => beforeById.get(id)?.order_id).filter((x): x is string => !!x))];

  if (touchedOrderIds.length > 0) {
    await recomputeSalesOrderTotals(supabase, tenantId, touchedOrderIds, { markStale: true });

    const user = await getAuthUser();
    const logRows: ChangeLogEntryParams[] = [];
    for (const orderId of touchedOrderIds) {
      const order = orderById.get(orderId);
      if (!order) continue;
      const changes = [...updatedIds]
        .filter((id) => beforeById.get(id)?.order_id === orderId)
        .map((id) => {
          const b = beforeById.get(id)!;
          const p = prepared.find((row) => row.id === id)!.patch;
          const qty = "qty" in p ? p.qty : b.qty;
          const price = "unit_price" in p ? p.unit_price : b.unit_price;
          const description = "description" in p ? (p.description as string) : b.description;
          if (qty === b.qty && price === b.unit_price && description === b.description) return null;
          return { field: `Line: ${b.description}`, from: `qty ${b.qty} × price ${b.unit_price}`, to: `${description !== b.description ? `${description}, ` : ""}qty ${qty} × price ${price}` };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (changes.length > 0) logRows.push({ tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
    }
    if (logRows.length > 0) await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}
