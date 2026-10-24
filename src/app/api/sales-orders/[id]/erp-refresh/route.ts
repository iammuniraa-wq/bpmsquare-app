import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { refreshOrderDocuments } from "@/lib/connectors/d365/orders";
import { ERP_DOCUMENTS_BUNDLE } from "@/lib/salesOrders/erpDocs";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";

// POST /api/sales-orders/[id]/erp-refresh
//   The Refresh button on the ERP tab: ask the ERP again about this order (its status, and for an order read from the
//   ERP its lines and totals, then its invoices). The tenant is the session's; the order must belong to it, and the
//   ERP is only ever asked about the id this workspace's own connector link holds. A second press within ten seconds
//   answers `throttled: true` without calling the ERP. -> { ok, throttled, invoices, erp_number }.

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = await refreshOrderDocuments(createAdminSupabase(), tenantId, id, { withHeader: true, trigger: "manual", userId: ctx.userId });
  switch (r.kind) {
    case "missing": return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "not_linked": return NextResponse.json({ error: "This order is not in an ERP, so there is nothing to read." }, { status: 409 });
    case "pending":
      return NextResponse.json({ error: "A database update is needed before the ERP can be read.", needsDatabaseUpdate: true, bundle: ERP_DOCUMENTS_BUNDLE }, { status: 503 });
    case "error": return NextResponse.json({ error: r.message }, { status: 502 });
    case "ok":
      return NextResponse.json({ ok: true, throttled: r.throttled, invoices: r.documents?.read ?? 0, erp_number: r.erpNumber, ...(r.documents?.error ? { warning: r.documents.error } : {}) });
  }
}
