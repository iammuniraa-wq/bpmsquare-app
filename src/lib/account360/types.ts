/**
 * Account 360 — the shared vocabulary between the server (which assembles
 * the cards) and the drawer (which renders them). The drawer knows how to
 * draw a *card*, not how to draw "the invoices card": every card, built-in
 * or tenant-plugged, arrives in this one shape, which is what makes an
 * external source a configuration change rather than a code change.
 */

export type Tone = "good" | "warn" | "bad" | "neutral";

export type Account360Stat = {
  label: string;
  value: string;
  /** Optional second line under the value (a trend, a qualifier). */
  hint?: string;
  tone?: Tone;
};

export type Account360Row = {
  title: string;
  meta?: string;
  value?: string;
  tone?: Tone;
  /** Internal app path; the drawer renders it as a link and closes itself. */
  href?: string;
};

export type Account360Card = {
  id: string;
  title: string;
  subtitle?: string;
  /** "internal" = this product's own data; "external" = a plugged source. */
  kind: "internal" | "external";
  stats?: Account360Stat[];
  rows?: Account360Row[];
  /** Shown in place of content when there's genuinely nothing to show. */
  empty?: string;
  /** Set when an external source could not be reached -- never silently blank. */
  error?: string;
};

export type Account360Factor = {
  label: string;
  /** Signed contribution to the score, already weighted. */
  points: number;
  detail: string;
};

export type Account360Rating = {
  /** 0-100. */
  score: number;
  grade: "A" | "B" | "C" | "D";
  label: string;
  factors: Account360Factor[];
};

export type Account360Suggestion = {
  id: string;
  title: string;
  detail: string;
  urgency: "high" | "medium" | "low";
  href?: string;
};

export type Account360Payload = {
  account: { id: string; name: string; ref: string | null; type: string; city: string | null; industry: string | null; since: string };
  rating: Account360Rating;
  suggestions: Account360Suggestion[];
  cards: Account360Card[];
};
