import type { SupabaseClient } from "@supabase/supabase-js";
import { plainCampaignConsent } from "@/lib/newsletter/send";
import type { MarketingRecipientCandidate } from "@/lib/data/live";
import { skipReason, type SkipFix } from "./skipReasons";

/**
 * "Who will really receive this?" for a plain email: the same decisions the send makes
 * (opt-out, address, the person, the consent gate), run without sending or writing anything.
 * Replaces a count that only looked at the account's email field and could say 5 and send 0.
 */

export type LeftOut = {
  name: string;
  email: string | null;
  code: string;
  label: string;
  why: string;
  fix: SkipFix | null;
};

export type PlainAudiencePlan = {
  total: number;
  willReceive: number;
  leftOut: LeftOut[];
  /** How many were left out per reason code, biggest first. */
  byCode: { code: string; label: string; count: number }[];
};

type Verdict = { ok: true } | { ok: false; status: string; reason: string; contact: { id: string } | null };

export function summariseVerdicts(rows: { candidate: MarketingRecipientCandidate; verdict: Verdict }[], cap = 200): PlainAudiencePlan {
  const left: LeftOut[] = [];
  const counts = new Map<string, { label: string; count: number }>();
  let willReceive = 0;
  for (const { candidate, verdict } of rows) {
    if (verdict.ok) { willReceive++; continue; }
    const r = skipReason(verdict.reason || verdict.status, { accountId: candidate.account_id, contactId: verdict.contact?.id ?? null, email: candidate.email ?? candidate.manual_email });
    const seen = counts.get(r.code);
    counts.set(r.code, { label: r.label, count: (seen?.count ?? 0) + 1 });
    if (left.length < cap) left.push({ name: candidate.account_name, email: candidate.email, code: r.code, label: r.label, why: r.why, fix: r.fix });
  }
  const byCode = [...counts.entries()].map(([code, v]) => ({ code, label: v.label, count: v.count })).sort((a, b) => b.count - a.count);
  return { total: rows.length, willReceive, leftOut: left, byCode };
}

export async function planPlainAudience(d: {
  admin: SupabaseClient; tenantId: string; topic: string | null; candidates: MarketingRecipientCandidate[]; concurrency?: number;
}): Promise<PlainAudiencePlan> {
  const consentFor = await plainCampaignConsent({ admin: d.admin, tenantId: d.tenantId, topic: d.topic, candidates: d.candidates });
  const width = Math.max(1, d.concurrency ?? 5);
  const rows: { candidate: MarketingRecipientCandidate; verdict: Verdict }[] = [];
  for (let i = 0; i < d.candidates.length; i += width) {
    const slice = d.candidates.slice(i, i + width);
    const verdicts = await Promise.all(slice.map((c) => consentFor(c)));
    slice.forEach((candidate, k) => rows.push({ candidate, verdict: verdicts[k] }));
  }
  return summariseVerdicts(rows);
}
