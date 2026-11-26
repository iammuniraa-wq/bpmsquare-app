import { promptJson, promptText } from "@/lib/assistant/promptSafe";
import { SCORE_WEIGHTS, type Comparison } from "./types";

// What the model is allowed to know about a comparison, and the rules its two sentences must keep. The block holds every figure already written the
// way the card writes it; the model copies, it never works anything out. The check below is what makes that true and not just asked for: a sentence
// with a figure that is not in the block, or that does not name the recommended supplier, is thrown away and the computed sentence stands in.

type Money = (n: number) => string;

const cheapestOn = (c: Comparison, index: number): number => c.lines.filter((l) => l.cheapestIndex === index).length;

export function factsBlock(c: Comparison, money: Money): Record<string, unknown> {
  const rec = c.recommendation ? c.suppliers[c.recommendation.index] : null;
  const lead = (s: { leadMin: number | null; leadMax: number | null }) => (s.leadMax === null ? null : s.leadMin === s.leadMax ? `${s.leadMax} days` : `${s.leadMin} to ${s.leadMax} days`);
  return {
    rfq: c.rfq.ref,
    currency: c.currencyCode,
    lines_asked: c.askedLines,
    lines_quoted_by_all: c.commonLines,
    score_weights: `price ${SCORE_WEIGHTS.price}, completeness ${SCORE_WEIGHTS.completeness}, validity ${SCORE_WEIGHTS.validity}, lead time ${SCORE_WEIGHTS.lead}`,
    recommended: rec && {
      name: promptText(rec.name, 80), score: `${rec.score} of 100`, lines_quoted: `${rec.quoted} of ${rec.asked}`, total: money(rec.total),
      cheapest_on_lines: cheapestOn(c, c.recommendation!.index), lead_time: lead(rec), prices_expired_or_stale: rec.expired,
    },
    suppliers: c.suppliers.map((s, i) => ({
      name: promptText(s.name, 80), score: `${s.score} of 100`, lines_quoted: `${s.quoted} of ${s.asked}`, total: money(s.total),
      like_for_like_total: s.likeForLike === null ? null : money(s.likeForLike), cheapest_on_lines: cheapestOn(c, i), lead_time: lead(s),
    })),
    best_single_supplier: c.bestSingle && { name: promptText(c.bestSingle.name, 80), total: money(c.bestSingle.total) },
    split_by_line: c.split && {
      total: money(c.split.total), suppliers_needed: c.split.suppliers,
      saving_vs_best_single: c.split.saving === null ? null : money(c.split.saving), saving_percent: c.split.savingPct,
    },
    spread_lowest_to_highest: c.spread && { amount: money(c.spread.amount), percent: c.spread.pct },
    warnings: c.risks.filter((r) => r.level === "warn").slice(0, 5).map((r) => promptText(r.text, 220)),
  };
}

export function factsPrompt(block: Record<string, unknown>): string {
  return `<facts>\n${promptJson(block)}\n</facts>`;
}

/** Every number in a text, as a value: "412,350.00" and "412350" are the same number. */
export function numbersIn(text: string): number[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((t) => Number(t.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

export type NarrativeCheck = { ok: true; text: string } | { ok: false; reason: string };

/** The model's recommendation, accepted only when it is two plain sentences that name the supplier and use no figure the block does not hold. */
export function checkNarrative(raw: unknown, block: Record<string, unknown>, supplierName: string): NarrativeCheck {
  if (typeof raw !== "string") return { ok: false, reason: "no text" };
  const text = raw.replace(/[<>`*_#]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > 480) return { ok: false, reason: "too long" };
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 1 || sentences.length > 2) return { ok: false, reason: "not one or two sentences" };
  if (!text.toLowerCase().includes(supplierName.toLowerCase())) return { ok: false, reason: "does not name the supplier" };
  const allowed = new Set(numbersIn(JSON.stringify(block)));
  const stray = numbersIn(text).find((n) => !allowed.has(n));
  if (stray !== undefined) return { ok: false, reason: `a figure that is not in the facts: ${stray}` };
  return { ok: true, text };
}

/** The recommendation written by the program, from the same block: used when the model is unavailable or breaks a rule. */
export function computedRecommendation(c: Comparison, money: Money): string {
  if (!c.recommendation) return "No supplier has given a usable price yet, so there is nothing to recommend.";
  const rec = c.suppliers[c.recommendation.index];
  if (c.suppliers.length === 1) return `Only ${rec.name} has priced this RFQ, with a total of ${money(rec.total)}. There is nothing to compare it with yet.`;
  const cheap = cheapestOn(c, c.recommendation.index);
  const first = `${rec.name} scores ${rec.score} of 100: ${rec.partial ? `it quoted ${rec.quoted} of ${rec.asked} lines` : "it quoted every line"} and is the cheapest on ${cheap} of ${c.askedLines}${rec.expired ? `, but ${rec.expired} ${rec.expired === 1 ? "price is" : "prices are"} no longer valid` : ""}.`;
  if (c.bestSingle && c.bestSingle.index !== c.recommendation.index) {
    return `${first} The lowest single-supplier total is ${c.bestSingle.name} at ${money(c.bestSingle.total)}, so check the other points before awarding.`;
  }
  if (c.split && c.split.saving !== null && c.split.saving > 0 && c.split.suppliers > 1) {
    return `${first} Splitting the award by line would cost ${money(c.split.total)}, ${money(c.split.saving)} less than the best single supplier${c.split.savingPct !== null ? ` (${c.split.savingPct}%)` : ""}.`;
  }
  return `${first} Its total is ${money(rec.total)}${c.spread ? `, ${c.spread.pct}% apart from the dearest like-for-like total` : ""}.`;
}

/** The card as compact plain text for the next turns of the chat: the model sees it as quoted data, never as an instruction. */
export function comparisonDigest(c: Comparison, recommendation: string, money: Money): string {
  const out: string[] = [
    `Price comparison for ${promptText(c.rfq.ref, 40)} ${promptText(c.rfq.title, 80)}: ${c.suppliers.length} suppliers priced ${c.askedLines} lines.`,
    ...c.suppliers.map((s, i) => `- ${promptText(s.name, 60)}: ${s.quoted} of ${s.asked} lines, total ${money(s.total)}${s.likeForLike !== null ? `, like for like ${money(s.likeForLike)}` : ""}, score ${s.score}, cheapest on ${cheapestOn(c, i)}${s.recommended ? " (recommended)" : ""}`),
  ];
  if (c.bestSingle) out.push(`Best single supplier: ${promptText(c.bestSingle.name, 60)} at ${money(c.bestSingle.total)}.`);
  if (c.split) out.push(`Split by line: ${money(c.split.total)} over ${c.split.suppliers} suppliers${c.split.saving !== null ? `, saving ${money(c.split.saving)}` : ""}.`);
  out.push(`Recommendation: ${promptText(recommendation, 400)}`);
  for (const r of c.risks.filter((x) => x.level === "warn").slice(0, 5)) out.push(`Risk: ${promptText(r.text, 200)}`);
  return out.join("\n").slice(0, 1800);
}
