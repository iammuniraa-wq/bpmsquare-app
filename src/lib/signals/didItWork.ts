import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStage, stageRank, type Stage } from "./types";

// "Did it work?" for a campaign or newsletter (docs/signals-architecture.md
// 4.3): which recipients moved up a stage in the 14 days after the send, against
// the 14 days before, in names and counts, not statistics. It reads
// account_intent_history -- nothing else, and no new score.

const DAY = 86_400_000;
export const WINDOW_DAYS = 14;
export const SMALL_SAMPLE = 20;

export type HistoryDay = { day: string; score: number; stage: Stage };

export type DidItWorkInput = {
  sentAt: string;
  now: Date;
  recipients: { account_id: string; name: string }[];
  /** Every account's stored days around the send (recipients and others). */
  history: Map<string, HistoryDay[]>;
  clicked: Set<string>;
};

export type MovedRow = { account_id: string; name: string; before: Stage; after: Stage; what: string };

export type DidItWork = {
  sentAt: string;
  recipients: number;
  movedUp: number;
  clicked: number;
  nowDeciding: number;
  avgBefore: number;
  avgAfter: number;
  others: { before: number; after: number; accounts: number } | null;
  /** The 14 days have not all passed yet: the "after" is "so far". */
  partial: boolean;
  small: boolean;
  rows: MovedRow[];
};

type At = { stage: Stage; score: number };
const QUIET: At = { stage: "quiet", score: 0 };

function at(days: HistoryDay[] | undefined, cutoffDay: string): At {
  let found: At = QUIET;
  for (const d of [...(days ?? [])].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.day <= cutoffDay) found = { stage: d.stage, score: d.score }; else break;
  }
  return found;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

export function computeDidItWork(i: DidItWorkInput): DidItWork {
  const sent = new Date(i.sentAt).getTime();
  const beforeDay = new Date(sent - DAY).toISOString().slice(0, 10);
  const end = Math.min(i.now.getTime(), sent + WINDOW_DAYS * DAY);
  const afterDay = new Date(end).toISOString().slice(0, 10);
  const partial = i.now.getTime() < sent + WINDOW_DAYS * DAY;

  const rec = new Set(i.recipients.map((r) => r.account_id));
  const rows: MovedRow[] = [];
  const beforeScores: number[] = [];
  const afterScores: number[] = [];
  let movedUp = 0, nowDeciding = 0, clicked = 0;

  for (const r of i.recipients) {
    const b = at(i.history.get(r.account_id), beforeDay);
    const a = at(i.history.get(r.account_id), afterDay);
    beforeScores.push(b.score);
    afterScores.push(a.score);
    const up = stageRank(a.stage) > stageRank(b.stage);
    const did = i.clicked.has(r.account_id);
    if (up) movedUp++;
    if (did) clicked++;
    if (a.stage === "deciding") nowDeciding++;
    if (up || did) {
      rows.push({
        account_id: r.account_id, name: r.name, before: b.stage, after: a.stage,
        what: [did ? "Clicked a link in the send" : null, a.score !== b.score ? `Score ${b.score} to ${a.score}` : null].filter(Boolean).join(" · ") || "No change",
      });
    }
  }
  rows.sort((x, y) => stageRank(y.after) - stageRank(y.before) - (stageRank(x.after) - stageRank(x.before)) || x.name.localeCompare(y.name));

  const otherIds = [...i.history.keys()].filter((id) => !rec.has(id));
  const others = otherIds.length
    ? { accounts: otherIds.length, before: avg(otherIds.map((id) => at(i.history.get(id), beforeDay).score)), after: avg(otherIds.map((id) => at(i.history.get(id), afterDay).score)) }
    : null;

  return {
    sentAt: i.sentAt, recipients: i.recipients.length, movedUp, clicked, nowDeciding,
    avgBefore: avg(beforeScores), avgAfter: avg(afterScores), others, partial, small: i.recipients.length < SMALL_SAMPLE, rows,
  };
}

/** Loads one campaign's recipients, clicks and the history around its send. Null when the campaign is not this tenant's or not sent. */
export async function loadDidItWork(admin: SupabaseClient, tenantId: string, campaignId: string, now: Date = new Date()): Promise<{ name: string; result: DidItWork | null } | null> {
  const { data: camp } = await admin.from("marketing_campaigns").select("id, name, sent_at").eq("id", campaignId).eq("tenant_id", tenantId).maybeSingle();
  if (!camp) return null;
  const c = camp as { id: string; name: string; sent_at: string | null };
  if (!c.sent_at) return { name: c.name, result: null };

  const recips: { account_id: string; id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("marketing_campaign_recipients").select("id, account_id")
      .eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "sent").range(from, from + 999);
    if (error) break;
    recips.push(...((data ?? []) as { id: string; account_id: string }[]));
    if ((data ?? []).length < 1000) break;
  }
  const ids = [...new Set(recips.map((r) => r.account_id))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    for (const a of (data ?? []) as { id: string; name: string }[]) names.set(a.id, a.name);
  }

  const recipientAccount = new Map(recips.map((r) => [r.id, r.account_id]));
  const clicked = new Set<string>();
  const { data: clicks } = await admin.from("marketing_link_clicks").select("recipient_id").eq("tenant_id", tenantId).eq("campaign_id", campaignId).limit(5000);
  for (const k of (clicks ?? []) as { recipient_id: string }[]) {
    const a = recipientAccount.get(k.recipient_id);
    if (a) clicked.add(a);
  }

  const since = new Date(new Date(c.sent_at).getTime() - (WINDOW_DAYS + 2) * DAY).toISOString().slice(0, 10);
  const history = new Map<string, HistoryDay[]>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin.from("account_intent_history").select("account_id, day, score, stage")
      .eq("tenant_id", tenantId).gte("day", since).range(from, from + 999);
    if (error) break;
    for (const r of (data ?? []) as { account_id: string; day: string; score: number; stage: string }[]) {
      if (!isStage(r.stage)) continue;
      history.set(r.account_id, [...(history.get(r.account_id) ?? []), { day: r.day, score: r.score, stage: r.stage }]);
    }
    if ((data ?? []).length < 1000) break;
  }

  return {
    name: c.name,
    result: computeDidItWork({
      sentAt: c.sent_at, now, history, clicked,
      recipients: ids.filter((id) => names.has(id)).map((id) => ({ account_id: id, name: names.get(id)! })),
    }),
  };
}
