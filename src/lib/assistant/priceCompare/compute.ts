import { landedUnit } from "@/lib/rfq/rules";
import { lowestByLine, needsFx, responseValidity, supplierTotal, type CompareResponse } from "@/lib/rfq/comparison";
import { ageDays } from "@/lib/tender/boq/price";
import {
  OUTLIER_PCT, SCORE_WEIGHTS, type CompareCell, type CompareLine, type CompareSupplier, type Comparison, type Outlier, type Risk, type ScoreParts,
} from "./types";

// The whole comparison, worked out from the RFQ's own rows and our own history. PURE and deterministic: no model, no clock, no database. Every
// figure on the dock's card and every figure the narrative may repeat is made here. The cheapest price per line is the compare screen's own rule
// (lowestByLine: the lowest price that is still valid), and a supplier's total is the compare screen's own sum (supplierTotal), so the card never
// disagrees with the screen it points to.

export type InLine = { id: string; slNo: number; description: string; uom: string | null; qty: number | null };
export type InSupplier = { id: string; supplierId: string; name: string; status: string };
/** A price from our own history for the same product: a past RFQ answer, the product's cost price, an estimate. Always a cost. */
export type Reference = { label: string; price: number; asOf: string | null };

export type CompareInput = {
  rfq: { id: string; ref: string; title: string; status: string };
  lines: InLine[];
  suppliers: InSupplier[];
  responses: CompareResponse[];
  today: string;
  /** How old a supplier answer with no validity date may be (the RFQ setting, 180 by default). */
  staleDays: number;
  /** How old a reference may be before it is called stale (the tender price validity, 180 by default). */
  referenceDays: number;
  tenantCurrency: string;
  references: ReadonlyMap<string, readonly Reference[]>;
  awardedLineIds?: ReadonlySet<string>;
  money: (n: number) => string;
};

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const qtyOf = (q: number | null) => (q !== null && Number.isFinite(q) && q > 0 ? q : 1);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateWords(key: string | null | undefined): string {
  const m = key ? /^(\d{4})-(\d{2})-(\d{2})/.exec(key) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}` : "";
}

export function ageText(days: number | null): string {
  if (days === null) return "no date";
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"} old`;
  const months = Math.round(days / 30.4);
  return `${months} months old`;
}

const list = (items: string[], max = 4): string => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

function pickReference(refs: readonly Reference[] | undefined): Reference | null {
  const ok = (refs ?? []).filter((r) => Number.isFinite(r.price) && r.price > 0);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? ""))[0];
}

type Used = { r: CompareResponse; unit: number };

export const answerKey = (rfqSupplierId: string, lineId: string): string => `${rfqSupplierId}:${lineId}`;

/** One answer per supplier and line: the latest, when a supplier answered the same line twice. */
export function latestAnswers(responses: readonly CompareResponse[], lineIds: ReadonlySet<string>): Map<string, CompareResponse> {
  const out = new Map<string, CompareResponse>();
  for (const r of responses) {
    if (!lineIds.has(r.rfq_line_id)) continue;
    const k = answerKey(r.rfq_supplier_id, r.rfq_line_id);
    const have = out.get(k);
    if (!have || r.submitted_at > have.submitted_at) out.set(k, r);
  }
  return out;
}

/** The landed unit price of an answer that can be compared, else null: a no-quote, a foreign price with no rate, or no price at all is left out. */
export function usableUnit(r: CompareResponse, tenantCurrency: string): number | null {
  if (r.status === "no_quote" || needsFx(r, tenantCurrency)) return null;
  const unit = landedUnit(r);
  return unit !== null && unit > 0 ? unit : null;
}

export function computeComparison(input: CompareInput): Comparison {
  const { today, staleDays, money } = input;
  const lines = input.lines;
  const asked = lines.length;
  const lineIds = new Set(lines.map((l) => l.id));
  const live = input.suppliers.filter((s) => s.status !== "cancelled");

  const answer = latestAnswers(input.responses, lineIds);

  const used = (s: InSupplier, l: InLine): Used | null => {
    const r = answer.get(answerKey(s.id, l.id));
    const unit = r ? usableUnit(r, input.tenantCurrency) : null;
    return r && unit !== null ? { r, unit } : null;
  };
  const hasFxGap = (s: InSupplier, l: InLine): boolean => {
    const r = answer.get(answerKey(s.id, l.id));
    return !!r && r.status !== "no_quote" && needsFx(r, input.tenantCurrency);
  };

  const columns = live.filter((s) => lines.some((l) => used(s, l)));
  const notPriced = live.filter((s) => !columns.includes(s)).map((s) => {
    const fx = lines.some((l) => hasFxGap(s, l));
    const replied = lines.some((l) => answer.has(answerKey(s.id, l.id)));
    const reason = fx ? "quoted in another currency with no exchange rate set"
      : s.status === "declined" ? "declined to quote"
      : replied ? "answered without a usable price"
      : s.status === "pending" ? "the request has not been sent"
      : "has not answered yet";
    return { name: s.name, reason };
  });

  const usableResponses: CompareResponse[] = [];
  for (const s of columns) for (const l of lines) { const u = used(s, l); if (u) usableResponses.push(u.r); }
  const { valid, any } = lowestByLine(usableResponses, today, staleDays);
  const columnOf = new Map<string, number>();
  columns.forEach((s, i) => { for (const l of lines) { const u = used(s, l); if (u) columnOf.set(u.r.id, i); } });

  const outLines: CompareLine[] = lines.map((l) => {
    const ref = pickReference(input.references.get(l.id));
    const best = valid.get(l.id) ?? any.get(l.id) ?? null;
    const noValid = !valid.has(l.id) && any.has(l.id);
    const cells = columns.map((s): CompareCell | null => {
      const r = answer.get(answerKey(s.id, l.id));
      if (!r) return null;
      const u = used(s, l);
      if (!u) {
        return { unit: null, amount: null, validity: null, leadDays: null, validUntil: null, cheapest: false, alternative: false, left: hasFxGap(s, l) ? "no_fx" : "no_quote", outlier: null };
      }
      const validity = responseValidity(r, today, staleDays);
      let outlier: Outlier | null = null;
      if (ref) {
        const pct = round1(((u.unit - ref.price) / ref.price) * 100);
        if (Math.abs(pct) >= OUTLIER_PCT) {
          const age = ageDays(ref.asOf, today);
          outlier = { pct, refPrice: ref.price, refLabel: ref.label, refAsOf: ref.asOf, refStale: age === null || age > input.referenceDays, refAgeDays: age };
        }
      }
      return {
        unit: u.unit, amount: round2(u.unit * qtyOf(l.qty)), validity, leadDays: r.lead_time_days, validUntil: r.valid_until,
        cheapest: best !== null && u.unit === best.landed && (noValid || validity === "ok"), alternative: r.status === "alternative", left: null, outlier,
      };
    });
    const prices = cells.map((c) => c?.unit ?? null).filter((n): n is number => n !== null);
    const spreadPct = prices.length >= 2 && Math.min(...prices) > 0 ? round1(((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100) : null;
    return {
      id: l.id, item: String(l.slNo), description: l.description, uom: l.uom, qty: l.qty, cells,
      cheapestIndex: best ? columnOf.get(best.id) ?? null : null, noValid, spreadPct,
    };
  });

  const commonLines = outLines.filter((l) => columns.length > 0 && l.cells.every((c) => c && c.unit !== null));
  const commonIds = new Set(commonLines.map((l) => l.id));
  const lineObjs = lines.map((l) => ({ id: l.id, qty: l.qty }));
  const mineOf = (s: InSupplier) => lines.map((l) => used(s, l)?.r).filter((r): r is CompareResponse => !!r);

  const bestAny = new Map<string, number>();
  for (const [lineId, b] of any) bestAny.set(lineId, b.landed);

  const supplierRows = columns.map((s, i): Omit<CompareSupplier, "score" | "parts" | "recommended"> => {
    const mine = mineOf(s);
    const cells = outLines.map((l) => l.cells[i]);
    const quotedCells = cells.filter((c): c is CompareCell => !!c && c.unit !== null);
    const leads = quotedCells.map((c) => c.leadDays).filter((n): n is number => n !== null);
    const untils = quotedCells.map((c) => c.validUntil).filter((d): d is string => !!d).sort();
    return {
      id: s.id, supplierId: s.supplierId, name: s.name, quoted: quotedCells.length, asked, partial: quotedCells.length < asked,
      missingItems: outLines.filter((_, k) => !cells[k] || cells[k]!.unit === null).map((l) => l.item),
      total: supplierTotal(lineObjs, mine),
      likeForLike: commonLines.length ? supplierTotal(lineObjs.filter((l) => commonIds.has(l.id)), mine) : null,
      leadMin: leads.length ? Math.min(...leads) : null, leadMax: leads.length ? Math.max(...leads) : null,
      validUntil: untils[0] ?? null,
      expired: quotedCells.filter((c) => c.validity !== "ok").length,
    };
  });

  const leadFloor = supplierRows.map((s) => s.leadMax).filter((n): n is number => n !== null);
  const minLead = leadFloor.length ? Math.min(...leadFloor) : null;
  const scored = supplierRows.map((s, i) => {
    let paid = 0;
    let bestPaid = 0;
    lines.forEach((l, k) => {
      const c = outLines[k].cells[i];
      const b = bestAny.get(l.id);
      if (c && c.unit !== null && b !== undefined) { paid += c.unit * qtyOf(l.qty); bestPaid += b * qtyOf(l.qty); }
    });
    const index = bestPaid > 0 && paid > 0 ? paid / bestPaid : 1;
    const parts: ScoreParts = {
      price: round1(SCORE_WEIGHTS.price / Math.max(1, index)),
      completeness: asked > 0 ? round1((SCORE_WEIGHTS.completeness * s.quoted) / asked) : 0,
      validity: s.quoted > 0 ? round1((SCORE_WEIGHTS.validity * (s.quoted - s.expired)) / s.quoted) : 0,
      lead: minLead === null || s.leadMax === null ? round1(SCORE_WEIGHTS.lead / 2) : round1((SCORE_WEIGHTS.lead * (1 + minLead)) / (1 + s.leadMax)),
    };
    return { s, parts, score: round1(parts.price + parts.completeness + parts.validity + parts.lead) };
  });

  const order = scored.map((x, i) => ({ x, i })).sort((a, b) =>
    b.x.score - a.x.score || (a.x.s.likeForLike ?? a.x.s.total) - (b.x.s.likeForLike ?? b.x.s.total) || a.i - b.i);
  const recIndex = order.length ? order[0].i : null;

  const suppliers: CompareSupplier[] = scored.map(({ s, parts, score }, i) => ({ ...s, score, parts, recommended: i === recIndex }));

  const completes = suppliers.map((s, i) => ({ s, i })).filter((x) => !x.s.partial);
  const single = completes.length ? completes.reduce((a, b) => (b.s.total < a.s.total ? b : a)) : null;
  const bestSingle = single ? { index: single.i, name: single.s.name, total: single.s.total } : null;

  let split: Comparison["split"] = null;
  if (columns.length >= 2) {
    let sum = 0;
    let n = 0;
    const who = new Set<number>();
    for (const l of outLines) {
      const c = l.cheapestIndex === null ? null : l.cells[l.cheapestIndex];
      if (!c || c.unit === null) continue;
      sum += c.unit * qtyOf(l.qty);
      n++;
      who.add(l.cheapestIndex!);
    }
    if (n > 0) {
      const total = round2(sum);
      const saving = bestSingle && n === asked ? round2(bestSingle.total - total) : null;
      split = { total, lines: n, suppliers: who.size, saving, savingPct: saving !== null && bestSingle!.total > 0 ? round1((saving / bestSingle!.total) * 100) : null };
    }
  }

  let spread: Comparison["spread"] = null;
  const lfl = suppliers.map((s) => s.likeForLike).filter((n): n is number => n !== null);
  if (columns.length >= 2 && lfl.length >= 2 && Math.min(...lfl) > 0) {
    const amount = round2(Math.max(...lfl) - Math.min(...lfl));
    spread = { amount, pct: round1((amount / Math.min(...lfl)) * 100) };
  }

  const risks = buildRisks({ input, columns, suppliers, outLines, commonLines: commonLines.length, notPriced, asked, money });

  return {
    rfq: input.rfq, currencyCode: input.tenantCurrency, today, staleDays, suppliers, lines: outLines,
    commonLines: commonLines.length, askedLines: asked, bestSingle, split, spread, weights: SCORE_WEIGHTS, outlierPct: OUTLIER_PCT,
    recommendation: recIndex === null ? null : { index: recIndex, name: suppliers[recIndex].name },
    notPriced, risks,
  };
}

function buildRisks(a: {
  input: CompareInput; columns: InSupplier[]; suppliers: CompareSupplier[]; outLines: CompareLine[]; commonLines: number;
  notPriced: { name: string; reason: string }[]; asked: number; money: (n: number) => string;
}): Risk[] {
  const { suppliers, outLines, money, input } = a;
  const out: Risk[] = [];
  if (a.columns.length === 1) {
    out.push({ id: "single", kind: "single", level: "info", text: `Only ${suppliers[0].name} has given prices, so there is nothing to compare yet.` });
  }
  const partial = suppliers.filter((s) => s.partial);
  if (partial.length && a.columns.length >= 2) {
    out.push({
      id: "basis", kind: "basis", level: "info",
      text: a.commonLines > 0
        ? `Compared like for like on the ${a.commonLines} ${a.commonLines === 1 ? "line" : "lines"} every supplier quoted.`
        : "No line was quoted by every supplier, so totals cannot be compared like for like.",
    });
  }
  for (const s of partial) {
    out.push({
      id: `partial:${s.id}`, kind: "partial", level: "warn",
      text: `${s.name} quoted ${s.quoted} of ${s.asked} lines (missing ${list(s.missingItems)}), so its total of ${money(s.total)} is not comparable with a full quote.`,
    });
  }
  const outliers: { line: CompareLine; i: number; o: Outlier }[] = [];
  for (const line of outLines) line.cells.forEach((c, i) => { if (c?.outlier) outliers.push({ line, i, o: c.outlier }); });
  outliers.sort((x, y) => Math.abs(y.o.pct) - Math.abs(x.o.pct));
  for (const { line, i, o } of outliers) {
    const unit = line.cells[i]!.unit!;
    out.push({
      id: `outlier:${line.id}:${i}`, kind: "outlier", level: "warn",
      text: `Item ${line.item}: ${suppliers[i].name} at ${money(unit)} is ${Math.abs(o.pct)}% ${o.pct > 0 ? "above" : "below"} your own price of ${money(o.refPrice)} (${o.refLabel}${o.refAsOf ? `, ${dateWords(o.refAsOf)}` : ""}${o.refStale ? `, stale: ${ageText(o.refAgeDays)}` : ""}).`,
    });
  }
  for (const s of suppliers) {
    if (s.expired > 0) {
      const items = outLines.filter((l) => { const c = l.cells[suppliers.indexOf(s)]; return c && c.validity && c.validity !== "ok"; }).map((l) => l.item);
      out.push({
        id: `expired:${s.id}`, kind: "expired", level: "warn",
        text: `${s.name}: ${s.expired} ${s.expired === 1 ? "price is" : "prices are"} past its validity date or older than ${input.staleDays} days (item ${list(items)}).`,
      });
    }
  }
  const fx = suppliers.map((s, i) => ({ s, items: outLines.filter((l) => l.cells[i]?.left === "no_fx").map((l) => l.item) })).filter((x) => x.items.length);
  for (const { s, items } of fx) {
    out.push({ id: `no_fx:${s.id}`, kind: "no_fx", level: "warn", text: `${s.name} quoted item ${list(items)} in another currency with no exchange rate set, so ${items.length === 1 ? "that price is" : "those prices are"} left out.` });
  }
  const alt = suppliers.map((s, i) => ({ s, items: outLines.filter((l) => l.cells[i]?.alternative).map((l) => l.item) })).filter((x) => x.items.length);
  for (const { s, items } of alt) {
    out.push({ id: `alternative:${s.id}`, kind: "alternative", level: "warn", text: `${s.name} offered something different on item ${list(items)}: check what it is before awarding.` });
  }
  const noValid = outLines.filter((l) => l.noValid).map((l) => l.item);
  if (noValid.length) {
    out.push({ id: "no_valid", kind: "no_valid", level: "warn", text: `Item ${list(noValid)} has no price that is still valid; the lowest of what exists is shown.` });
  }
  for (const n of a.notPriced) {
    out.push({ id: `silent:${n.name}`, kind: "silent", level: "info", text: `${n.name} ${n.reason}.` });
  }
  const awarded = input.awardedLineIds ? outLines.filter((l) => input.awardedLineIds!.has(l.id)).map((l) => l.item) : [];
  if (awarded.length) {
    out.push({ id: "awarded", kind: "awarded", level: "info", text: `${awarded.length === 1 ? "Item" : "Items"} ${list(awarded)} already ${awarded.length === 1 ? "has" : "have"} an award; a new one would replace it.` });
  }
  return out;
}
