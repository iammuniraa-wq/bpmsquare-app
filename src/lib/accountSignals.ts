// Pure derivation of the Coverage-driven segment fields ("Has active AMC",
// "Has bought product"). They aren't account columns, so every caller that
// evaluates segment filters against an account has to merge these signals
// into the record first. The DB read lives in lib/coverage/signals.ts; this
// file stays dependency-free so the rules are unit-testable on their own.

export type AccountSignals = {
  has_active_amc: boolean;
  /** Comma-joined "sku name" pairs, matched via the "contains" operator --
   * a plain string field, not a real column, so it reuses matchesAllFilters
   * unchanged rather than needing a new operator/type. */
  owned_product_skus: string;
};

export const EMPTY_ACCOUNT_SIGNALS: AccountSignals = { has_active_amc: false, owned_product_skus: "" };

export const SIGNAL_FIELD_KEYS: readonly string[] = ["has_active_amc", "owned_product_skus"];

export function filtersNeedSignals(filters: { field: string }[]): boolean {
  return filters.some((f) => SIGNAL_FIELD_KEYS.includes(f.field));
}

/** Invoice statuses that mean the sale actually happened -- a draft hasn't
 * been issued and a cancelled one was reversed. */
export const BILLED_INVOICE_STATUSES: readonly string[] = ["sent", "partial", "paid", "overdue"];

export type SignalContract = { account_id: string; status: string; start_date: string | null; end_date: string | null };
export type SignalQuote = { id: string; account_id: string; outcome: string };
export type SignalInvoice = { account_id: string; quote_id: string | null; status: string };
export type SignalQuoteLine = { quote_id: string; product_id: string | null };
export type SignalProduct = { id: string; sku: string | null; name: string };

/** An AMC counts as active only when it is flagged active AND today falls
 * inside its (optional) start/end dates -- a stale "active" row whose end
 * date has passed no longer covers anything. Dates are ISO yyyy-mm-dd, so
 * string comparison is date comparison. */
export function isAmcActiveOn(c: Pick<SignalContract, "status" | "start_date" | "end_date">, today: string): boolean {
  if (c.status !== "active") return false;
  if (c.start_date && c.start_date.slice(0, 10) > today) return false;
  if (c.end_date && c.end_date.slice(0, 10) < today) return false;
  return true;
}

/** Quotes that count as a purchase: won quotes, plus any quote an issued
 * invoice was raised against. Returns quote id -> accounts that bought
 * through it (an invoice's own account wins over the quote's, since that
 * is who was billed). */
export function purchasedQuoteAccounts(quotes: SignalQuote[], invoices: SignalInvoice[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (quoteId: string, accountId: string) => {
    const set = out.get(quoteId) ?? new Set<string>();
    set.add(accountId);
    out.set(quoteId, set);
  };
  for (const q of quotes) if (q.outcome === "won") add(q.id, q.account_id);
  for (const i of invoices) if (i.quote_id && BILLED_INVOICE_STATUSES.includes(i.status)) add(i.quote_id, i.account_id);
  return out;
}

export function deriveAccountSignals(input: {
  today: string;
  contracts: SignalContract[];
  purchases: Map<string, Set<string>>;
  lines: SignalQuoteLine[];
  products: SignalProduct[];
}): Map<string, AccountSignals> {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const productsByAccount = new Map<string, Set<string>>();
  for (const line of input.lines) {
    if (!line.product_id || !productById.has(line.product_id)) continue;
    for (const accountId of input.purchases.get(line.quote_id) ?? []) {
      const set = productsByAccount.get(accountId) ?? new Set<string>();
      set.add(line.product_id);
      productsByAccount.set(accountId, set);
    }
  }

  const out = new Map<string, AccountSignals>();
  const slot = (accountId: string): AccountSignals => {
    let s = out.get(accountId);
    if (!s) { s = { ...EMPTY_ACCOUNT_SIGNALS }; out.set(accountId, s); }
    return s;
  };
  for (const c of input.contracts) if (isAmcActiveOn(c, input.today)) slot(c.account_id).has_active_amc = true;
  for (const [accountId, productIds] of productsByAccount) {
    slot(accountId).owned_product_skus = [...productIds]
      .map((id) => productById.get(id)!)
      .map((p) => `${p.sku ?? ""} ${p.name}`.trim())
      .join(", ");
  }
  return out;
}
