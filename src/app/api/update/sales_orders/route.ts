import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { editableOrderIds, recomputeSalesOrderTotals } from "@/lib/import/salesOrderLinesServer";
import { mergeCfValues } from "@/lib/customData";
import { cleanCurrency, cleanText } from "@/lib/salesOrders/clean";
import { cleanDate, clampMoney } from "@/lib/salesOrders/totals";
import { orderAnnotatable } from "@/lib/salesOrders/types";
import type { RowOutcome } from "@/lib/import/types";

// Bulk update of sales order HEADERS, matched on real id only (bpmsquarecore section 3). The same two tiers as
// PATCH /api/sales-orders/[id]: customer PO, notes and custom (cf_) columns stay open on any order made here that is not
// cancelled; requested date, currency, shipping and terms change only while the order is still editable (a draft that no ERP
// has accepted). Status, type, customer and contact have their own actions and never change from a file. Shipping feeds the
// stored total, so it is recomputed with the order's own arithmetic. cf_ columns merge into custom_data without touching
// the order's other keys.
const ANNOTATABLE_TEXT = { customer_po: 100, notes: 4000 } as const;
const EDITABLE_TEXT = { terms: 4000 } as const;

type Before = { id: string; ref: string; status: string; origin: string; custom_data?: Record<string, unknown> | null };

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "sales_orders");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "sales_orders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x))];
  const { data: beforeRows } = ids.length > 0
    ? await supabase.from("sales_orders").select("*").in("id", ids).eq("tenant_id", tenantId)
    : { data: [] };
  const befores = (beforeRows ?? []) as Before[];
  const beforeById = new Map(befores.map((b) => [b.id, b]));
  const editable = await editableOrderIds(supabase, tenantId, befores);

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  const reshaped: string[] = [];
  const now = new Date().toISOString();

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const before = beforeById.get(id);
    if (!before) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }

    const patch: Record<string, unknown> = {};
    const asked = (k: string) => k in values && values[k] !== undefined && values[k].trim() !== "";
    const editableKeys = ["requested_date", "currency", "shipping_amount", ...Object.keys(EDITABLE_TEXT)].filter(asked);
    const openKeys = [...Object.keys(ANNOTATABLE_TEXT)].filter(asked);

    if (editableKeys.length > 0 && !editable.has(id)) {
      outcomes.push({ rowNum, status: "failed", reason: `Order ${before.ref} is ${before.origin === "erp" ? "made by the ERP" : before.status === "draft" ? "accepted by the ERP" : before.status}. ${editableKeys.join(", ")} can only change on a draft order that no ERP has accepted` });
      continue;
    }
    if ((openKeys.length > 0 || Object.keys(values).some((k) => k.startsWith("cf_"))) && !orderAnnotatable(before as Parameters<typeof orderAnnotatable>[0])) {
      outcomes.push({ rowNum, status: "failed", reason: `Order ${before.ref} is ${before.origin === "erp" ? "made by the ERP and read-only here" : before.status}, so it can't be changed` });
      continue;
    }

    for (const [k, max] of Object.entries(ANNOTATABLE_TEXT)) if (k in values) patch[k] = cleanText(values[k], max);
    for (const [k, max] of Object.entries(EDITABLE_TEXT)) if (asked(k)) patch[k] = cleanText(values[k], max);
    if (asked("requested_date")) {
      const d = cleanDate(values.requested_date.trim());
      if (!d) { outcomes.push({ rowNum, status: "failed", reason: "requested_date must be a date (YYYY-MM-DD)" }); continue; }
      patch.requested_date = d;
    }
    if (asked("currency")) {
      const c = cleanCurrency(values.currency.trim().toUpperCase());
      if (!c) { outcomes.push({ rowNum, status: "failed", reason: "currency is not a currency this workspace can use" }); continue; }
      patch.currency = c;
    }
    if (asked("shipping_amount")) {
      const n = Number(values.shipping_amount.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) { outcomes.push({ rowNum, status: "failed", reason: "shipping_amount must be a number, zero or more" }); continue; }
      patch.shipping_amount = clampMoney(n);
      reshaped.push(id);
    }

    // A database that returns no custom_data key at all has nothing to merge into.
    if ("custom_data" in before) {
      const merged = mergeCfValues(before.custom_data, values);
      if (merged) patch.custom_data = merged;
    }

    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch: { ...patch, updated_at: now }, diffPatch: patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  const result = await updateRows(supabase, "sales_orders", tenantId, prepared, outcomes, {
    objectType: "sales_orders", labelField: "ref", actorId: user?.id, actorEmail: user?.email,
  });
  const changedShipping = reshaped.filter((id) => prepared.some((p) => p.id === id));
  if (changedShipping.length > 0) await recomputeSalesOrderTotals(supabase, tenantId, changedShipping);
  return NextResponse.json(result);
}
