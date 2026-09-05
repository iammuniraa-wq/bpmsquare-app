import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { PricingConfigError } from "@/lib/pricing/server";
import { priceDocumentLine } from "@/lib/pricing/quoteLine";
import { PricingError, DslError } from "@/lib/pricing-core";

/**
 * The Quote-form side of BPMSquare Pricing (bpmsquarecore.md §10 doctrine:
 * "propose, never silently decide"). A rep clicks "Price with engine" on
 * one line; this returns a SUGGESTED unit rate with its trace, or the
 * NEEDS_RFQ outcome, and never writes to the quote itself. The line is
 * routed to a Price Book by the tenant's routing rules
 * (src/lib/pricing/routing.ts); the product's cost sheet and own cost
 * figures ride along (cost-based step 2).
 *
 * pricing_engine + pricing_engine_quotes are BOTH required -- a tenant can
 * have the Pricing workcenter without this ever reaching a real quote.
 * The stored document id comes back so the form can pin it onto the line.
 */
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

  const body = await request.json().catch(() => null) as {
    product_id?: string; account_id?: string; quantity?: number; quote_id?: string;
  } | null;
  const quantity = Number(body?.quantity);
  if (!body?.product_id || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "product_id and a positive quantity are required" }, { status: 422 });
  }

  // The quote is only a provenance reference on the stored context, but a
  // client-supplied id is still verified against the tenant before it is
  // recorded (MULTI_TENANT_GUARDRAILS: no unverified foreign ids). The
  // account id is verified inside priceDocumentLine's tenant-scoped read.
  let quoteId: string | null = null;
  if (typeof body.quote_id === "string" && body.quote_id) {
    const { data: q } = await supabase.from("quotes").select("id").eq("id", body.quote_id).eq("tenant_id", tenantId).maybeSingle();
    quoteId = q?.id ? (q.id as string) : null;
  }

  const tenant = await getTenant();

  try {
    const outcome = await priceDocumentLine(tenantId, {
      productId: body.product_id,
      accountId: body.account_id ?? null,
      quantity,
      documentType: "quote",
      sourceId: quoteId,
      actorId: userId,
      pricingConfig: tenant?.config?.pricing ?? null,
    });
    if (!outcome.ok) return NextResponse.json(outcome, { status: 409 });
    return NextResponse.json(outcome);
  } catch (e) {
    if (e instanceof PricingConfigError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PricingError) return NextResponse.json({ error: `${e.code}: ${e.message}` }, { status: 422 });
    if (e instanceof DslError) return NextResponse.json({ error: `FORMULA_ERROR: ${e.message}` }, { status: 422 });
    console.error("quote price-line failed:", e);
    return NextResponse.json({ error: "Pricing failed — try again, or enter the rate manually." }, { status: 500 });
  }
}
