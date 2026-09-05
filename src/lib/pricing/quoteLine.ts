import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { flattenContext, type LineFlag, type TraceStep, type CostConsidered } from "@/lib/pricing-core";
import type { PricingConfig } from "@/lib/constants";
import { runPrice, productCostCandidates, isNeedsCost, PricingConfigError } from "./server";
import { costItemsForProduct } from "./costSheet";
import { routeToArea, quoteLineContext } from "./routing";

// Pricing one document line in-app (spec §11.2 client #3; cost-based step
// 2). One function for the quote form, the standard-quote form and the
// work-order invoice, so they never drift: route the line to a Price Book,
// build the context from the records around it, hand the engine the
// product's cost quantities and its own cost figures, and either return a
// suggested rate with its trace -- or the NEEDS_RFQ outcome with what was
// tried. Every read is tenant-scoped.

export type PricedLineOutcome =
  | {
      ok: true;
      unit_rate: number;
      net: number;
      currency: string | null;
      document_id: string | null;
      area: string;
      config_version: number;
      flags: LineFlag[];
      trace: TraceStep[];
      cost_sources: { path: string; source?: string; quality?: string; as_of?: string | null; rate: number; qty: number }[];
    }
  | {
      ok: false;
      needs_rfq: true;
      area: string;
      cost_model: string | null;
      missing: { path: string; considered: CostConsidered[] }[];
      product: { id: string; name: string };
      message: string;
    };

export async function priceDocumentLine(
  tenantId: string,
  args: {
    productId: string;
    accountId?: string | null;
    quantity: number;
    documentType: "quote" | "standard_quote" | "work_order";
    sourceId?: string | null;
    actorId?: string | null;
    pricingConfig?: PricingConfig | null;
  }
): Promise<PricedLineOutcome> {
  const admin = createAdminSupabase();
  const [{ product, candidates }, { data: productRow }, { data: account }] = await Promise.all([
    productCostCandidates(tenantId, args.productId),
    admin.from("products").select("id, name, category, sub_category, list_price, uom, tax_percent")
      .eq("id", args.productId).eq("tenant_id", tenantId).maybeSingle(),
    args.accountId
      ? admin.from("accounts").select("id, type, state, industry").eq("id", args.accountId).eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!product || !productRow) throw new PricingConfigError(404, "Product not found");

  const ctx = quoteLineContext({
    documentType: args.documentType,
    account: account as { id: string; type?: string | null; state?: string | null; industry?: string | null } | null,
    product: productRow as { id: string; name: string; category?: string | null; sub_category?: string | null; list_price?: number | null; uom?: string | null; tax_percent?: number | null },
  });
  const flat = { ...flattenContext(ctx.header), ...flattenContext(ctx.line) };
  const { area } = routeToArea(args.pricingConfig?.routing, flat);

  const costItems = costItemsForProduct(product, args.quantity, candidates);

  try {
    const { result, config_version, document_id } = await runPrice(
      tenantId,
      { attributes: ctx.header, lines: [{ line_no: 1, quantity: args.quantity, attributes: ctx.line, cost_items: costItems }] },
      { pricingArea: area, meta: { source: args.documentType, sourceId: args.sourceId ?? null, actorId: args.actorId ?? null } }
    );
    const line = result.lines[0];
    return {
      ok: true,
      unit_rate: args.quantity > 0 ? line.net / args.quantity : line.net,
      net: line.net,
      currency: result.currency,
      document_id,
      area,
      config_version,
      flags: line.flags ?? [],
      trace: line.trace,
      cost_sources: line.trace.flatMap((t) => (t.inputs ?? []).map((i) => ({ path: i.path, source: i.source, quality: i.quality, as_of: i.as_of, rate: i.rate, qty: i.qty }))),
    };
  } catch (e) {
    if (isNeedsCost(e)) {
      const d = (e.details ?? {}) as { paths?: string[]; cost_model?: string; missing?: { path: string; considered: CostConsidered[] }[] };
      const missing = d.missing ?? (d.paths ?? []).map((path) => ({ path, considered: [] }));
      return {
        ok: false, needs_rfq: true, area,
        cost_model: d.cost_model ?? null,
        missing,
        product: { id: product.id, name: product.name },
        message: `No cost on file for ${product.name}${missing.length ? ` (${missing.map((m) => m.path).join(", ")})` : ""} — ask the supplier.`,
      };
    }
    throw e;
  }
}
