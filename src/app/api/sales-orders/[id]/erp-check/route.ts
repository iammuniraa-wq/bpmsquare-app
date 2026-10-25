import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { runOrderChecks } from "@/lib/salesOrders/erpChecksServer";
import { failure, guard } from "@/lib/salesOrders/server";

// POST /api/sales-orders/[id]/erp-check
//   Check with ERP: read the customer's credit position and each product's price and stock from the connected Dynamics 365
//   Sales, compare them with the order, and store the three results on it. NOTHING IS SAVED IN THE ERP -- every call to it
//   is a read. Needs the Sales Orders edit permission and a connected ERP. The tenant is the session's; the order id is
//   verified against it (a foreign id is a 404), and the ERP is only asked about ids this workspace's own links hold.
//   -> { ok, checks: [{ kind, status, message, detail, checked_at, stale }] }
//   404 not found | 403 no permission | 409 not ready (cancelled, already in the ERP, no lines, no customer) |
//   422 no ERP connected or not Dataverse | 502 the ERP could not be reached | 503 database update needed (bundle named).

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId, userId, role } = ctx;
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role as "admin" | "member"), "sales_orders")) {
    return NextResponse.json({ error: "You don't have permission to edit sales orders." }, { status: 403 });
  }
  const { id } = await params;
  const r = await runOrderChecks(createAdminSupabase(), tenantId, id, { userId });
  switch (r.kind) {
    case "ok": return NextResponse.json({ ok: true, checks: r.checks });
    case "missing": return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "pending": return NextResponse.json({ error: "A database update is needed before orders can be checked with the ERP.", needsDatabaseUpdate: true, bundle: r.bundle }, { status: 503 });
    case "not_ready": return NextResponse.json({ error: r.message }, { status: 409 });
    case "no_connector": case "unsupported": return NextResponse.json({ error: r.message }, { status: 422 });
    case "unreachable": return NextResponse.json({ error: r.message }, { status: 502 });
    case "error": return NextResponse.json({ error: r.message }, { status: 500 });
  }
}
