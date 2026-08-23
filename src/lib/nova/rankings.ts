import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";

/**
 * Nova Stream's "Rankings" -- replaces the predictive action stream (now
 * covered by NovaSidebar's always-on "Needs You Now"), so this shows a
 * genuinely different story instead of repeating it: who's actually
 * driving the business, real leaderboards not urgency signals.
 */

export type NovaRankingRow = { id: string; label: string; detail: string; href: string };
export type NovaRankings = {
  topCustomers: NovaRankingRow[];
  topProducts: NovaRankingRow[];
  mostRepaired: NovaRankingRow[];
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const TOP_N = 5;
const ASSET_KIND_LABEL: Record<string, string> = {
  motor: "Motors", transformer: "Transformers", pump: "Pumps", generator: "Generators", panel: "Panels",
};

// Revenue basis prefers billed invoices (real, collected-or-collectible
// money); a tenant without the invoices module falls back to won-quote
// value (the next-most-real signal of who the business actually serves).
async function topCustomersByInvoices(tenantId: string): Promise<NovaRankingRow[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("invoices")
    .select("account_id, total, accounts(name)")
    .eq("tenant_id", tenantId)
    .not("status", "in", '("cancelled","draft")');
  const byAccount = new Map<string, { name: string; value: number }>();
  for (const inv of data ?? []) {
    const name = (Array.isArray(inv.accounts) ? inv.accounts[0]?.name : (inv.accounts as { name?: string } | null)?.name) ?? "—";
    const cur = byAccount.get(inv.account_id as string) ?? { name, value: 0 };
    cur.value += (inv.total as number) ?? 0;
    byAccount.set(inv.account_id as string, cur);
  }
  return [...byAccount.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, TOP_N)
    .map(([id, v]) => ({ id, label: v.name, detail: money(v.value), href: ROUTES.account(id) }));
}

async function topCustomersByWonQuotes(tenantId: string): Promise<NovaRankingRow[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("quotes")
    .select("account_id, total, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("outcome", "won");
  const byAccount = new Map<string, { name: string; value: number }>();
  for (const q of data ?? []) {
    const name = (Array.isArray(q.accounts) ? q.accounts[0]?.name : (q.accounts as { name?: string } | null)?.name) ?? "—";
    const cur = byAccount.get(q.account_id as string) ?? { name, value: 0 };
    cur.value += (q.total as number) ?? 0;
    byAccount.set(q.account_id as string, cur);
  }
  return [...byAccount.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, TOP_N)
    .map(([id, v]) => ({ id, label: v.name, detail: money(v.value), href: ROUTES.account(id) }));
}

async function topProducts(tenantId: string): Promise<NovaRankingRow[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("quote_lines")
    .select("product_id, amount, products(name)")
    .eq("tenant_id", tenantId)
    .not("product_id", "is", null);
  const byProduct = new Map<string, { name: string; value: number; count: number }>();
  for (const l of data ?? []) {
    const name = (Array.isArray(l.products) ? l.products[0]?.name : (l.products as { name?: string } | null)?.name) ?? "—";
    const cur = byProduct.get(l.product_id as string) ?? { name, value: 0, count: 0 };
    cur.value += (l.amount as number) ?? 0;
    cur.count += 1;
    byProduct.set(l.product_id as string, cur);
  }
  return [...byProduct.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, TOP_N)
    .map(([id, v]) => ({ id, label: v.name, detail: `${money(v.value)} · ${v.count} line${v.count === 1 ? "" : "s"}`, href: ROUTES.product(id) }));
}

async function mostRepaired(tenantId: string): Promise<NovaRankingRow[]> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("service_cases")
    .select("asset_id, assets(kind)")
    .eq("tenant_id", tenantId)
    .not("asset_id", "is", null);
  const byKind = new Map<string, number>();
  for (const c of data ?? []) {
    const kind = (Array.isArray(c.assets) ? c.assets[0]?.kind : (c.assets as { kind?: string } | null)?.kind) ?? null;
    if (!kind) continue;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  return [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([kind, count]) => ({ id: kind, label: ASSET_KIND_LABEL[kind] ?? kind, detail: `${count} case${count === 1 ? "" : "s"}`, href: ROUTES.cases }));
}

/**
 * Tenant-scoped (every admin-client query carries its own tenant_id
 * filter), gated on the module each ranking depends on, one failing
 * source dropped rather than fatal to the rest -- same discipline as
 * getNovaStreamItems()/getNovaFlows().
 */
export async function getNovaRankings(tenantId: string, features: TenantFeatures): Promise<NovaRankings> {
  const jobs: [keyof NovaRankings, Promise<NovaRankingRow[]>][] = [];
  if (features.invoices) jobs.push(["topCustomers", topCustomersByInvoices(tenantId)]);
  else if (features.quotations) jobs.push(["topCustomers", topCustomersByWonQuotes(tenantId)]);
  if (features.products && features.quotations) jobs.push(["topProducts", topProducts(tenantId)]);
  if (features.cases && features.assets) jobs.push(["mostRepaired", mostRepaired(tenantId)]);

  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  const out: NovaRankings = { topCustomers: [], topProducts: [], mostRepaired: [] };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[jobs[i][0]] = r.value;
  });
  return out;
}
