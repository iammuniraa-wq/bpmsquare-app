import type { Account360Card, Account360Row, Account360Stat } from "@/lib/account360/types";
import { analyseQuestion } from "./dockAsk";
import { ANALYSIS_TIPS } from "./tips";
import { FOLLOW_UP_TEXT, type AnalysisCard, type FollowUp } from "./types";

// The Account 360 summary card "Company analysis" (docs/design/account-analysis.md 2, owner corrections 2026-10-22
// evening). A card is data (bpmsquarecore 10a): this builds the one shape the drawer draws. It reads a saved analysis
// only -- the verdict, two or three highlights and how long ago it was made -- and offers one button that opens the AI
// slider. No source and no address is ever placed on it. Pure.

export const CARD_ID = "company_analysis";
export const MAX_ROWS = 3;

const DAY = 86_400_000;

/** "today", "yesterday", "3 days ago", "2 weeks ago", "3 months ago". */
export function agoInWords(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / DAY);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return "over a year ago";
}

const FOLLOW_UP_TONE: Record<FollowUp, Account360Stat["tone"]> = { yes: "good", not_now: "neutral", unclear: "neutral" };

export function buildAnalysisSummaryCard(account: { id: string; name: string }, card: AnalysisCard | null, now: Date): Account360Card {
  const base: Account360Card = { id: CARD_ID, title: "Company analysis", subtitle: ANALYSIS_TIPS.card360, kind: "internal" };
  if (!card) {
    return { ...base, empty: "Not analysed yet.", action: { label: "Analyse", ask: analyseQuestion(account.name), accountId: account.id } };
  }
  const v = card.verdict;
  const rows: Account360Row[] = card.doing.slice(0, MAX_ROWS).map((h) => ({
    title: h.text,
    meta: [h.when, h.topic].filter(Boolean).join(" · ") || undefined,
    ...(h.kind === "risk" ? { tone: "bad" as const } : {}),
  }));
  return {
    ...base,
    stats: [
      { label: "Worth following up", value: FOLLOW_UP_TEXT[v.followUp], tone: FOLLOW_UP_TONE[v.followUp] },
      {
        label: "Last analysed", value: agoInWords(card.refreshedAt, now),
        ...(card.stale ? { hint: "Older than seven days. Refresh to look for news.", tone: "warn" as const } : {}),
      },
    ],
    summary: v.sentence.text,
    ...(rows.length > 0 ? { rows } : {}),
    action: { label: "Refresh", ask: analyseQuestion(account.name, true), accountId: account.id },
  };
}
