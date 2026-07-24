import "server-only";
import { unstable_cache } from "next/cache";

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
  const q = encodeURIComponent(`"${accountName}"`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: AccountNewsItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) && items.length < 2) {
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
