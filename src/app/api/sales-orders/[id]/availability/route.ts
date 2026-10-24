import { NextResponse, type NextRequest } from "next/server";
import { availabilityView } from "@/lib/salesOrders/availability";
import { refreshOrderAvailability } from "@/lib/salesOrders/availabilityServer";
import { failure, guard, loadLines, loadOrder, needsUpdate } from "@/lib/salesOrders/server";

// GET  /api/sales-orders/[id]/availability  the Availability tab: per line what was asked and wanted-by against what is
//      confirmed and when, with where the answer came from.
//   -> { order_id, stale, refreshed_at, expected_date, needs_attention,
//        lines: [{ id, line_no, description, qty, uom, requested_date, confirmed_qty, confirmed_date,
//                  source: "erp" | "master" | null, source_label: "ERP" | "Master data (estimate)" | null,
//                  checked_at, state: "ok" | "late" | "short" | "stale" | "not_checked" }] }
//   `stale` = some line was edited after its last check (availability_at is null but an earlier answer is kept).
// POST /api/sales-orders/[id]/availability  refreshes from master data (stock on hand from inventory matched by SKU,
//      product lead time). ERP rows are never overwritten here. Not for a cancelled order. Same answer as GET.

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(availabilityView(loaded.value.order, await loadLines(supabase, tenantId, id)));
}

export async function POST(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.value.order.status === "cancelled") return NextResponse.json({ error: "A cancelled order has no availability to check." }, { status: 409 });

  try {
    const r = await refreshOrderAvailability(supabase, tenantId, id);
    return NextResponse.json(availabilityView({ id, status: loaded.value.order.status, expected_date: r.expected_date }, r.lines));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not check availability" }, { status: 500 });
  }
}
