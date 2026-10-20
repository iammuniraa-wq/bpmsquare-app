import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import { isSchemaPending } from "@/lib/marketing/pending";
import { HORIZON_DAYS } from "./rubric";
import type { RawSignal } from "./types";

// The first-party collectors: read what the product already holds for one
// tenant and turn it into RawSignal rows (docs/signals-architecture.md 3.1,
// phase 1). Nothing is fetched from outside, nothing is stored here, and no
// amount of money or contact detail leaves these functions: a headline names a
// reference, never a total or a person.
//
// Every query chains .eq("tenant_id", tenantId): this runs on the service-role
// client, where RLS is not a backstop (MULTI_TENANT_GUARDRAILS.md). A missing
// table or column (migration pending, module never used) reads as "no signals
// from that source", never as a failure.

const DAY = 86_400_000;
const PAGE = 1000;
/** A hard stop per source, so a very large tenant cannot make one run unbounded. */
const MAX_ROWS = 20_000;

type Result = { data: unknown; error: { code?: string; message?: string } | null };

async function pageAll<T>(warnings: string[], source: string, run: (from: number, to: number) => PromiseLike<Result>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) {
      if (!isSchemaPending(error)) warnings.push(`${source}: ${error.message ?? "could not be read"}`);
      return out;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export type Collected = {
  /** account id -> its signals. Only accounts with at least one signal appear. */
  byAccount: Map<string, RawSignal[]>;
  warnings: string[];
};

function push(map: Map<string, RawSignal[]>, accountId: string | null | undefined, s: RawSignal) {
  if (!accountId) return;
  const list = map.get(accountId);
  if (list) list.push(s); else map.set(accountId, [s]);
}

const iso = (d: number) => new Date(d).toISOString();

export async function collectSignals(admin: SupabaseClient, tenantId: string, now: Date): Promise<Collected> {
  const warnings: string[] = [];
  const byAccount = new Map<string, RawSignal[]>();
  const t = now.getTime();
  const since = iso(t - HORIZON_DAYS * DAY);
  const since90 = iso(t - 90 * DAY);

  const [quotes, standardQuotes, deals, cases, contracts, leads, clicks, events, topicRows, campaignRows] = await Promise.all([
    pageAll<{ id: string; ref: string | null; account_id: string; outcome: string | null; created_at: string }>(warnings, "quotes", (a, b) =>
      admin.from("quotes").select("id, ref, account_id, outcome, created_at").eq("tenant_id", tenantId).gte("created_at", since).range(a, b)),
    pageAll<{ id: string; ref: string | null; account_id: string; status: string | null; created_at: string }>(warnings, "standard_quotes", (a, b) =>
      admin.from("standard_quotes").select("id, ref, account_id, status, created_at").eq("tenant_id", tenantId).gte("created_at", since).range(a, b)),
    pageAll<{ id: string; ref: string | null; title: string | null; account_id: string; outcome: string | null; created_at: string }>(warnings, "opportunities", (a, b) =>
      admin.from("opportunities").select("id, ref, title, account_id, outcome, created_at").eq("tenant_id", tenantId).gte("created_at", since).range(a, b)),
    pageAll<{ id: string; ref: string | null; account_id: string; asset_id: string | null; intake_at: string }>(warnings, "service_cases", (a, b) =>
      admin.from("service_cases").select("id, ref, account_id, asset_id, intake_at").eq("tenant_id", tenantId).gte("intake_at", since90).range(a, b)),
    pageAll<{ id: string; ref: string | null; account_id: string; status: string; end_date: string | null }>(warnings, "contracts", (a, b) =>
      admin.from("contracts").select("id, ref, account_id, status, end_date").eq("tenant_id", tenantId).eq("status", "active").range(a, b)),
    pageAll<{ id: string; account_id: string; source_campaign_id: string | null; created_at: string }>(warnings, "leads", (a, b) =>
      admin.from("leads").select("id, account_id, source_campaign_id, created_at").eq("tenant_id", tenantId).gte("created_at", since).range(a, b)),
    pageAll<{ id: string; recipient_id: string; campaign_id: string; topic_id: string | null; clicked_at: string }>(warnings, "marketing_link_clicks", (a, b) =>
      admin.from("marketing_link_clicks").select("id, recipient_id, campaign_id, topic_id, clicked_at").eq("tenant_id", tenantId).gte("clicked_at", since).range(a, b)),
    pageAll<{ name: string; account_id: string | null; object_id: string | null; object_type: string; occurred_at: string; dedupe_key: string }>(warnings, "domain_event", (a, b) =>
      admin.from("domain_event").select("name, account_id, object_id, object_type, occurred_at, dedupe_key").eq("tenant_id", tenantId)
        .in("name", ["quote.opened", "quote.accepted", "quote.change_requested", "email.unsubscribed", "email.opened"]).gte("occurred_at", since).range(a, b)),
    pageAll<{ id: string; name: string; enabled: boolean }>(warnings, "signal_topics", (a, b) =>
      admin.from("signal_topics").select("id, name, enabled").eq("tenant_id", tenantId).range(a, b)),
    pageAll<{ id: string; name: string }>(warnings, "marketing_campaigns", (a, b) =>
      admin.from("marketing_campaigns").select("id, name").eq("tenant_id", tenantId).gte("created_at", since).range(a, b)),
  ]);

  // ── Quotes and deals: they asked us ───────────────────────────────────────
  for (const q of quotes) {
    const ref = q.ref ? ` (${q.ref})` : "";
    push(byAccount, q.account_id, { kind: "inquiry", source: "quotes", key: `quote:${q.id}`, occurredAt: q.created_at, headline: `Asked for a quote${ref}`, href: ROUTES.quotation(q.id) });
    const ageDays = (t - new Date(q.created_at).getTime()) / DAY;
    if (q.outcome === "open" && ageDays >= 3) {
      push(byAccount, q.account_id, { kind: "quote_waiting", source: "quotes", key: `quote-wait:${q.id}`, occurredAt: q.created_at, headline: `Quote${ref} open for ${Math.floor(ageDays)} days`, href: ROUTES.quotation(q.id) });
    }
  }
  for (const q of standardQuotes) {
    const ref = q.ref ? ` (${q.ref})` : "";
    push(byAccount, q.account_id, { kind: "inquiry", source: "quotes", key: `sq:${q.id}`, occurredAt: q.created_at, headline: `Asked for a quote${ref}`, href: ROUTES.standardQuote(q.id) });
    const ageDays = (t - new Date(q.created_at).getTime()) / DAY;
    if (q.status === "sent" && ageDays >= 3) {
      push(byAccount, q.account_id, { kind: "quote_waiting", source: "quotes", key: `sq-wait:${q.id}`, occurredAt: q.created_at, headline: `Quote${ref} open for ${Math.floor(ageDays)} days`, href: ROUTES.standardQuote(q.id) });
    }
  }
  for (const d of deals) {
    if (d.outcome && d.outcome !== "open") continue;
    const label = d.ref ?? d.title ?? "a deal";
    push(byAccount, d.account_id, { kind: "deal_opened", source: "deals", key: `deal:${d.id}`, occurredAt: d.created_at, headline: `A deal was opened (${label})`, href: ROUTES.pipelineDetail(d.id) });
  }

  // ── Service: three cases on one asset in 90 days ──────────────────────────
  const perAsset = new Map<string, typeof cases>();
  for (const c of cases) {
    if (!c.asset_id) continue;
    const k = `${c.account_id}:${c.asset_id}`;
    perAsset.set(k, [...(perAsset.get(k) ?? []), c]);
  }
  for (const [k, list] of perAsset) {
    if (list.length < 3) continue;
    const latest = [...list].sort((a, b) => b.intake_at.localeCompare(a.intake_at))[0];
    push(byAccount, latest.account_id, {
      kind: "service_trouble", source: "cases", key: `asset:${k}`, occurredAt: latest.intake_at,
      headline: `${list.length} service cases on the same equipment in 90 days`, href: ROUTES.case(latest.id),
    });
  }

  // ── Contracts about to end: a state, so it counts from today ─────────────
  for (const c of contracts) {
    if (!c.end_date) continue;
    const left = Math.floor((new Date(c.end_date).getTime() - t) / DAY);
    if (left < 0 || left > 60) continue;
    push(byAccount, c.account_id, {
      kind: "contract_renewal", source: "contracts", key: `contract:${c.id}`, occurredAt: now.toISOString(),
      headline: `Contract${c.ref ? ` ${c.ref}` : ""} ends in ${left} day${left === 1 ? "" : "s"}`, href: ROUTES.amc,
    });
  }

  // ── Campaigns: interest and clicks ────────────────────────────────────────
  const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
  const nameOf = (id: string | null) => (id && campaignName.get(id)) || "a campaign";
  for (const l of leads) {
    if (!l.source_campaign_id) continue;
    push(byAccount, l.account_id, { kind: "interested", source: "campaigns", key: `lead:${l.id}`, occurredAt: l.created_at, headline: `Said they are interested in "${nameOf(l.source_campaign_id)}"`, href: ROUTES.marketingCampaign(l.source_campaign_id) });
  }

  const recipientIds = [...new Set(clicks.map((c) => c.recipient_id))];
  const recipientAccount = new Map<string, string | null>();
  for (let i = 0; i < recipientIds.length; i += 200) {
    const chunk = recipientIds.slice(i, i + 200);
    const rows = await pageAll<{ id: string; account_id: string | null }>(warnings, "marketing_campaign_recipients", (a, b) =>
      admin.from("marketing_campaign_recipients").select("id, account_id").eq("tenant_id", tenantId).in("id", chunk).range(a, b));
    for (const r of rows) recipientAccount.set(r.id, r.account_id);
  }
  const topicName = new Map(topicRows.filter((x) => x.enabled).map((x) => [x.id, x.name]));
  for (const c of clicks) {
    const topic = c.topic_id ? topicName.get(c.topic_id) : undefined;
    // One click per recipient and campaign per day: a mail scanner, or someone
    // clicking everything in one issue, is still one sign of interest.
    push(byAccount, recipientAccount.get(c.recipient_id), {
      kind: topic ? "link_click_topic" : "link_click", source: "newsletters", ...(topic ? { topic } : {}), key: `click:${c.recipient_id}:${c.clicked_at.slice(0, 10)}`,
      occurredAt: c.clicked_at,
      headline: topic ? `Clicked a link about ${topic} in "${nameOf(c.campaign_id)}"` : `Clicked a link in "${nameOf(c.campaign_id)}"`,
      href: ROUTES.marketingCampaign(c.campaign_id),
    });
  }

  // ── The shared event stream: what the product will emit as it grows ───────
  for (const e of events) {
    if (!e.account_id) continue;
    const key = `${e.name}:${e.dedupe_key}`;
    if (e.name === "quote.opened") {
      push(byAccount, e.account_id, { kind: "quote_opened", source: "quotes", key: `opened:${e.object_id}:${e.occurred_at.slice(0, 10)}`, occurredAt: e.occurred_at, headline: "Opened the quote link" });
    } else if (e.name === "quote.accepted") {
      push(byAccount, e.account_id, { kind: "quote_accepted", source: "quotes", key, occurredAt: e.occurred_at, headline: "Accepted a quote on the link" });
    } else if (e.name === "quote.change_requested") {
      push(byAccount, e.account_id, { kind: "quote_change", source: "quotes", key, occurredAt: e.occurred_at, headline: "Asked for a change to a quote" });
    } else if (e.name === "email.unsubscribed") {
      push(byAccount, e.account_id, { kind: "unsubscribed", source: "campaigns", key, occurredAt: e.occurred_at, headline: "Unsubscribed from marketing email" });
    } else if (e.name === "email.opened") {
      push(byAccount, e.account_id, { kind: "email_opened", source: "campaigns", key: `open:${e.object_id}:${e.account_id}`, occurredAt: e.occurred_at, headline: "Opened an email" });
    }
  }

  return { byAccount, warnings };
}
