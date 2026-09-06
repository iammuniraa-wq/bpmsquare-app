import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { PricingConfigError } from "@/lib/pricing/server";
import { priceDocumentLine } from "@/lib/pricing/quoteLine";
import { PricingError, DslError } from "@/lib/pricing-core";
import type { PricingConfig } from "@/lib/constants";

// Sales Engine, Piece A -- "Price all lines" (docs/sales-engine-architecture.md
// §3.2). Prices every product line of a document in one call instead of one
// click per line: the same priceDocumentLine() the single-line route uses,
// run in parallel and never allowed to fail the whole request -- one line's
// error (NEEDS_RFQ, a config problem, a thrown error) is reported next to
// its line_key while every other line still returns its price.
//
// document_id, when given, is a foreign id from the request body: verified
// tenant-scoped before use, exactly like /api/quotes/price-line.

const MAX_CONCURRENT = 20;

type LineInput = { line_key: string; product_id: string; quantity: number };

type LineResult =
  | { line_key: string; ok: true; unit_rate: number; net: number; gross: number; tax_amount: number; tax_pct: number; currency: string | null; document_id: string | null; area: string; flags: unknown; trace: unknown; cost_sources: unknown }
  | { line_key: string; ok: false; needs_rfq: true; area: string; cost_model: string | null; missing: unknown; product: unknown; message: string }
  | { line_key: string; ok: false; error: string };

async function priceOne(
  tenantId: string,
  input: LineInput,
  args: { accountId: string | null; documentType: "quote" | "standard_quote"; sourceId: string | null; actorId: string; pricingConfig: PricingConfig | null }
): Promise<LineResult> {
  if (!input.line_key || !input.product_id || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { line_key: input.line_key ?? "?", ok: false, error: "product_id and a positive quantity are required" };
  }
  try {
    const outcome = await priceDocumentLine(tenantId, {
      productId: input.product_id,
      accountId: args.accountId,
      quantity: input.quantity,
      documentType: args.documentType,
      sourceId: args.sourceId,
      actorId: args.actorId,
      pricingConfig: args.pricingConfig,
    });
    if (!outcome.ok) {
      return { line_key: input.line_key, ok: false, needs_rfq: true, area: outcome.area, cost_model: outcome.cost_model, missing: outcome.missing, product: outcome.product, message: outcome.message };
    }
    return {
      line_key: input.line_key, ok: true,
      unit_rate: outcome.unit_rate, net: outcome.net, gross: outcome.gross, tax_amount: outcome.tax_amount, tax_pct: outcome.tax_pct,
      currency: outcome.currency, document_id: outcome.document_id, area: outcome.area,
      flags: outcome.flags, trace: outcome.trace, cost_sources: outcome.cost_sources,
    };
  } catch (e) {
    if (e instanceof PricingConfigError) return { line_key: input.line_key, ok: false, error: e.message };
    if (e instanceof PricingError) return { line_key: input.line_key, ok: false, error: `${e.code}: ${e.message}` };
    if (e instanceof DslError) return { line_key: input.line_key, ok: false, error: `FORMULA_ERROR: ${e.message}` };
    console.error("price-lines: one line failed:", e);
    return { line_key: input.line_key, ok: false, error: "Pricing failed — try again, or enter the rate manually." };
  }
}

/** Runs `items` through `worker` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await worker(items[i]);
    return runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
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

  const body = await request.json().catch(() => null) as {
    document_type?: "quote" | "standard_quote" | "opportunity";
    document_id?: string;
    account_id?: string;
    lines?: LineInput[];
  } | null;

  const documentType = body?.document_type;
  // "opportunity" is reserved for piece B: until the Opportunity object
  // exists it is refused rather than silently priced as a quote, so a
  // caller can't mistake the fallback for the real thing.
  if (documentType === "opportunity") {
    return NextResponse.json({ error: "document_type opportunity is not available yet" }, { status: 422 });
  }
  if (documentType !== "quote" && documentType !== "standard_quote") {
    return NextResponse.json({ error: "document_type must be quote or standard_quote" }, { status: 422 });
  }
  const lines = Array.isArray(body?.lines) ? body!.lines!.filter((l) => l && typeof l === "object") : [];
  if (lines.length === 0) return NextResponse.json({ error: "No lines to price" }, { status: 422 });

  // The document id is a foreign id from the request body -- verify it
  // belongs to this tenant before using it as provenance, same guard as
  // the single-line route (MULTI_TENANT_GUARDRAILS.md).
  let sourceId: string | null = null;
  if (typeof body?.document_id === "string" && body.document_id) {
    const table = documentType === "quote" ? "quotes" : documentType === "standard_quote" ? "standard_quotes" : null;
    if (table) {
      const { data: q } = await supabase.from(table).select("id").eq("id", body.document_id).eq("tenant_id", tenantId).maybeSingle();
      sourceId = q?.id ? (q.id as string) : null;
    }
  }

  const tenant = await getTenant();
  const results = await mapWithConcurrency(lines, MAX_CONCURRENT, (line) =>
    priceOne(tenantId, line, {
      accountId: body?.account_id ?? null,
      documentType,
      sourceId,
      actorId: userId,
      pricingConfig: (tenant?.config?.pricing as PricingConfig | undefined) ?? null,
    })
  );

  return NextResponse.json({ results });
}
