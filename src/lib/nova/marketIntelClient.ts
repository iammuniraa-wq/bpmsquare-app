"use client";

import type { MarketIntelResult } from "@/lib/nova/marketIntel";

/**
 * Per-tab, per-origin (= per-tenant, since tenant identity is the hostname)
 * cache for account market signals -- same sessionStorage pattern as
 * lib/nova/navClient.ts. Each fetch is a real, billed multi-search Claude
 * call, so this exists specifically to stop a rep re-triggering one just by
 * reopening the same account page; a manual "Refresh" always bypasses it.
 *
 * Longer TTL than the nav cache (news doesn't change minute to minute) --
 * 6 hours, not 5 minutes.
 */

const KEY_PREFIX = "nova_market_intel_v1:";
const TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { at: number; accountName: string; data: MarketIntelResult };

export function readMarketIntelCache(accountId: string): MarketIntelResult | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + accountId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.data || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchMarketIntel(accountId: string, accountName: string): Promise<MarketIntelResult> {
  const res = await fetch(`/api/nova/market-intel?account_id=${encodeURIComponent(accountId)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Market signals failed to load.");
  const data = json as MarketIntelResult;
  try { sessionStorage.setItem(KEY_PREFIX + accountId, JSON.stringify({ at: Date.now(), accountName, data })); } catch { /* quota/private mode -- cache is optional */ }
  return data;
}

/**
 * Every account this tab has already fetched signals for, newest first --
 * powers the home Stream's rollup block (accounts the rep has actually
 * looked at recently), without ever auto-triggering a fresh paid call for
 * an arbitrary account list on every dashboard load.
 */
export function listCachedMarketIntel(): { accountId: string; accountName: string; data: MarketIntelResult }[] {
  const out: { accountId: string; accountName: string; data: MarketIntelResult }[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as CacheEntry;
      if (!parsed?.data || typeof parsed.at !== "number" || Date.now() - parsed.at > TTL_MS) continue;
      out.push({ accountId: key.slice(KEY_PREFIX.length), accountName: parsed.accountName ?? "Account", data: parsed.data });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.data.fetchedAt.localeCompare(a.data.fetchedAt));
}
