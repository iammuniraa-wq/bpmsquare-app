import "server-only";
import { unstable_cache } from "next/cache";
import { DEFAULT_NEWS_TOPICS } from "@/lib/constants";

export { DEFAULT_NEWS_TOPICS };

export type AccountNewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  accountName: string;
};

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Google News RSS is unauthenticated and free, but unofficial -- no uptime or
// rate-limit guarantees. Failures degrade to an empty result per account
// rather than surfacing an error on the dashboard.
async function fetchOneAccountNews(accountName: string): Promise<AccountNewsItem[]> {
  return fetchFeed(`"${accountName}"`, accountName, 2);
}

/** The shared reader. accountName doubles as the item's LABEL -- an account's
 * name when the query is an account, the topic when it's a business feed. */
async function fetchFeed(query: string, label: string, limit: number): Promise<AccountNewsItem[]> {
  const accountName = label;
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: AccountNewsItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) && items.length < limit) {
      const block = m[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const pubDate = extractTag(block, "pubDate");
      const source = extractTag(block, "source");
      if (!title || !link) continue;
      items.push({
        title: decodeEntities(title),
        url: link,
        source: decodeEntities(source) || "Google News",
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        accountName,
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function _getAccountNewsImpl(tenantId: string, accountNames: string[]): Promise<AccountNewsItem[]> {
  const results = await Promise.allSettled(accountNames.map((name) => fetchOneAccountNews(name)));
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return items
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8);
}

// tenantId is part of the cache key (via unstable_cache argument serialization)
// so two tenants' account lists never share a cached news result.
const _getAccountNewsCached = unstable_cache(
  _getAccountNewsImpl,
  ["account-news"],
  { revalidate: 1800 }
);

export async function getAccountNews(tenantId: string, accountNames: string[]): Promise<AccountNewsItem[]> {
  if (!tenantId || accountNames.length === 0) return [];
  return _getAccountNewsCached(tenantId, accountNames);
}

// ---------------------------------------------------------------------------
// Business / industry news (owner request 2026-09-20)
//
// The account feed above needs ACCOUNTS to search on, so a workspace that has
// just been provisioned gets an empty card -- which is the specific complaint:
// "if the client is not using the system then there is no data to represent".
// This feed is keyed on topics rather than on the tenant's own records, so it
// has real content on day one and keeps having it.
//
// Not a fallback that swaps itself in when accounts are missing: that would
// make one card mean two different things depending on data the reader can't
// see. It's its own block, which an admin turns on (see TenantConfig
// dashboard_extras), and it can sit alongside the account feed quite happily.



async function _getBusinessNewsImpl(tenantId: string, topics: string[]): Promise<AccountNewsItem[]> {
  const results = await Promise.allSettled(topics.map((t) => fetchFeed(t, t, 4)));
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8);
}

// Same caching shape as the account feed: tenantId is serialised into the key,
// so two tenants on different topics never share a result. 30 minutes -- this
// is ambient context, not something anyone refreshes for.
const _getBusinessNewsCached = unstable_cache(
  _getBusinessNewsImpl,
  ["business-news"],
  { revalidate: 1800 }
);

export async function getBusinessNews(tenantId: string, topics: string[]): Promise<AccountNewsItem[]> {
  const list = topics.filter((t) => t.trim().length > 0).slice(0, 4);
  if (!tenantId || list.length === 0) return [];
  return _getBusinessNewsCached(tenantId, list);
}
