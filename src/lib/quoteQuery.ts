/**
 * Quote Query — the deterministic fast-path behind the "ask, don't filter"
 * bar (fourth slice of the Quotations redesign, owner discussion
 * 2026-08-31). Pure functions, no browser/server-only APIs (URLSearchParams
 * exists in both), so the exact same filter logic runs client-side
 * (List's own already-loaded rows) and inside both Nova quote API routes
 * (Lanes, Field) -- one filter, never separate copies that can drift.
 *
 * Deliberately NOT an LLM call. The spec wants tokens to "drop out of the
 * text" as it resolves, which only feels instant if nothing round-trips
 * to a model first. reportCompile.ts (the engine behind Talk to data)
 * remains the right tool for genuinely open-ended questions -- this
 * module only recognises the small, common vocabulary the spec itself
 * names as examples (a value threshold, a status word, an idle-time
 * phrase). Anything else is left as plain leftover text and shown back
 * honestly as "couldn't read this part", never silently dropped -- this
 * IS the prototype; watching how much of it falls through here is the
 * point, per the concept study's own recommendation to prototype the bar
 * quietly before committing to more parser work.
 *
 * Two layers, on purpose. parseQuoteQuery(text) is the only NLP-ish part
 * and only runs once, when a query is committed (Enter) -- it turns free
 * text into tokens for display. Everything downstream of that (removing a
 * token, filtering List's rows, filtering Lanes'/Field's server queries)
 * runs on QuoteFilter, a plain structured criteria object serialised as
 * ordinary query params -- "the tokens are the truth" per the spec, so
 * once a token exists it's independent state, never re-derived from text
 * again. This is also what keeps every view honestly in sync: List,
 * Lanes and Field all resolve the SAME QuoteFilter from the SAME URL
 * params, not three independent readings of a sentence.
 *
 * Only "draft" / "sent" / "won" are recognised for status -- not the
 * spec's "negotiating", which isn't a real status or outcome value
 * anywhere in this schema (see types.ts: QuoteOutcome is
 * open/won/lost). A tenant with a custom quote_statuses value beyond
 * these isn't matched either; that's a real gap, not an oversight.
 */

export type QuoteToken =
  | { kind: "status"; value: "draft" | "sent"; label: string }
  | { kind: "outcome"; value: "won"; label: string }
  | { kind: "value_min"; value: number; label: string }
  | { kind: "value_max"; value: number; label: string }
  | { kind: "idle_min"; value: number; label: string };

export type QuoteQueryResult = { tokens: QuoteToken[]; leftover: string };

export type QuoteFilter = {
  valueMin?: number;
  valueMax?: number;
  idleMin?: number;
  status?: "draft" | "sent";
  outcome?: "won";
};

const AMOUNT = "₹?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:k|l|lakh|lakhs|cr|crore)?";

function parseAmount(phrase: string): number | null {
  const m = phrase.match(/₹?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh|lakhs|cr|crore)?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k") return num * 1_000;
  if (unit === "l" || unit === "lakh" || unit === "lakhs") return num * 100_000;
  if (unit === "cr" || unit === "crore") return num * 10_000_000;
  return num;
}

const money = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(n % 10_000_000 ? 1 : 0)}Cr`
  : n >= 100_000 ? `₹${(n / 100_000).toFixed(n % 100_000 ? 1 : 0)}L`
  : "₹" + n.toLocaleString("en-IN");

export function parseQuoteQuery(raw: string): QuoteQueryResult {
  let text = raw;
  const tokens: QuoteToken[] = [];

  const cut = (re: RegExp, onMatch: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (!m) return;
    onMatch(m);
    text = text.slice(0, m.index) + " " + text.slice((m.index ?? 0) + m[0].length);
  };

  cut(new RegExp(`\\b(?:over|above|more than|at least)\\s*${AMOUNT}`, "i"), (m) => {
    const v = parseAmount(m[0]);
    if (v != null) tokens.push({ kind: "value_min", value: v, label: `Value ≥ ${money(v)}` });
  });
  cut(new RegExp(`\\b(?:under|below|less than|at most)\\s*${AMOUNT}`, "i"), (m) => {
    const v = parseAmount(m[0]);
    if (v != null) tokens.push({ kind: "value_max", value: v, label: `Value ≤ ${money(v)}` });
  });
  cut(/\b(?:no activity|no movement|haven'?t moved|not moved|idle|stale)\D{0,20}?(\d+)\s*(day|days|week|weeks)\b/i, (m) => {
    const n = parseInt(m[1], 10) * (/week/i.test(m[2]) ? 7 : 1);
    tokens.push({ kind: "idle_min", value: n, label: `No activity ≥ ${n} days` });
  });
  cut(/\b(?:no activity|no movement|haven'?t moved|not moved|idle|stale)\b.{0,15}?\bfortnight\b/i, () => {
    tokens.push({ kind: "idle_min", value: 14, label: "No activity ≥ 14 days" });
  });
  cut(/\bfortnight\b/i, () => {
    if (!tokens.some((t) => t.kind === "idle_min")) tokens.push({ kind: "idle_min", value: 14, label: "No activity ≥ 14 days" });
  });
  cut(/\bdrafts?\b/i, () => tokens.push({ kind: "status", value: "draft", label: "Status: Draft" }));
  cut(/\bsent\b/i, () => tokens.push({ kind: "status", value: "sent", label: "Status: Sent" }));
  cut(/\b(?:won|accepted)\b/i, () => tokens.push({ kind: "outcome", value: "won", label: "Outcome: Won" }));

  // Filler words left behind by the cuts above ("that", "have", "with", a
  // stray "the") read as noise once their neighbours are gone -- strip
  // them so the leftover text is genuinely what the parser couldn't
  // place, not grammatical debris from what it could.
  const leftover = text
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^(?:that|which|and|with|the|have|has)\s+/i, "")
    .trim();

  return { tokens, leftover };
}

export function tokensToFilter(tokens: QuoteToken[]): QuoteFilter {
  const f: QuoteFilter = {};
  for (const t of tokens) {
    if (t.kind === "value_min") f.valueMin = t.value;
    else if (t.kind === "value_max") f.valueMax = t.value;
    else if (t.kind === "idle_min") f.idleMin = t.value;
    else if (t.kind === "status") f.status = t.value;
    else if (t.kind === "outcome") f.outcome = t.value;
  }
  return f;
}

/** Structured params every view's fetch (or client filter) reads -- the
 *  one shared vocabulary List, Lanes and Field all resolve identically. */
export function filterToParams(f: QuoteFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.valueMin != null) p.set("value_min", String(f.valueMin));
  if (f.valueMax != null) p.set("value_max", String(f.valueMax));
  if (f.idleMin != null) p.set("idle_min", String(f.idleMin));
  if (f.status) p.set("status", f.status);
  if (f.outcome) p.set("outcome", f.outcome);
  return p;
}

export function filterFromParams(p: URLSearchParams): QuoteFilter {
  const f: QuoteFilter = {};
  const vMin = p.get("value_min"); if (vMin) f.valueMin = Number(vMin);
  const vMax = p.get("value_max"); if (vMax) f.valueMax = Number(vMax);
  const iMin = p.get("idle_min"); if (iMin) f.idleMin = Number(iMin);
  const st = p.get("status"); if (st === "draft" || st === "sent") f.status = st;
  const oc = p.get("outcome"); if (oc === "won") f.outcome = oc;
  return f;
}

export function matchesFilter(
  q: { total: number; status: string; outcome: string; idleDays: number },
  f: QuoteFilter
): boolean {
  if (f.valueMin != null && q.total < f.valueMin) return false;
  if (f.valueMax != null && q.total > f.valueMax) return false;
  if (f.idleMin != null && q.idleDays < f.idleMin) return false;
  if (f.status && q.status !== f.status) return false;
  if (f.outcome && q.outcome !== f.outcome) return false;
  return true;
}
