// Tender Watch: the plain-code parts (docs/design/nova-crew-agents.md section 4). Pure, client-safe, unit-tested without a model:
// the sensitivity table, the plan gate that decides which tenders are worth a model's time, the key-fact bucket that goes into a
// finding's fingerprint, and who a note about a finding may be addressed to. Every threshold and date calculation lives here, in
// code. The model only judges what this selects.

import type { DraftFinding, Sensitivity } from "../types";
import type { TenderCrewFacts } from "@/lib/tender/crewFacts";
import { DESK_BOND_WARN_DAYS, DESK_STALE_WINDOW_DAYS, DESK_UNPRICED_WINDOW_DAYS } from "@/lib/tenderDesk/rules";

export const TENDER_KINDS = ["at_risk", "stuck_decision", "blocked_on_question", "addendum_unreviewed", "missing_info"] as const;
export type TenderKind = (typeof TENDER_KINDS)[number];

/** Words an agent that must never predict, price or advise may not use (case-insensitive, whole words or phrases). */
export const TENDER_BANNED = [
  "will win", "likely to win", "chance of winning", "win probability", "winning chance", "recommend bidding", "should bid", "should not bid", "no-bid recommended",
  "suggested price", "suggest a price", "margin", "markup", "discount", "undercut", "cheaper",
] as const;

/** "How sensitive" is one control that maps to these (design 3.7): a workspace never edits several numbers. */
export type TenderThresholds = { watchWindowDays: number; decisionWaitDays: number; silentRoomDays: number; noBoqAfterDays: number };

export const TENDER_THRESHOLDS: Record<Sensitivity, TenderThresholds> = {
  quiet: { watchWindowDays: 14, decisionWaitDays: 4, silentRoomDays: 7, noBoqAfterDays: 7 },
  balanced: { watchWindowDays: 21, decisionWaitDays: 2, silentRoomDays: 5, noBoqAfterDays: 5 },
  thorough: { watchWindowDays: 30, decisionWaitDays: 1, silentRoomDays: 3, noBoqAfterDays: 3 },
};

export function thresholdsFor(sensitivity: Sensitivity | undefined, watchWindowDays?: number | null): TenderThresholds {
  const base = TENDER_THRESHOLDS[sensitivity ?? "balanced"] ?? TENDER_THRESHOLDS.balanced;
  const w = typeof watchWindowDays === "number" && Number.isFinite(watchWindowDays) ? Math.min(90, Math.max(3, Math.floor(watchWindowDays))) : base.watchWindowDays;
  return { ...base, watchWindowDays: w };
}

/** What the previous run saw for a deal, kept in crew_runs.snapshot so "an addendum was recorded since yesterday" is computable. */
export type DealSnapshot = { addenda: number; boq_version: number | null };
export type TenderSnapshot = Record<string, DealSnapshot>;

export const snapshotOf = (facts: readonly TenderCrewFacts[]): TenderSnapshot =>
  Object.fromEntries(facts.map((f) => [f.deal_id, { addenda: f.addenda_count, boq_version: f.boq?.version ?? null }]));

/** The reasons a deal is a candidate. Empty = skip it (costs nothing). A live tender only. */
export function candidateReasons(f: TenderCrewFacts, prev: TenderSnapshot | null, t: TenderThresholds): string[] {
  if (!f.live) return [];
  const why: string[] = [];
  const d = f.days_to_close;
  const inWindow = d !== null && d <= t.watchWindowDays;
  if (inWindow) why.push("within the watch window");
  // What the plain desk already raises (rankAttention's inputs), recomputed from the same thresholds.
  if (d !== null && d <= DESK_UNPRICED_WINDOW_DAYS && (f.boq?.priced ?? 0) === 0) why.push("closing soon and nothing priced");
  if (d !== null && d <= DESK_STALE_WINDOW_DAYS && (f.boq?.stale ?? 0) > 0) why.push("stale prices before the bid end date");
  if (f.bond.days_to_expiry !== null && f.bond.days_to_expiry <= DESK_BOND_WARN_DAYS && f.bond.state !== "Released") why.push("guarantee expiring");
  if (f.approval.pending && (f.approval.age_days ?? 0) > t.decisionWaitDays) why.push("bid decision waiting");
  if (f.questions.overdue > 0) why.push("room question past due");
  const before = prev?.[f.deal_id];
  if (before && (f.addenda_count !== before.addenda || (f.boq?.version ?? null) !== before.boq_version)) why.push("addendum or BOQ version changed");
  if ((f.stage === "received" || f.stage === "bid_no_bid") && inWindow) why.push("early stage near the bid end date");
  return [...new Set(why)];
}

/** The one key fact of a finding, bucketed: a worse situation is a NEW fingerprint, the same one is never raised twice. */
export function fingerprintBucket(kind: string, f: TenderCrewFacts | undefined): string {
  if (!f) return "-";
  const d = f.days_to_close;
  switch (kind) {
    case "at_risk": return d === null ? "nodate" : d <= 0 ? "d0" : d <= 1 ? "d1" : d <= 3 ? "d3" : d <= 7 ? "d7" : "d21";
    case "stuck_decision": return (f.approval.age_days ?? 0) >= 7 ? "w1" : "a";
    case "blocked_on_question": return `q${Math.min(f.questions.open, 5)}`;
    case "addendum_unreviewed": return `a${f.addenda_count}`;
    default: return "m";
  }
}

/** The members a note about this finding may be addressed to. Null = no note is allowed for this kind. Computed here, never by the model. */
export function permittedRecipients(draft: Pick<DraftFinding, "kind">, f: TenderCrewFacts | undefined): ReadonlySet<string> | null {
  if (!f) return null;
  const owner = [f.owner_id, ...f.team_ids].filter((x): x is string => !!x);
  switch (draft.kind) {
    case "at_risk": return new Set([...owner, ...f.rfq.buyer_ids, ...f.questions.owner_ids]);
    // Deciders only: the proposer is not one unless the workspace allows self-approval (decidersFor already applied that).
    case "stuck_decision": return f.approval.decider_ids.length ? new Set(f.approval.decider_ids) : null;
    case "blocked_on_question": return f.questions.owner_ids.length ? new Set(f.questions.owner_ids) : null;
    case "addendum_unreviewed": return owner.length ? new Set(owner) : null;
    default: return null;
  }
}

/** Who SEES a finding (and may approve a note about it): the deal's owner and team and the workspace admins. */
export function findingRecipients(f: TenderCrewFacts | undefined): string[] {
  if (!f) return [];
  return [...new Set([f.owner_id, ...f.team_ids, ...f.people.admin_ids].filter((x): x is string => !!x))];
}

/** A cheap description for the Runs tab: "6 tenders in the watch window". */
export const candidateSummary = (n: number, total: number): string =>
  n === 0 ? `Nothing to report. ${total} live tender${total === 1 ? "" : "s"} checked` : `${n} of ${total} live tender${total === 1 ? "" : "s"} looked at`;
