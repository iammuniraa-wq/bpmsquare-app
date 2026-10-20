import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadVersion } from "./server";

// The sent campaign's page: how many people got which language, and how often each link was
// clicked. Counted from the rows the send and the click route wrote; nothing is kept twice.

export type CampaignEngagement = {
  languages: { lang: string; sent: number; failed: number; skipped: number }[];
  links: { index: number; label: string; clicks: number }[];
};

const PAGE = 1000;

async function all<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) return out; // a table or column that is not there yet reads as "nothing recorded"
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadCampaignEngagement(tenantId: string, campaignId: string, versionId: string): Promise<CampaignEngagement> {
  const admin = createAdminSupabase();
  const [recipients, clicks, version] = await Promise.all([
    all<{ status: string; lang: string | null }>((a, b) => admin.from("marketing_campaign_recipients").select("status, lang").eq("tenant_id", tenantId).eq("campaign_id", campaignId).range(a, b)),
    all<{ link_index: number }>((a, b) => admin.from("marketing_link_clicks").select("link_index").eq("tenant_id", tenantId).eq("campaign_id", campaignId).range(a, b)),
    loadVersion(admin, tenantId, versionId),
  ]);

  const byLang = new Map<string, { sent: number; failed: number; skipped: number }>();
  for (const r of recipients) {
    if (!r.lang) continue;
    const e = byLang.get(r.lang) ?? { sent: 0, failed: 0, skipped: 0 };
    if (r.status === "sent") e.sent++; else if (r.status === "failed") e.failed++; else e.skipped++;
    byLang.set(r.lang, e);
  }
  const counts = new Map<number, number>();
  for (const c of clicks) counts.set(c.link_index, (counts.get(c.link_index) ?? 0) + 1);

  return {
    languages: [...byLang.entries()].map(([lang, v]) => ({ lang, ...v })),
    links: (version?.links ?? []).map((l, index) => ({ index, label: l.label || l.url, clicks: counts.get(index) ?? 0 })),
  };
}
