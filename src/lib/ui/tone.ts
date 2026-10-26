import { c, pillar, type PillarKey } from "@/lib/theme";

// The one colour vocabulary for summary tiles, tinted cards and icon chips (docs/design/colour-system.md). A screen picks a tone
// from what a number MEANS; it never picks a colour. Every value resolves to theme.ts tokens, so the themes and dark mode follow.

export const TONES = ["info", "good", "warn", "bad", "context", "neutral"] as const;
export type Tone = (typeof TONES)[number];

/** Which pillar hue carries each tone. Neutral has none: it keeps the plain card surface. */
export const TONE_PILLAR: Record<Exclude<Tone, "neutral">, PillarKey> = {
  info: "blue",
  good: "teal",
  warn: "amber",
  bad: "red",
  context: "purple",
};

export type ToneTokens = {
  /** Tinted surface. */
  bg: string;
  /** Text colour on that surface (label, value, sub). */
  ink: string;
  /** The solid edge: the left of a tinted card. A stat tile has no coloured edge (owner, 2026-10-26). */
  edge: string;
  /** Quiet text on the surface (the sub line). */
  quiet: string;
};

export function toneTokens(tone: Tone = "neutral"): ToneTokens {
  if (tone === "neutral") return { bg: "var(--card-bg)", ink: c.ink, edge: c.line, quiet: c.hint };
  const p = pillar[TONE_PILLAR[tone]];
  return { bg: p.bg, ink: p.fg, edge: p.base, quiet: p.fg };
}

/** Planned margin as a share of the contract: negative is a loss, under the floor needs a look, otherwise healthy. */
export function toneForMargin(pct: number | null | undefined, floor = 10): Tone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "neutral";
  return pct < 0 ? "bad" : pct < floor ? "warn" : "good";
}

/** Days until a date: past is overdue, within `soonDays` needs attention, further out is just information. */
export function toneForDaysLeft(days: number | null | undefined, soonDays = 14): Tone {
  if (days === null || days === undefined || !Number.isFinite(days)) return "neutral";
  return days < 0 ? "bad" : days <= soonDays ? "warn" : "neutral";
}

/** A change against the previous figure. `upIs` says which direction is the comfortable one for that figure. */
export function toneForDelta(delta: number | null | undefined, upIs: "good" | "warn" = "good"): Tone {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || delta === 0) return "neutral";
  const comfortable = delta > 0 ? upIs === "good" : upIs === "warn";
  return comfortable ? "good" : "warn";
}

/** A spend against its limit: over is bad, at 90% or more needs a look. */
export function toneForBudget(spent: number, limit: number): Tone {
  if (!Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) return "neutral";
  return spent > limit ? "bad" : spent / limit >= 0.9 ? "warn" : "good";
}

const GOOD = new Set(["won", "approved", "done", "complete", "completed", "accepted", "paid", "active", "awarded", "closed_won"]);
const BAD = new Set(["lost", "rejected", "overdue", "failed", "cancelled", "canceled", "declined", "expired", "closed_lost", "no_bid"]);
const WARN = new Set(["pending", "draft", "waiting", "estimated", "expiring", "baseline_pending", "on_hold", "review", "needs_attention"]);

/** A status word (any case, spaces or hyphens) to the tone its pill label already implies. Unknown words stay neutral. */
export function toneForStatus(status: string | null | undefined): Tone {
  const k = (status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (GOOD.has(k)) return "good";
  if (BAD.has(k)) return "bad";
  if (WARN.has(k)) return "warn";
  return "neutral";
}
