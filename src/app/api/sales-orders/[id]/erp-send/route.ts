import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { sendOrderToErp } from "@/lib/salesOrders/erpSend";
import { failure, guard } from "@/lib/salesOrders/server";

// POST /api/sales-orders/[id]/erp-send   body: { confirm?: boolean }
//   Send to ERP: the order and its lines become a Sales Order in the connected Dynamics 365 Sales. Separate from the check.
//   A check that is not a current pass (failed, warning, out of date, never run) is a warning, not a block: without
//   `confirm: true` the answer is 409 with `needs_confirmation` and the `items` to read. Needs the Sales Orders edit permission
//   and a connected ERP. The tenant is the session's; the order id is verified against it.
//   -> 200 { ok, erp_number, link }
//   409 { already_sent, erp_number } on a second press | 409 { needs_confirmation, items } | 409 { error } while another send runs
//   404 not found | 403 no permission | 422 not ready or no ERP | 502 { step, error, fix } the ERP refused or was unreachable
//   (the order stays editable) | 503 database update needed (bundle named).

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId, userId, role } = ctx;
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role as "admin" | "member"), "sales_orders")) {
    return NextResponse.json({ error: "You don't have permission to edit sales orders." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const { id } = await params;
  const r = await sendOrderToErp(createAdminSupabase(), tenantId, id, { userId, confirm: body?.confirm === true });
  switch (r.state) {
    case "sent": return NextResponse.json({ ok: true, erp_number: r.erpNumber, link: r.link });
    case "already_sent":
      return NextResponse.json({ error: r.erpNumber ? `This order is already in the ERP as ${r.erpNumber}.` : "This order is already in the ERP.", already_sent: true, erp_number: r.erpNumber }, { status: 409 });
    case "needs_confirmation":
      return NextResponse.json({ error: "Some checks are not a current pass. Read them and confirm to send.", needs_confirmation: true, items: r.items }, { status: 409 });
    case "in_progress": return NextResponse.json({ error: "This order is being sent right now. Wait a moment and check the ERP tab." }, { status: 409 });
    case "missing": return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "pending": return NextResponse.json({ error: "A database update is needed before orders can be sent to the ERP.", needsDatabaseUpdate: true, bundle: r.bundle }, { status: 503 });
    case "not_ready": case "no_connector": case "unsupported": return NextResponse.json({ error: r.message }, { status: 422 });
    case "unreachable": return NextResponse.json({ error: r.message }, { status: 502 });
    case "failed": return NextResponse.json({ error: r.headline, fix: r.fix, step: r.step }, { status: 502 });
    case "error": return NextResponse.json({ error: r.message }, { status: 500 });
  }
}
