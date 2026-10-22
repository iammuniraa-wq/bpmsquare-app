import "server-only";
import { assertSafeHttpsUrl, fetchPublic } from "@/lib/net/safeHost";
import { cleanText, looksLikeInstruction, type Citation } from "./validate";

// One fixed fetch of the company's own home page (docs/design/account-analysis.md 5.1): it confirms the domain answers and
// gives the page a title we can cite. The address is tenant-typed (an account's website), so it goes through
// assertSafeHttpsUrl and fetchPublic only. At most 1 MB is read, in 6 seconds, redirects checked hop by hop. Nothing from
// the page is stored or sent to a model; only its title and address.

export const MAX_BYTES = 1_000_000;
export const TIMEOUT_MS = 6000;

export type SiteCheck = { ok: true; citation: Citation } | { ok: false };

export async function checkWebsite(domain: string | null, fetcher: typeof fetchPublic = fetchPublic): Promise<SiteCheck> {
  if (!domain) return { ok: false };
  try {
    const url = await assertSafeHttpsUrl(`https://${domain}/`);
    const res = await fetcher(url.toString(), { headers: { "user-agent": "BPMSquareBot/1.0 (company analysis)", accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT_MS) }, { maxRedirects: 3 });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return { ok: false };
    const reader = res.body?.getReader();
    let html = "";
    let read = 0;
    const dec = new TextDecoder();
    while (reader && read < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      html += dec.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    try { await reader?.cancel(); } catch { /* the body is already closed */ }
    const title = cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 120);
    // A title that tries to instruct is not worth citing; the address alone still confirms the domain.
    return { ok: true, citation: { url: res.url && res.url.startsWith("https://") ? res.url : url.toString(), title: title && !looksLikeInstruction(title) ? title : domain } };
  } catch {
    return { ok: false };
  }
}
