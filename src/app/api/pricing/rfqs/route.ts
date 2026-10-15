import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange } from "@/lib/changeLog";
import { sendRfqEmail } from "@/lib/pricing/rfqServer";
import { PURCHASE_PATH } from "@/lib/pricing/costSheet";
import { tenantHasRfq, createRfq, loadRfqBundle, sendToSupplier, renderRfqPdf, isMissingRelation } from "@/lib/rfq/server";
import { rfqConfig } from "@/lib/rfq/types";

// RFQs (cost-based step 2): the "no cost on file -- ask the supplier"
// outcome as a record. pricing_rfqs is select-only under RLS; these
// service-role routes are the only write path.
//
// GET  /api/pricing/rfqs?status=&product_id=   -- pricing workcenter view
// POST /api/pricing/rfqs                       -- create (and send) one
//   { product_id, supplier_id?, quantity?, uom?, quote_id?, cost_model_code?,
//     path?, message?, send?: boolean }
// A rep creates an RFQ from the quote form, so create needs the quote
// flags, not the pricing workcenter -- the same gate as price-line.

export async function GET(req: NextRequest) {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
    if (!canViewWorkcenter(perms, "pricing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const sp = req.nextUrl.searchParams;
  let q = createAdminSupabase()
    .from("pricing_rfqs")
    .select("*, products(id, ref, name, uom), suppliers(id, ref, name, email)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  const status = sp.get("status");
  if (status) q = q.eq("status", status);
  const productId = sp.get("product_id");
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  // 42P01: migration 0113 pending -- an empty list, not a crash.
  if (error) return NextResponse.json({ rfqs: [], pending_migration: true });
  return NextResponse.json({ rfqs: data ?? [] });
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pricing_engine")) || !(await tenantHasFeature(supabase, tenantId, "pricing_engine_quotes"))) {
    return NextResponse.json({ error: "Pricing Engine isn't enabled for quote lines on this workspace" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    product_id?: string; supplier_id?: string | null; quantity?: number; uom?: string | null; quote_id?: string | null;
    standard_quote_id?: string | null; opportunity_id?: string | null;
    cost_model_code?: string; path?: string; message?: string | null; send?: boolean;
  } | null;
  if (!body?.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 422 });

  const admin = createAdminSupabase();
  // Every foreign id from the body is verified against this tenant first.
  const { data: product } = await admin.from("products").select("id, ref, name, uom").eq("id", body.product_id).eq("tenant_id", tenantId).maybeSingle();
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  let supplier: { id: string; name: string; email: string | null } | null = null;
  if (body.supplier_id) {
    const { data: s } = await admin.from("suppliers").select("id, name, email").eq("id", body.supplier_id).eq("tenant_id", tenantId).maybeSingle();
    if (!s) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    supplier = s as { id: string; name: string; email: string | null };
  }
  let quoteId: string | null = null;
  if (body.quote_id) {
    const { data: q } = await admin.from("quotes").select("id").eq("id", body.quote_id).eq("tenant_id", tenantId).maybeSingle();
    quoteId = q ? (q.id as string) : null;
  }
  let standardQuoteId: string | null = null;
  if (body.standard_quote_id) {
    const { data: q } = await admin.from("standard_quotes").select("id").eq("id", body.standard_quote_id).eq("tenant_id", tenantId).maybeSingle();
    standardQuoteId = q ? (q.id as string) : null;
  }
  // The editor sends a deal's id for a deal line; it used to be dropped here,
  // so deal-line RFQs lost their back-reference (docs/rfq-architecture.md §1.3).
  let opportunityId: string | null = null;
  if (body.opportunity_id) {
    const { data: o } = await admin.from("opportunities").select("id").eq("id", body.opportunity_id).eq("tenant_id", tenantId).maybeSingle();
    opportunityId = o ? (o.id as string) : null;
  }
  const quantity = Number(body.quantity);
  const modelCode = (body.cost_model_code || "STANDARD_COST").toUpperCase();
  const path = body.path?.trim() || PURCHASE_PATH;
  if (/__|constructor|prototype/.test(path)) return NextResponse.json({ error: "Illegal path" }, { status: 422 });

  // RFQ module (0128): the same request becomes a full RFQ -- its own
  // record, the reply link and sheet, replies back into the tenant -- and the
  // caller gets the RFQ line id to remember on the quote line. Falls through
  // to the legacy single-supplier record when the module is off or 0128 isn't
  // applied yet.
  if (await tenantHasRfq(admin, tenantId)) {
    try {
      const user = await getAuthUser();
      const tenant = await getTenant();
      if (tenant && tenant.id === tenantId) {
        const originType = standardQuoteId ? "standard_quote" : quoteId ? "quote" : opportunityId ? "opportunity" : "pricing";
        const rfq = await createRfq({ admin, tenantId, userId, email: user?.email ?? null }, {
          origin_type: originType,
          origin_id: standardQuoteId ?? quoteId ?? opportunityId ?? null,
          notes_to_supplier: typeof body.message === "string" ? body.message : null,
          lines: [{ product_id: product.id, description: product.name, uom: body.uom ?? product.uom ?? null, qty: Number.isFinite(quantity) && quantity > 0 ? quantity : null, cost_model_code: modelCode, path }],
          supplier_ids: supplier ? [supplier.id] : [],
        }, rfqConfig(tenant.config?.rfq));
        const bundle = await loadRfqBundle(admin, tenantId, rfq.id, { messages: false });
        let sent: { ok: true; to: string[]; redirected: boolean } | { ok: false; reason: string } = { ok: false, reason: supplier ? "not sent" : "No supplier chosen." };
        const rs = bundle?.suppliers[0];
        if (body.send !== false && bundle && rs) {
          const pdf = rfqConfig(tenant.config?.rfq).attach_pdf ? await renderRfqPdf(admin, tenant, bundle) : null;
          const r = await sendToSupplier(admin, { tenant, bundle, rs, kind: "request", pdf, actor: { id: userId, email: user?.email ?? null } });
          sent = r.ok ? { ok: true, to: r.to, redirected: r.redirected } : { ok: false, reason: r.reason };
        }
        return NextResponse.json({ id: rfq.id, ref: rfq.ref, status: sent.ok ? "sent" : "draft", sent, v2: true, rfq_line_id: bundle?.lines[0]?.id ?? null }, { status: 201 });
      }
    } catch (e) {
      const err = e as { status?: number; message?: string; code?: string };
      if (!(err.status === 503 || isMissingRelation(err))) {
        return NextResponse.json({ error: err.message ?? "Could not create the RFQ" }, { status: err.status ?? 500 });
      }
      // 0128 pending: fall through to the legacy record.
    }
  }

  const record: Record<string, unknown> = {
    tenant_id: tenantId, product_id: product.id, supplier_id: supplier?.id ?? null,
    cost_model_code: modelCode, path,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null, uom: body.uom ?? product.uom ?? null,
    status: "draft", requested_by: userId, quote_id: quoteId,
    ...(opportunityId ? { opportunity_id: opportunityId } : {}),
    message: typeof body.message === "string" ? body.message.slice(0, 4000) : null,
  };
  // standard_quote_id arrives with 0114; while that is pending the RFQ is
  // still raised, just without the back-reference.
  let { data: rfq, error } = standardQuoteId
    ? await insertWithMasterRef<{ id: string; ref: string }>(admin, "pricing_rfqs", tenantId, { ...record, standard_quote_id: standardQuoteId }, "id, ref")
    : await insertWithMasterRef<{ id: string; ref: string }>(admin, "pricing_rfqs", tenantId, record, "id, ref");
  if (error?.code === "42703" && standardQuoteId) {
    ({ data: rfq, error } = await insertWithMasterRef<{ id: string; ref: string }>(admin, "pricing_rfqs", tenantId, record, "id, ref"));
  }
  if (error || !rfq) {
    const pending = error?.code === "42P01";
    return NextResponse.json({ error: pending ? "RFQs need migration 0113 applied to this database." : (error?.message ?? "Could not create the RFQ") }, { status: pending ? 503 : 500 });
  }

  const user = await getAuthUser();
  await logChange(admin, {
    tenantId, objectType: "pricing_rfqs", objectId: rfq.id, objectLabel: rfq.ref, action: "create",
    actorId: userId, actorEmail: user?.email ?? null,
    changes: [{ field: "product", from: null, to: product.name }, ...(supplier ? [{ field: "supplier", from: null, to: supplier.name }] : [])],
  });

  let sent: { ok: true; to: string[]; redirected: boolean } | { ok: false; reason: string } = { ok: false, reason: "not sent" };
  if (body.send !== false) {
    const tenant = await getTenant();
    if (!supplier?.email) {
      sent = { ok: false, reason: supplier ? `${supplier.name} has no email address on file.` : "No supplier chosen." };
    } else if (!tenant) {
      sent = { ok: false, reason: "Workspace not resolved." };
    } else {
      sent = await sendRfqEmail(admin, {
        tenant, tenantId, rfqId: rfq.id, rfqRef: rfq.ref,
        supplier: { name: supplier.name, email: supplier.email },
        product: { name: product.name, ref: product.ref as string | null, uom: (body.uom ?? product.uom ?? null) as string | null },
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
        message: typeof body.message === "string" ? body.message : null,
        actor: { id: userId, email: user?.email ?? null },
      });
    }
  }

  return NextResponse.json({ id: rfq.id, ref: rfq.ref, status: sent.ok ? "sent" : "draft", sent }, { status: 201 });
}
