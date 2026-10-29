import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import {
  deriveAccountSignals, purchasedQuoteAccounts,
  type AccountSignals, type SignalContract, type SignalInvoice, type SignalProduct, type SignalQuote, type SignalQuoteLine,
} from "@/lib/accountSignals";

/**
 * The one place the Coverage-driven segment fields are computed from the
 * database. Marketing recipient resolution (preview count and send) and
 * Coverage's own segment matching both call this, so a "Has active AMC" /
 * "Has bought product" filter means the same thing everywhere.
 *
 * Every query is on the admin client with an explicit tenant_id filter
 * (MULTI_TENANT_GUARDRAILS.md -- RLS is not a backstop here). A missing
 * table/column (migration pending) reads as no rows, so the signals simply
 * come back empty rather than throwing.
 */

const PAGE = 1000;
const IN_CHUNK = 200;

type Admin = ReturnType<typeof createAdminSupabase>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

async function pageAll<T>(build: () => Query): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // A stable order: without one, PostgREST may return rows in a different order per page and skip or repeat some.
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

export async function loadAccountSignals(
  tenantId: string,
  opts: { accountId?: string } = {}
): Promise<Map<string, AccountSignals>> {
  const admin: Admin = createAdminSupabase();
  const scoped = (table: string, cols: string): Query => {
    let q = admin.from(table).select(cols).eq("tenant_id", tenantId);
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    return q;
  };

  const [contracts, quotes, invoices] = await Promise.all([
    pageAll<SignalContract>(() => scoped("contracts", "account_id, status, start_date, end_date")),
    pageAll<SignalQuote>(() => scoped("quotes", "id, account_id, outcome")),
    pageAll<SignalInvoice>(() => scoped("invoices", "account_id, quote_id, status")),
  ]);

  const purchases = purchasedQuoteAccounts(quotes, invoices);
  const quoteIds = [...purchases.keys()];

  const lines: SignalQuoteLine[] = [];
  for (let i = 0; i < quoteIds.length; i += IN_CHUNK) {
    const chunk = quoteIds.slice(i, i + IN_CHUNK);
    lines.push(...await pageAll<SignalQuoteLine>(() =>
      admin.from("quote_lines").select("quote_id, product_id")
        .eq("tenant_id", tenantId).in("quote_id", chunk).not("product_id", "is", null)
    ));
  }

  const productIds = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))];
  const products: SignalProduct[] = [];
  for (let i = 0; i < productIds.length; i += IN_CHUNK) {
    const chunk = productIds.slice(i, i + IN_CHUNK);
    products.push(...await pageAll<SignalProduct>(() =>
      admin.from("products").select("id, sku, name").eq("tenant_id", tenantId).in("id", chunk)
    ));
  }

  return deriveAccountSignals({
    today: new Date().toISOString().slice(0, 10),
    contracts, purchases, lines, products,
  });
}
