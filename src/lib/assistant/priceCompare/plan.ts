import { awardDecision, type AwardDecision, type CompareResponse } from "@/lib/rfq/comparison";
import { isUuid } from "@/lib/assistant/objects";
import { answerKey, ageText, dateWords, latestAnswers, usableUnit } from "./compute";
import type { AwardPlan, Comparison, Outlier, Validity } from "./types";

export const AWARD_ACT = "award_price";
export const MAX_AWARD_LINES = 40;

/**
 * The plan in one fixed key order, so the hash the card is signed with and the hash of what a press sends back are the same bytes. Anything
 * that is not exactly a plan (a missing id, a line count over the limit, an id that is not an id) is null.
 */
export function canonicalPlan(raw: unknown): AwardPlan | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || !isUuid(r.rfqId) || (r.route !== "tender" && r.route !== "rfq") || (r.mode !== "single" && r.mode !== "split")) return null;
  const dealId = r.dealId === null || r.dealId === undefined ? null : r.dealId;
  if (r.route === "tender" ? !isUuid(dealId) : dealId !== null) return null;
  if (!Array.isArray(r.targets) || r.targets.length < 1 || r.targets.length > MAX_AWARD_LINES) return null;
  const targets: AwardPlan["targets"] = [];
  for (const t of r.targets) {
    const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (!isUuid(x.lineId) || !isUuid(x.responseId) || !isUuid(x.rfqSupplierId) || typeof x.item !== "string") return null;
    targets.push({ lineId: x.lineId, responseId: x.responseId, rfqSupplierId: x.rfqSupplierId, item: x.item.slice(0, 20) });
  }
  return { rfqId: r.rfqId, route: r.route, dealId: dealId as string | null, mode: r.mode, targets };
}

// Which lines an award covers and which answer wins each, decided from the same comparison the card showed. PURE. The decision on every line
// (is it the lowest valid price, is the answer still valid) is the award route's own rule (awardDecision), so a line this file calls "needs a
// reason" is exactly a line the route would refuse without one.

export type SupplierMatch = { kind: "ok"; index: number } | { kind: "ask"; names: string[] } | { kind: "none" };

/** The supplier a person named: the whole name, or one word of it, or a part of it at least four letters long. Two matches is a question. */
export function matchSupplier(suppliers: readonly { name: string }[], wanted: string): SupplierMatch {
  const w = wanted.trim().toLowerCase();
  if (!w) return { kind: "none" };
  const exact = suppliers.map((s, i) => ({ s, i })).filter((x) => x.s.name.toLowerCase() === w);
  if (exact.length === 1) return { kind: "ok", index: exact[0].i };
  const part = suppliers.map((s, i) => ({ s, i })).filter((x) => {
    const n = x.s.name.toLowerCase();
    return n.split(/\s+/).includes(w) || (w.length >= 4 && n.includes(w));
  });
  if (part.length === 1) return { kind: "ok", index: part[0].i };
  return part.length > 1 ? { kind: "ask", names: part.map((x) => x.s.name) } : { kind: "none" };
}

export type LineChoice = {
  lineId: string;
  item: string;
  description: string;
  qty: number | null;
  responseId: string;
  rfqSupplierId: string;
  supplier: string;
  cost: number;
  validity: Validity;
  decision: AwardDecision;
  alreadyAwarded: boolean;
  alternative: boolean;
  outlier: Outlier | null;
};

export type PlanData = {
  responses: CompareResponse[];
  suppliers: { id: string; status: string }[];
  awards: { rfq_line_id: string; response_id: string }[];
  lineStatus: ReadonlyMap<string, string>;
};

export function chooseLines(a: {
  comparison: Comparison; data: PlanData; mode: "single" | "split"; supplierIndex: number | null; today: string; staleDays: number; tenantCurrency: string;
}): { picks: LineChoice[]; left: { item: string; reason: string }[] } {
  const { comparison, data } = a;
  const lineIds = new Set(comparison.lines.map((l) => l.id));
  const answers = latestAnswers(data.responses, lineIds);
  const live = new Set(data.suppliers.filter((s) => s.status !== "cancelled").map((s) => s.id));
  const picks: LineChoice[] = [];
  const left: { item: string; reason: string }[] = [];

  for (const line of comparison.lines) {
    const col = a.mode === "single" ? a.supplierIndex : line.cheapestIndex;
    const supplier = col === null || col === undefined ? null : comparison.suppliers[col];
    const cell = supplier && col !== null && col !== undefined ? line.cells[col] : null;
    if (!supplier || !cell || cell.unit === null) {
      left.push({ item: line.item, reason: a.mode === "single" && supplier ? `${supplier.name} did not quote it` : "no usable price" });
      continue;
    }
    const resp = answers.get(answerKey(supplier.id, line.id));
    const cost = resp ? usableUnit(resp, a.tenantCurrency) : null;
    if (!resp || cost === null) { left.push({ item: line.item, reason: "no usable price" }); continue; }
    const standing = data.awards.find((x) => x.rfq_line_id === line.id);
    if (standing && standing.response_id === resp.id) { left.push({ item: line.item, reason: `already awarded to ${supplier.name}` }); continue; }
    const onLine = [...answers.values()].filter((r) => r.rfq_line_id === line.id && live.has(r.rfq_supplier_id));
    const decision = awardDecision(resp.id, onLine, a.today, a.staleDays, null);
    picks.push({
      lineId: line.id, item: line.item, description: line.description, qty: line.qty, responseId: resp.id, rfqSupplierId: supplier.id, supplier: supplier.name,
      cost, validity: decision.validity, decision, alreadyAwarded: !!standing || data.lineStatus.get(line.id) === "awarded",
      alternative: cell.alternative, outlier: cell.outlier,
    });
  }
  return { picks, left };
}

/** One sentence on the markup behind the card's rates: the figure, and whether it is the BOQ row's own or the workspace's default. */
export function markupNote(rows: readonly { item: string; pct: number; own: boolean }[]): string | null {
  if (!rows.length) return null;
  const from = (own: boolean) => (own ? "set on the BOQ row" : "the workspace default");
  const same = rows.every((r) => r.pct === rows[0].pct && r.own === rows[0].own);
  if (same) return `Markup ${rows[0].pct}%, ${from(rows[0].own)}.`;
  return `Markup differs between lines: ${rows.map((r) => `item ${r.item} ${r.pct}% (${from(r.own)})`).join("; ")}.`;
}

/** The checks on an award that are not a clean pass, as plain sentences. Nothing here blocks: the card shows them and the person decides. */
export function awardNotices(picks: readonly LineChoice[], o: { staleDays: number; money: (n: number) => string; mode: "single" | "split"; supplier?: string; coverage?: { quoted: number; asked: number } }): string[] {
  const out: string[] = [];
  const items = (xs: readonly LineChoice[]) => xs.map((p) => p.item).join(", ");
  const notLowest = picks.filter((p) => p.decision.notLowest && p.decision.why === "higher");
  if (notLowest.length) out.push(`Item ${items(notLowest)} ${notLowest.length === 1 ? "is" : "are"} not the lowest valid price. A reason is needed.`);
  const old = picks.filter((p) => p.validity !== "ok");
  if (old.length) out.push(`Item ${items(old)}: the price is past its validity date or older than ${o.staleDays} days.${old.some((p) => p.decision.notLowest && p.decision.why !== "higher") ? " A reason is needed." : ""}`);
  if (o.mode === "single" && o.coverage && o.coverage.quoted < o.coverage.asked) {
    out.push(`${o.supplier ?? "This supplier"} quoted ${o.coverage.quoted} of ${o.coverage.asked} lines. The others stay open.`);
  }
  const odd = picks.filter((p) => p.outlier);
  for (const p of odd) {
    const x = p.outlier!;
    out.push(`Item ${p.item} is ${Math.abs(x.pct)}% ${x.pct > 0 ? "above" : "below"} your own price of ${o.money(x.refPrice)} (${x.refLabel}${x.refAsOf ? `, ${dateWords(x.refAsOf)}` : ""}${x.refStale ? `, stale: ${ageText(x.refAgeDays)}` : ""}).`);
  }
  const alt = picks.filter((p) => p.alternative);
  if (alt.length) out.push(`Item ${items(alt)}: the supplier offered something different. Check it first.`);
  const replace = picks.filter((p) => p.alreadyAwarded);
  if (replace.length) out.push(`Item ${items(replace)} already ${replace.length === 1 ? "has" : "have"} an award. Pressing the button replaces it.`);
  return out;
}
