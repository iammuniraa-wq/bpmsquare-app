// Who is the "current supplier" of a product? Pure ranking, no database --
// the server helper (currentSupplier.ts) gathers the candidates, this decides.
//
// Order (owner decision 2026-10-19):
//   1. the supplier set on the product itself         -> "Preferred supplier"
//   2. the supplier of the most recent AWARDED RFQ    -> "Last awarded"
//   3. the supplier on the most recent purchase order -> "Last purchase order"
//   4. none
// A supplier that is inactive, or not in the active set, is skipped at every
// step. Prices here are the tenant's own cost history: internal.

export type CurrentSource = "product" | "award" | "purchase_order";

export const CURRENT_SOURCE_LABEL: Record<CurrentSource, string> = {
  product: "Preferred supplier",
  award: "Last awarded",
  purchase_order: "Last purchase order",
};

export type Candidate = { supplier_id: string; as_of: string | null; unit_price: number | null; currency: string | null };

export type CurrentPick = {
  supplier_id: string;
  source: CurrentSource;
  /** When the award / purchase order happened (ISO); null for a bare preference. */
  as_of: string | null;
  unit_price: number | null;
  currency: string | null;
};

/** Newest first; a candidate without a date sorts after every dated one. */
export function newestFirst(a: Candidate, b: Candidate): number {
  if (a.as_of === b.as_of) return 0;
  if (!a.as_of) return 1;
  if (!b.as_of) return -1;
  return a.as_of < b.as_of ? 1 : -1;
}

export function latestOf(cands: Candidate[], active: ReadonlySet<string>): Candidate | null {
  return cands.filter((x) => active.has(x.supplier_id)).sort(newestFirst)[0] ?? null;
}

export function pickCurrentSupplier(input: {
  preferred: string | null;
  awards: Candidate[];
  purchaseOrders: Candidate[];
  active: ReadonlySet<string>;
}): CurrentPick | null {
  const { preferred, awards, purchaseOrders, active } = input;
  if (preferred && active.has(preferred)) {
    // Say when this supplier last won a price for the product, if ever.
    const last = latestOf(awards.filter((a) => a.supplier_id === preferred), active);
    return { supplier_id: preferred, source: "product", as_of: last?.as_of ?? null, unit_price: last?.unit_price ?? null, currency: last?.currency ?? null };
  }
  const award = latestOf(awards, active);
  if (award) return { supplier_id: award.supplier_id, source: "award", as_of: award.as_of, unit_price: award.unit_price, currency: award.currency };
  const po = latestOf(purchaseOrders, active);
  if (po) return { supplier_id: po.supplier_id, source: "purchase_order", as_of: po.as_of, unit_price: po.unit_price, currency: po.currency };
  return null;
}

/** The short note under the badge, e.g. "last awarded 12 Aug 2026 at 41.5 USD". */
export function currentNote(p: Pick<CurrentPick, "source" | "as_of" | "unit_price" | "currency">, fmtDate: (s: string) => string): string {
  const price = p.unit_price !== null && Number.isFinite(p.unit_price) ? ` at ${p.unit_price}${p.currency ? ` ${p.currency}` : ""}` : "";
  if (p.source === "product") return p.as_of ? `last awarded ${fmtDate(p.as_of)}${price}` : "";
  if (p.source === "award") return p.as_of ? `last awarded ${fmtDate(p.as_of)}${price}` : "last awarded";
  return p.as_of ? `last purchase order ${fmtDate(p.as_of)}${price}` : "last purchase order";
}
