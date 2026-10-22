import type { Claim, Highlight } from "./types";

// "What they are doing": 3 to 5 one-line highlights, newest first, dated in words. No sources and no profile lines
// (owner corrections 2026-10-22 evening). Pure.

const DAY = 86_400_000;
export const MAX_HIGHLIGHTS = 5;

/** "today", "this week", "last week", "3 weeks ago", "last month", "5 months ago", "over a year ago". Empty without a date. */
export function whenInWords(publishedOn: string | undefined, now: Date): string {
  if (!publishedOn) return "";
  const days = Math.floor((now.getTime() - Date.parse(`${publishedOn}T00:00:00Z`)) / DAY);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days <= 7) return "this week";
  if (days <= 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return "over a year ago";
}

/**
 * Attached claims only (Check these never reach the card), no instruction-like text, no profile lines. Fresh items come
 * before stale ones, then newest first; undated items last. Same input, same output.
 */
export function toHighlights(claims: readonly Claim[], now: Date): Highlight[] {
  return claims
    .filter((c) => c.kind !== "profile" && c.confidence === "found" && !c.instructionLike)
    .sort((a, b) => Number(a.stale) - Number(b.stale) || (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || a.text.localeCompare(b.text))
    .slice(0, MAX_HIGHLIGHTS)
    .map((c) => ({
      text: c.text, kind: c.kind, when: whenInWords(c.publishedOn, now), stale: c.stale,
      ...(c.topic ? { topic: c.topic } : {}), ...(c.publishedOn ? { publishedOn: c.publishedOn } : {}),
    }));
}
