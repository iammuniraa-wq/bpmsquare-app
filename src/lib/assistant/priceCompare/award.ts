import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditWorkcenter } from "@/lib/permissions";
import { signToken, hashOf } from "@/lib/actions/token";
import { awardMarkup, awardRate, roundMoney, tenderMarkupDefault } from "@/lib/tender/costing/rules";
import { promptText } from "@/lib/assistant/promptSafe";
import { lineLabel, linesNamed, namesLines } from "@/lib/assistant/lineWords";
import { buildComparison, dealsVisible } from "./compare";
import { currencyView, moneyOf, type PriceEnv } from "./env";
import { compareHref, tenderDealOf } from "./link";
import { resolveRfq } from "./load";
import { AWARD_ACT, MAX_AWARD_LINES, awardNotices, canonicalPlan, chooseLines, markupNote, matchSupplier, type LineChoice } from "./plan";
import { parseAwardInput } from "./tools";
import { flaggedOf } from "@/lib/suppliers/check/awardGate";
import { loadAwardChecks } from "@/lib/suppliers/check/awardGateServer";
import type { AwardLineView, AwardPlan, Comparison, DockAward } from "./types";

// propose_award: a confirm card for "Award and price", never an award. It shows the lines, the cost, the markup the screen would add and every
// check that is not a pass, and signs a plan the press (press.ts) must present unchanged. The award itself is the existing award route.

type RowPricing = { markupPct: number | null; removed: boolean };

/** For a tender RFQ raised from the deal: the BOQ row each RFQ line prices and that row's own markup, as the compare screen reads them. */
async function loadRowPricing(db: SupabaseClient, tenantId: string, dealId: string, rfqLineIds: string[]): Promise<Map<string, RowPricing>> {
  const out = new Map<string, RowPricing>();
  if (!rfqLineIds.length) return out;
  const { data: dl } = await db.from("opportunity_lines").select("id, rfq_line_id").eq("tenant_id", tenantId).eq("opportunity_id", dealId).in("rfq_line_id", rfqLineIds);
  const dealLines = (dl ?? []) as { id: string; rfq_line_id: string }[];
  if (!dealLines.length) return out;
  const { data: bq } = await db.from("tender_boq_lines").select("line_id, markup_pct, removed_in_revision").eq("tenant_id", tenantId).eq("opportunity_id", dealId).in("line_id", dealLines.map((d) => d.id));
  const boq = new Map(((bq ?? []) as { line_id: string; markup_pct: unknown; removed_in_revision: boolean | null }[]).map((b) => [b.line_id, b]));
  for (const d of dealLines) {
    const b = boq.get(d.id);
    const m = b?.markup_pct === null || b?.markup_pct === undefined ? null : Number(b.markup_pct);
    out.set(d.rfq_line_id, { markupPct: m !== null && Number.isFinite(m) ? m : null, removed: b?.removed_in_revision === true });
  }
  return out;
}

const view = (p: LineChoice, rate: number | null, markupPct: number | null): AwardLineView => ({
  lineId: p.lineId, responseId: p.responseId, rfqSupplierId: p.rfqSupplierId, item: p.item, description: p.description, supplier: p.supplier, cost: p.cost,
  qty: p.qty, markupPct, rate, needsReason: p.decision.notLowest, validity: p.validity, alreadyAwarded: p.alreadyAwarded,
});

const itemsNamed = (comparison: Comparison, words: string) => linesNamed(comparison.lines, words);

/** Of a deal's several RFQs, the ones where the named lines were priced by the named supplier. */
async function rfqsHolding(env: PriceEnv, refs: string[], words: string, supplier: string): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const found = await resolveRfq(env.supabase, env.tenantId, ref, { deals: dealsVisible(env) });
    if (found.kind !== "ok") continue;
    const built = await buildComparison(env, found.rfq, []);
    if ("error" in built) continue;
    const named = itemsNamed(built.comparison, words);
    const m = supplier ? matchSupplier(built.comparison.suppliers, supplier) : null;
    if (named.length && (!m || (m.kind === "ok" && named.some((l) => l.cells[m.index]?.unit != null)))) out.push(ref);
  }
  return out;
}

async function openDealRef(env: PriceEnv): Promise<string> {
  if (!env.openDealId) return "";
  const { data } = await env.supabase.from("opportunities").select("ref").eq("id", env.openDealId).eq("tenant_id", env.tenantId).maybeSingle();
  return (data as { ref?: string | null } | null)?.ref ?? "";
}

/** `out` is for the model; `say` is a refusal as the person reads it when no model is asked. */
export async function runProposeAward(raw: unknown, env: PriceEnv): Promise<{ out: string; card?: DockAward; say?: string }> {
  if (!env.access.award || !env.userId) return { out: "Error: awarding from the assistant is not enabled for this person here." };
  const input = parseAwardInput(raw);
  const reference = input.reference || (await openDealRef(env));
  let found = await resolveRfq(env.supabase, env.tenantId, reference, { deals: dealsVisible(env) });
  const words = input.lines ?? "";
  const only = namesLines(words);
  if (found.kind === "ask" && only) {
    const holding = await rfqsHolding(env, found.options.map((o) => o.ref), words, input.mode === "single" ? input.supplier : "");
    if (holding.length === 1) found = await resolveRfq(env.supabase, env.tenantId, holding[0], { deals: dealsVisible(env) });
  }
  if (found.kind !== "ok") return { out: found.message, say: found.message.replace(/ Ask the person which one\.$/, " Which one? Give the RFQ's reference.") };
  const built = await buildComparison(env, found.rfq, []);
  if ("error" in built) return { out: built.error, say: built.error };
  const { data } = built;
  let { comparison } = built;
  const ref = comparison.rfq.ref;
  if (only) {
    const named = itemsNamed(comparison, words);
    if (!named.length) {
      const say = `No line of ${ref} matches "${lineLabel(words)}". Its lines are: ${comparison.lines.slice(0, 8).map((l) => `${l.item} ${promptText(l.description, 60)}`).join("; ")}.`;
      return { out: `${say} Tell the person; no card has been shown.`, say };
    }
    comparison = { ...comparison, lines: named };
  }

  let supplierIndex: number | null = null;
  if (input.mode === "single") {
    const m = matchSupplier(comparison.suppliers, input.supplier);
    if (m.kind === "ask") {
      const say = `Several suppliers match "${input.supplier}": ${m.names.join(", ")}.`;
      return { out: `${say} Ask the person which one.`, say: `${say} Which one?` };
    }
    if (m.kind === "none") {
      const say = `${input.supplier ? `No priced supplier on ${ref} matches "${input.supplier}".` : "Which supplier?"} The suppliers with prices are ${comparison.suppliers.map((s) => promptText(s.name, 60)).join(", ")}.`;
      return { out: `${say} Ask the person which one.`, say };
    }
    supplierIndex = m.index;
  }

  const deal = await tenderDealOf(env.supabase, env.tenantId, env.features, found.rfq).catch(() => null);
  const route: AwardPlan["route"] = deal ? "tender" : "rfq";
  const money = moneyOf(env.currency);
  const { picks, left } = chooseLines({
    comparison, data, mode: input.mode, supplierIndex, today: data.today, staleDays: data.staleDays, tenantCurrency: data.currencyCode,
  });

  let blocked: string | null = null;
  const status = found.rfq.status;
  if (status === "cancelled" || status === "closed") blocked = `${ref} is ${status}, so it cannot be awarded.`;
  else if (data.awardsPending) blocked = "Recording an award needs a database update (migration 0224) that has not been applied here. Ask your administrator.";
  else if (!canEditWorkcenter(env.perms, "rfqs")) blocked = "You can view RFQs but not award them.";
  else if (deal && !canEditWorkcenter(env.perms, "pipeline")) blocked = "You can view this deal but not change it.";
  else if (picks.length === 0) blocked = "There is nothing to award: " + (left.length ? `${left.map((l) => `item ${l.item} (${l.reason})`).slice(0, 4).join("; ")}.` : "no line has a usable price.");
  else if (picks.length > MAX_AWARD_LINES) blocked = `This award covers ${picks.length} lines. Award it from the compare screen instead.`;

  let pricing = new Map<string, RowPricing>();
  let markupDefault: number | null = null;
  const notices: string[] = [];
  if (deal && found.rfq.origin_type === "opportunity") {
    markupDefault = tenderMarkupDefault(data.config as Parameters<typeof tenderMarkupDefault>[0]);
    pricing = await loadRowPricing(env.supabase, env.tenantId, deal.dealId, picks.map((p) => p.lineId)).catch(() => new Map());
    const off = picks.filter((p) => !pricing.get(p.lineId) || pricing.get(p.lineId)!.removed);
    if (off.length) notices.push(`Item ${off.map((p) => p.item).join(", ")} ${off.length === 1 ? "is" : "are"} not on a BOQ row of the deal, so the award will not set a rate there.`);
  } else if (deal) {
    notices.push("This RFQ is for an estimate: the awarded cost goes into the estimate line, which re-prices its BOQ rows for review.");
  }

  const coverage = supplierIndex === null ? undefined : { quoted: comparison.suppliers[supplierIndex].quoted, asked: comparison.askedLines };
  notices.push(...awardNotices(picks, { staleDays: data.staleDays, money, mode: input.mode, supplier: supplierIndex === null ? undefined : comparison.suppliers[supplierIndex].name, coverage: only ? undefined : coverage }));
  if (only) notices.push("Only the lines you named are on this card. The others are not changed.");
  const leftNotes = left.filter((l) => !l.reason.startsWith("already awarded"));
  if (leftNotes.length) notices.push(`Left out: ${leftNotes.slice(0, 5).map((l) => `item ${l.item} (${l.reason})`).join("; ")}${leftNotes.length > 5 ? ` and ${leftNotes.length - 5} more` : ""}.`);
  const kept = left.filter((l) => l.reason.startsWith("already awarded"));
  if (kept.length) notices.push(`Item ${kept.map((l) => l.item).join(", ")} already ${kept.length === 1 ? "has" : "have"} this award and ${kept.length === 1 ? "is" : "are"} left as it is.`);

  const markups: { item: string; pct: number; own: boolean }[] = [];
  const lines: AwardLineView[] = picks.map((p) => {
    const row = pricing.get(p.lineId);
    const priced = deal && markupDefault !== null && row && !row.removed;
    const markup = priced ? awardMarkup({ requested: null, rowMarkup: row.markupPct, fallback: markupDefault! }) : null;
    if (markup !== null) markups.push({ item: p.item, pct: markup, own: (row!.markupPct ?? 0) > 0 });
    return view(p, markup === null ? null : awardRate(p.cost, markup), markup);
  });
  const total = roundMoney(picks.reduce((sum, p) => sum + p.cost * (p.qty !== null && p.qty > 0 ? p.qty : 1), 0));
  const plan: AwardPlan = {
    rfqId: found.rfq.id, route, dealId: deal?.dealId ?? null, mode: input.mode,
    targets: picks.map((p) => ({ lineId: p.lineId, responseId: p.responseId, rfqSupplierId: p.rfqSupplierId, item: p.item })),
  };
  const who = input.mode === "single" && supplierIndex !== null ? comparison.suppliers[supplierIndex].name : "each line's cheapest valid supplier";
  const summary = `Award ${picks.length} ${picks.length === 1 ? "line" : "lines"} of ${ref} to ${who} at a cost of ${money(total)}.${route === "tender" ? " The markup is added to make the rate." : " The price is stored as the line's cost."} Nothing is awarded until you press the button.`;
  const cardId = (env.newId ?? randomUUID)();
  const supplierIds = picks.map((p) => data.suppliers.find((s) => s.id === p.rfqSupplierId)?.supplierId ?? "").filter(Boolean);
  const flaggedChecks = flaggedOf((await loadAwardChecks(env.supabase, env.tenantId, supplierIds).catch(() => ({ checks: [] }))).checks);
  const card: DockAward = {
    kind: "award", id: cardId,
    token: signToken({ cid: cardId, tid: env.tenantId, uid: env.userId, act: AWARD_ACT, h: hashOf(canonicalPlan(plan)), dup: "", sm: summary, pv: {} }),
    title: input.mode === "single" ? `Award ${ref} to ${who}` : `Award ${ref} by line`,
    summary, rfq: { id: found.rfq.id, ref }, plan, lines, left, total,
    pricesRows: route === "tender" && found.rfq.origin_type === "opportunity",
    markupDefaultPct: markupDefault, markupNote: markupNote(markups),
    needsReason: lines.some((l) => l.needsReason), needsReplace: lines.some((l) => l.alreadyAwarded),
    notices, blocked, primaryLabel: route === "tender" ? "Award and price" : "Award", currency: currencyView(env.currency),
    compareHref: compareHref(found.rfq.id, deal), risk: "write", supplierChecks: flaggedChecks,
  };
  const note = [
    flaggedChecks.length ? "A supplier on the card is flagged in the Supplier check: the person types the reason for awarding anyway on the card. Never supply a reason yourself." : "",
    blocked ? `The card is shown but cannot be pressed: ${blocked}` : "Card shown. NOTHING is awarded yet: the person must press the button on the card, so never say it was awarded.",
    notices.length ? `Checks that are not a pass: ${notices.slice(0, 4).join(" ")}` : "",
    "Reply with one short line and repeat no figure.",
  ].filter(Boolean).join(" ");
  return { out: note.replace(/[<>]/g, ""), card };
}
