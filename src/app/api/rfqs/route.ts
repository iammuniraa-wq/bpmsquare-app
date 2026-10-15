import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, createRfq, isMissingRelation, loadRfqBundle, sendToSupplier, renderRfqPdf, type NewRfq } from "@/lib/rfq/server";
import { getTenant } from "@/lib/tenant";
import { rfqConfig, RFQ_ORIGIN_TYPES, RFQ_STATUSES, type RfqOriginType } from "@/lib/rfq/types";

// RFQs (0128). GET lists; POST creates -- by hand, or from any record whose
// price/cost could not be found (origin_type/origin_id), optionally sending
// to every chosen supplier in the same call.
//
// GET  /api/rfqs?status=&origin_type=&origin_id=&q=
// POST /api/rfqs { title?, origin_type?, origin_id?, respond_by?, required_by?,
//                  delivery_terms?, currency?, notes_to_supplier?, notes_internal?,
//                  lines: [{ product_id?, description, spec?, uom?, qty?, required_by? }],
//                  supplier_ids?: string[], send?: boolean, message?: string }
//   -> { id, ref, line_ids: string[] (same order as lines), sent?: [...] }

export async function GET(req: NextRequest) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const sp = req.nextUrl.searchParams;
    let q = admin.from("rfqs")
      .select("id, ref, title, status, origin_type, origin_id, origin_label, respond_by, required_by, created_at, updated_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
    const status = sp.get("status");
    if (status && (RFQ_STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
    const ot = sp.get("origin_type");
    if (ot && (RFQ_ORIGIN_TYPES as readonly string[]).includes(ot)) q = q.eq("origin_type", ot);
    const oid = sp.get("origin_id");
    if (oid && /^[0-9a-f-]{36}$/i.test(oid)) q = q.eq("origin_id", oid);
    const { data, error } = await q;
    if (error) {
      if (isMissingRelation(error)) return NextResponse.json({ rfqs: [], pending_migration: true });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const term = (sp.get("q") ?? "").trim().toLowerCase();
    const rows = (data ?? []).filter((r) => !term || `${r.ref ?? ""} ${r.title} ${r.origin_label ?? ""}`.toLowerCase().includes(term));
    return NextResponse.json({ rfqs: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await rfqAccess(true);
    const body = (await req.json().catch(() => null)) as (NewRfq & { send?: boolean; message?: string | null }) | null;
    if (!body || !Array.isArray(body.lines)) return NextResponse.json({ error: "lines are required" }, { status: 422 });
    if (body.origin_type && !(RFQ_ORIGIN_TYPES as readonly string[]).includes(body.origin_type)) {
      return NextResponse.json({ error: "Unknown origin_type" }, { status: 422 });
    }
    const tenant = await getTenant();
    if (!tenant || tenant.id !== ctx.tenantId) return NextResponse.json({ error: "Workspace not resolved" }, { status: 400 });
    const cfg = rfqConfig(tenant.config?.rfq);
    const rfq = await createRfq(ctx, { ...body, origin_type: (body.origin_type ?? "manual") as RfqOriginType }, cfg);

    const bundle = await loadRfqBundle(ctx.admin, ctx.tenantId, rfq.id, { messages: false });
    const lineIds = (bundle?.lines ?? []).map((l) => l.id);
    let sent: { supplier: string; ok: boolean; reason?: string; redirected?: boolean }[] | undefined;
    if (body.send && bundle) {
      sent = [];
      const pdf = bundle.suppliers.length && cfg.attach_pdf ? await renderRfqPdf(ctx.admin, tenant, bundle) : null;
      for (const rs of bundle.suppliers) {
        const r = await sendToSupplier(ctx.admin, { tenant, bundle, rs, kind: "request", pdf, message: body.message ?? null, actor: { id: ctx.userId, email: ctx.email } });
        sent.push({ supplier: rs.suppliers?.name ?? "", ok: r.ok, ...(r.ok ? { redirected: r.redirected } : { reason: r.reason }) });
      }
    }
    return NextResponse.json({ id: rfq.id, ref: rfq.ref, line_ids: lineIds, sent }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
