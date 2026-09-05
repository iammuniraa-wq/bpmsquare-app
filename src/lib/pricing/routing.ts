// Price Book routing (spec §17 batch 2, cost-based step 2): which book a
// line goes to. The engine never guesses a type -- the tenant's ordered
// rules decide, first match wins, default book last. Pure.

import type { AttrValue } from "@/lib/pricing-core";

export type RoutingRule = {
  /** A flattened context attribute: "product.category", "product.sub_category",
   *  "document_type", "customer.tier", "region"... */
  attribute: string;
  value: string;
  area: string;
};

export type PricingRouting = {
  rules?: RoutingRule[];
  default_area?: string;
};

export const DEFAULT_AREA = "default";

export function routeToArea(routing: PricingRouting | null | undefined, flatCtx: Record<string, AttrValue | undefined>): { area: string; matched: RoutingRule | null } {
  for (const r of routing?.rules ?? []) {
    if (!r.attribute || !r.area) continue;
    const v = flatCtx[r.attribute];
    if (v !== undefined && v !== null && String(v).toLowerCase() === String(r.value).toLowerCase()) {
      return { area: r.area, matched: r };
    }
  }
  return { area: routing?.default_area?.trim() || DEFAULT_AREA, matched: null };
}

/** The attributes a quote line hands the engine, from the records around it.
 *  Kept in one place so the router, the trace and the tenant's own
 *  understanding of "where does the engine read from" agree. The tenant-
 *  configurable mapping (context_map) is batch 2's remaining piece; until
 *  then these are the conventions. */
export function quoteLineContext(args: {
  documentType: "quote" | "standard_quote" | "work_order";
  account?: { type?: string | null; state?: string | null; industry?: string | null; id?: string | null } | null;
  product: { id: string; name: string; category?: string | null; sub_category?: string | null; list_price?: number | null; uom?: string | null; tax_percent?: number | null };
}): { header: Record<string, unknown>; line: Record<string, unknown> } {
  const header: Record<string, unknown> = { document_type: args.documentType };
  if (args.account?.id) header["customer.id"] = args.account.id;
  if (args.account?.type) header["customer.tier"] = args.account.type;
  if (args.account?.state) header.region = args.account.state;
  if (args.account?.industry) header.industry = args.account.industry;

  const line: Record<string, unknown> = {
    "product.id": args.product.id,
    "product.base_model": args.product.name,
    product: {
      id: args.product.id,
      list_price: args.product.list_price ?? null,
      uom: args.product.uom ?? null,
      tax_percent: args.product.tax_percent ?? null,
    },
  };
  if (args.product.category) line["product.category"] = args.product.category;
  if (args.product.sub_category) line["product.sub_category"] = args.product.sub_category;
  return { header, line };
}
