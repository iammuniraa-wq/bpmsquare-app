import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { emitInvoiceOverdue } from "@/lib/events/emitters";

export const maxDuration = 60;

// GET /api/events/cron/invoice-overdue -- daily. Emits `invoice.overdue` for
// invoices that are unpaid and past their due date. It only emits: it does
// not change an invoice's status, so nothing a tenant sees today moves.
//
// Platform-wide by nature (a cron is not per-tenant); each invoice row
// carries its own tenant_id and the event is written under THAT tenant.
// Only invoices that went overdue in the last WINDOW_DAYS are looked at, so a
// missed run still catches up but a years-old unpaid invoice never clogs it;
// the event's natural key makes re-seeing an invoice a no-op.
const WINDOW_DAYS = 7;
const LIMIT = 1000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("invoices")
    .select("id, tenant_id, ref, account_id, contact_id, total, paid_amount, due_date, status")
    .in("status", ["sent", "partial", "overdue"])
    .gte("due_date", from)
    .lt("due_date", to)
    .limit(LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let emitted = 0;
  for (const inv of data ?? []) {
    const outstanding = (inv.total ?? 0) - (inv.paid_amount ?? 0);
    if (outstanding <= 0 || !inv.due_date) continue;
    const ok = await emitInvoiceOverdue(inv.tenant_id, {
      invoiceId: inv.id, ref: inv.ref, dueDate: inv.due_date, outstanding,
      accountId: inv.account_id, contactId: inv.contact_id,
    });
    if (ok) emitted++;
  }

  return NextResponse.json({ ok: true, looked_at: data?.length ?? 0, emitted });
}
