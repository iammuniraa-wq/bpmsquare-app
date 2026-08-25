import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { runPrice, PricingConfigError } from "@/lib/pricing/server";
import { PricingError, DslError } from "@/lib/pricing-core";

/**
 * The Quote-form side of the PricingEngine integration (bpmsquarecore.md
 * §10 doctrine applied here: "propose, never silently decide"). A rep
 * clicks "Price with engine" on one line; this returns a SUGGESTED unit
 * rate the rep still has to accept -- it never writes to the quote itself.
 *
 * Deliberately narrow for v1:
 * - Always prices against the "default" Price Book's PUBLISHED version
 *   only -- never a draft, and no per-line Price Book routing yet (that's
 *   tracked follow-up work, not faked here).
 *   pricing_engine + pricing_engine_quotes are BOTH required (see
 *   constants.ts) -- a tenant can have the Pricing workcenter without this
 *   ever reaching a real quote.
 * - The engine's `net` for the requested quantity is divided back down to
 *   a per-unit rate, since a quote line is qty x rate, not qty x (already
 *   computed net). Any tax/freight/rebate components the tenant's Price
 *   Book includes ARE part of that number -- the client labels this
 *   plainly rather than pretending it's a bare list price.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  if (!(await tenantHasFeature(supabase, tenantId, "pricing_engine")) || !(await tenantHasFeature(supabase, tenantId, "pricing_engine_quotes"))) {
    return NextResponse.json({ error: "Pricing Engine isn't enabled for quote lines on this workspace" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    product_id?: string; account_id?: string; quantity?: number;
  } | null;
  const quantity = Number(body?.quantity);
  if (!body?.product_id || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "product_id and a positive quantity are required" }, { status: 422 });
  }

  const { data: product } = await supabase
    .from("products").select("id, name, category, sub_category")
    .eq("id", body.product_id).eq("tenant_id", tenantId).maybeSingle();
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  let account: { state: string | null; industry: string | null; type: string } | null = null;
  if (body.account_id) {
    const { data } = await supabase
      .from("accounts").select("state, industry, type")
      .eq("id", body.account_id).eq("tenant_id", tenantId).maybeSingle();
    account = data ?? null;
  }

  const attributes: Record<string, unknown> = { document_type: "quote" };
  if (account?.state) attributes.region = account.state;
  if (account?.industry) attributes.industry = account.industry;
  if (account?.type) attributes["customer.tier"] = account.type;

  const lineAttributes: Record<string, unknown> = {};
  if (product.category) lineAttributes["product.category"] = product.category;
  if (product.sub_category) lineAttributes["product.sub_category"] = product.sub_category;
  lineAttributes["product.base_model"] = product.name;

  try {
    const { result } = await runPrice(
      tenantId,
      { attributes, lines: [{ line_no: 1, quantity, attributes: lineAttributes }] },
      { pricingArea: "default" }
    );
    const line = result.lines[0];
    return NextResponse.json({
      unit_rate: line.net / quantity,
      net: line.net, currency: result.currency,
    });
  } catch (e) {
    if (e instanceof PricingConfigError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PricingError) return NextResponse.json({ error: `${e.code}: ${e.message}` }, { status: 422 });
    if (e instanceof DslError) return NextResponse.json({ error: `FORMULA_ERROR: ${e.message}` }, { status: 422 });
    console.error("quote price-line failed:", e);
    return NextResponse.json({ error: "Pricing failed — try again, or enter the rate manually." }, { status: 500 });
  }
}
