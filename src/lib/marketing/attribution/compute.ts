import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { ASSET_TYPES, MODELS, MODES, WINDOW_DAYS, attribute, type AssetType, type Deal, type Touch } from "./models";

// Recomputing the results. READ-ONLY on every table it reads (opportunities, quotes, invoices, touches): it never
// changes a deal. It writes only attribution_results, replacing a row in place, then deleting the rows an earlier
// run wrote that no longer apply, so running it twice leaves the same rows. Every query names the tenant.

const PAGE = 1000;
const MAX_TOUCHES = 60_000;
const MAX_DEALS = 5_000;
const CHUNK = 200;

export type RecomputeResult = { deals: number; touches: number; rows: number; truncated: boolean; missing: boolean };

type OppRow = { id: string; account_id: string; outcome: string; amount: number | null; created_at: string; closed_at: string | null };

export async function loadDeals(admin: SupabaseClient, tenantId: string): Promise<{ deals: Deal[]; missing: boolean }> {
  const { data, error } = await admin.from("opportunities")
    .select("id, account_id, outcome, amount, created_at, closed_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(MAX_DEALS);
  if (error) return { deals: [], missing: isSchemaPending(error) };
  const opps = (data ?? []) as OppRow[];

  // Paid money: invoices raised on the quotes of a WON deal. Standard quotes are not invoiced in the product, so they add nothing here.
  const won = opps.filter((o) => o.outcome === "won").map((o) => o.id);
  const invoicedBy = new Map<string, { invoiced: number; paid: number }>();
  for (let i = 0; i < won.length; i += CHUNK) {
    const { data: qs, error: qErr } = await admin.from("quotes").select("id, opportunity_id").eq("tenant_id", tenantId).in("opportunity_id", won.slice(i, i + CHUNK));
    if (qErr) break;
    const quotes = (qs ?? []) as { id: string; opportunity_id: string }[];
    if (quotes.length === 0) continue;
    const { data: inv, error: iErr } = await admin.from("invoices").select("quote_id, total, paid_amount").eq("tenant_id", tenantId).in("quote_id", quotes.map((q) => q.id));
    if (iErr) break;
    const oppOf = new Map(quotes.map((q) => [q.id, q.opportunity_id]));
    for (const r of (inv ?? []) as { quote_id: string; total: number | null; paid_amount: number | null }[]) {
      const opp = oppOf.get(r.quote_id);
      if (!opp) continue;
      const cur = invoicedBy.get(opp) ?? { invoiced: 0, paid: 0 };
      cur.invoiced += Number(r.total ?? 0);
      cur.paid += Number(r.paid_amount ?? 0);
      invoicedBy.set(opp, cur);
    }
  }
  const outcome = (o: string): Deal["outcome"] => (o === "won" || o === "lost" || o === "dropped" ? o : "open");
  return {
    missing: false,
    deals: opps.map((o) => ({
      id: o.id, accountId: o.account_id, createdAt: new Date(o.created_at), closedAt: o.closed_at ? new Date(o.closed_at) : null,
      outcome: outcome(o.outcome), amount: Number(o.amount ?? 0), invoiced: invoicedBy.get(o.id)?.invoiced ?? 0, paid: invoicedBy.get(o.id)?.paid ?? 0,
    })),
  };
}

export async function loadTouches(admin: SupabaseClient, tenantId: string): Promise<{ touches: Touch[]; truncated: boolean; missing: boolean }> {
  const out: Touch[] = [];
  for (let from = 0; from < MAX_TOUCHES; from += PAGE) {
    const { data, error } = await admin.from("marketing_touches")
      .select("asset_type, asset_id, account_id, occurred_at, strength").eq("tenant_id", tenantId).order("occurred_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { touches: [], truncated: false, missing: isSchemaPending(error) };
    const rows = (data ?? []) as { asset_type: AssetType; asset_id: string; account_id: string | null; occurred_at: string; strength: "engaged" | "reached" }[];
    for (const r of rows) if (r.account_id) out.push({ assetType: r.asset_type, assetId: r.asset_id, accountId: r.account_id, at: new Date(r.occurred_at), strength: r.strength });
    if (rows.length < PAGE) return { touches: out, truncated: false, missing: false };
  }
  return { touches: out, truncated: true, missing: false };
}

export async function recompute(admin: SupabaseClient, tenantId: string, now: Date = new Date()): Promise<RecomputeResult> {
  const d = await loadDeals(admin, tenantId);
  if (d.missing) return { deals: 0, touches: 0, rows: 0, truncated: false, missing: true };
  const t = await loadTouches(admin, tenantId);
  if (t.missing) return { deals: d.deals.length, touches: 0, rows: 0, truncated: false, missing: true };

  const stamp = now.toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const mode of MODES) for (const model of MODELS) for (const assetType of ASSET_TYPES) {
    for (const [assetId, m] of attribute(d.deals, t.touches, { model, mode, assetType, now })) {
      rows.push({
        tenant_id: tenantId, model, mode, asset_type: assetType, asset_id: assetId, window_days: WINDOW_DAYS,
        touches: m.touches, people: m.people, sourced_deals: m.sourcedDeals, sourced_open_value: m.sourcedOpenValue,
        sourced_won_deals: m.sourcedWonDeals, sourced_won_value: m.sourcedWonValue, sourced_paid_value: m.sourcedPaidValue,
        influenced_deals: m.influencedDeals, influenced_won_deals: m.influencedWonDeals, influenced_won_value: m.influencedWonValue,
        computed_at: stamp,
      });
    }
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from("attribution_results").upsert(rows.slice(i, i + CHUNK), { onConflict: "tenant_id,model,mode,asset_type,asset_id" });
    if (error) return { deals: d.deals.length, touches: t.touches.length, rows: 0, truncated: t.truncated, missing: isSchemaPending(error) };
  }
  // Rows from an earlier run for assets that no longer have anything to show.
  await admin.from("attribution_results").delete().eq("tenant_id", tenantId).lt("computed_at", stamp);
  return { deals: d.deals.length, touches: t.touches.length, rows: rows.length, truncated: t.truncated, missing: false };
}
