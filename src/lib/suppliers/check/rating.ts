import { landedUnit } from "@/lib/rfq/rules";
import { RATING_MIN_RFQS, RATING_MONTHS, type Rating, type RatingBasis, type RatingComponent, type RatingComponentId } from "./types";

// "Our rating": 0 to 5, from the workspace's own RFQ history with this supplier over the last 24 months. Pure and deterministic, and
// the formula is printed on the card, so a number a buyer is told to act on can always be explained. It never reads the web.

export type RatingRfqSupplier = { id: string; rfq_id: string; supplier_id: string; status: string; sent_at: string | null; replied_at: string | null };
export type RatingLine = { id: string; rfq_id: string; status: string };
export type RatingResponse = {
  id: string; rfq_supplier_id: string; rfq_line_id: string; status: string; unit_price: number | null; fx_rate: number | null;
  valid_until: string | null; submitted_at: string; is_awarded: boolean;
};

export const RATING_WEIGHTS: Record<RatingComponentId, number> = { price: 30, response: 20, completeness: 15, validity: 15, speed: 10, awards: 10 };

const LABEL: Record<RatingComponentId, string> = {
  price: "Price against the others on the same lines",
  response: "Answers to our requests",
  completeness: "Lines quoted of the lines asked",
  validity: "States how long its price holds",
  speed: "Speed of reply",
  awards: "Lines won of the lines quoted",
};

export const RATING_FORMULA =
  "Rating = 5 x the weighted average of: price against the others 30%, answers to requests 20% (a reply counts 1, a decline counts half), " +
  "lines quoted of lines asked 15%, quotes that state how long the price holds 15%, speed of reply 10% (a day or less is full marks, a week or more is none), " +
  "lines won of lines quoted 10% (winning half of what it quotes is full marks). A part with no data drops out and the rest are re-weighted. " +
  `Built from RFQs sent in the last ${RATING_MONTHS} months; it needs at least ${RATING_MIN_RFQS}.`;

const priced = (r: RatingResponse): number | null => {
  if (r.status === "no_quote") return null;
  const v = landedUnit({ unit_price: r.unit_price, fx_rate: r.fx_rate });
  return v !== null && v > 0 ? v : null;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeRating(input: {
  supplierId: string;
  now: Date;
  rfqSuppliers: readonly RatingRfqSupplier[];
  lines: readonly RatingLine[];
  responses: readonly RatingResponse[];
}): Rating {
  const cutoff = new Date(input.now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RATING_MONTHS);
  const inWindow = (r: RatingRfqSupplier) => !!r.sent_at && Date.parse(r.sent_at) >= cutoff.getTime() && r.status !== "cancelled";

  const mine = input.rfqSuppliers.filter((r) => r.supplier_id === input.supplierId && inWindow(r));
  const mineIds = new Set(mine.map((r) => r.id));
  const linesOf = (rfqId: string) => input.lines.filter((l) => l.rfq_id === rfqId && l.status !== "cancelled");
  const myResponses = input.responses.filter((r) => mineIds.has(r.rfq_supplier_id));
  const myQuotes = myResponses.filter((r) => priced(r) !== null);

  const comps: RatingComponent[] = [];
  const push = (id: RatingComponentId, score: number | null, detail: string) =>
    comps.push({ id, label: LABEL[id], weight: RATING_WEIGHTS[id], score: score === null ? null : Math.round(clamp01(score) * 1000) / 1000, detail });

  const replied = mine.filter((r) => r.status === "replied");
  const declined = mine.filter((r) => r.status === "declined");
  push("response", mine.length ? (replied.length + declined.length * 0.5) / mine.length : null,
    `${replied.length} replied and ${declined.length} declined of ${plural(mine.length, "request", "requests")}`);

  const hours = replied
    .filter((r) => r.sent_at && r.replied_at)
    .map((r) => (Date.parse(r.replied_at as string) - Date.parse(r.sent_at as string)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  if (hours.length) {
    const h = median(hours);
    push("speed", h <= 24 ? 1 : h >= 168 ? 0 : 1 - (h - 24) / (168 - 24), `typical reply in ${h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} days`} (${plural(hours.length, "reply", "replies")})`);
  } else push("speed", null, "no reply with a time recorded");

  const askedLines = replied.reduce((n, r) => n + linesOf(r.rfq_id).length, 0);
  const quotedLines = replied.reduce((n, r) => {
    const asked = new Set(linesOf(r.rfq_id).map((l) => l.id));
    return n + new Set(myQuotes.filter((q) => q.rfq_supplier_id === r.id && asked.has(q.rfq_line_id)).map((q) => q.rfq_line_id)).size;
  }, 0);
  push("completeness", askedLines ? quotedLines / askedLines : null, askedLines ? `${quotedLines} of ${plural(askedLines, "line", "lines")} quoted` : "no replied request to measure");

  // Price rank on every line this supplier quoted and at least one other supplier quoted too, in the same RFQ.
  const scores: number[] = [];
  const rsRfq = new Map(input.rfqSuppliers.map((r) => [r.id, r.rfq_id]));
  for (const q of myQuotes) {
    const mineV = priced(q) as number;
    const rfqId = rsRfq.get(q.rfq_supplier_id);
    const others = input.responses.filter((o) => o.rfq_line_id === q.rfq_line_id && o.rfq_supplier_id !== q.rfq_supplier_id && rsRfq.get(o.rfq_supplier_id) === rfqId);
    const prices = new Map<string, number>();
    for (const o of others) { const v = priced(o); if (v !== null && !prices.has(o.rfq_supplier_id)) prices.set(o.rfq_supplier_id, v); }
    if (!prices.size) continue;
    const cheaper = [...prices.values()].filter((v) => v < mineV).length;
    scores.push(1 - cheaper / prices.size);
  }
  push("price", scores.length >= 2 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    scores.length >= 2 ? `compared on ${plural(scores.length, "line", "lines")} that others quoted too` : scores.length === 1 ? "only 1 line was quoted by others as well, too few to compare" : "no line was quoted by others as well");

  const won = myQuotes.filter((q) => q.is_awarded).length;
  push("awards", myQuotes.length ? Math.min(1, (won / myQuotes.length) * 2) : null, myQuotes.length ? `${won} of ${plural(myQuotes.length, "quoted line", "quoted lines")} awarded` : "nothing quoted yet");

  const stated = myQuotes.filter((q) => !!q.valid_until && /^\d{4}-\d{2}-\d{2}/.test(q.valid_until) && q.valid_until.slice(0, 10) >= q.submitted_at.slice(0, 10)).length;
  push("validity", myQuotes.length ? stated / myQuotes.length : null, myQuotes.length ? `${stated} of ${plural(myQuotes.length, "quoted line", "quoted lines")} give a validity date` : "nothing quoted yet");

  const enough = mine.length >= RATING_MIN_RFQS;
  const usable = comps.filter((c) => c.score !== null);
  const totalWeight = usable.reduce((n, c) => n + c.weight, 0);
  const value = enough && totalWeight > 0 ? Math.round((5 * usable.reduce((n, c) => n + (c.score as number) * c.weight, 0) / totalWeight) * 100) / 100 : null;
  const basis: RatingBasis = { months: RATING_MONTHS, rfqs: mine.length, replied: replied.length, won, enough, components: comps, formula: RATING_FORMULA };
  return { value, basis };
}

/** One decimal, the way the card and the list show a rating. */
export const ratingText = (v: number | null): string => (v === null ? "—" : v.toFixed(1));
