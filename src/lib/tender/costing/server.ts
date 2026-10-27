import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter, canCreateWorkcenter } from "@/lib/permissions";
import { opportunityStages } from "@/lib/sales/opportunity";
import { loadOpportunityLines, refreshOpportunityDerived } from "@/lib/sales/opportunityServer";
import { openTenderDealRequest, type TenderDealRequest } from "@/lib/tender/dealAccess";
import { isMissingSchema } from "@/lib/tender/server";
import { tenderRfqLines } from "@/lib/tender/rfqLines";
import { isStale, priceValidityDays } from "@/lib/tender/boq/price";
import { buildEstimatesState, loadDealEstimate, type EstimatesState } from "@/lib/tender/estimates/server";
import { bidIsLocked, isUuid } from "@/lib/tender/estimates/rules";
import { rfqConfig, RFQ_STATUS_LABEL, type Rfq, type RfqStatus } from "@/lib/rfq/types";
import { RFQ_STATUS_TONE } from "@/components/rfq/rfqUi";
import { awardWithDecision, loadCurrentAwards, AwardError, type AwardTarget, type AwardOutcome } from "@/lib/rfq/awards";
import { isMissingRelation, loadRfqBundle, rfqLineStatuses } from "@/lib/rfq/server";
import { lowestByLine, responseValidity, type CompareResponse } from "@/lib/rfq/comparison";
import { loadActorNames } from "@/lib/actorNames";
import type { DocLineForRfq } from "@/components/rfq/prefill";
import {
  awardMarkup, awardedFields, awardSourceRef, estimateState, lineAmount, parseMarkup, rfqIsOut, rfqState, roundMoney, rowsRef, tenderMarkupDefault,
  type BoqSummary, type CompareView, type CostingData, type CostingEstimateItem, type CostingItem, type CostingRfqItem,
} from "./rules";

// Server side of the Costing tab (docs/design/gcc-tender-deals.md section 25). Estimates and RFQs of one tender deal in one list, the
// compare screen of an RFQ, and the ONE place an RFQ line is awarded for a tender: "Award and price". Every query is tenant-scoped on the
// service-role client and tolerates a pending migration. The door is openCostingRequest(): the tender flags, the Pipeline view (edit for
// a write), a tender deal of THIS workspace, and at least one of the estimator and RFQ modules the caller may see.

export type CostingRequest = TenderDealRequest & {
  /** The estimator is on and the caller may view Estimates. */
  estimates: { canCreate: boolean } | null;
  /** The RFQ module is on and the caller may view RFQs. */
  rfqs: { canEdit: boolean } | null;
  canEditDeal: boolean;
};
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };

export async function openCostingRequest(opportunityId: string, write: boolean): Promise<{ ok: true; req: CostingRequest } | ({ ok: false } & Failure)> {
  const gate = await openTenderDealRequest(opportunityId, write);
  if (!gate.ok) return gate;
  const { req } = gate;
  const perms = await resolvePermissions(req.supabase, req.tenantId, req.userId, req.role);
  const estimatesOn = (await tenantOwnsObject(req.tenantId, "estimates")) && canViewWorkcenter(perms, "estimates");
  const rfqOn = (await tenantOwnsObject(req.tenantId, "rfqs")) && canViewWorkcenter(perms, "rfqs");
  if (!estimatesOn && !rfqOn) return { ok: false, status: 404, error: "Not found" };
  return {
    ok: true,
    req: {
      ...req,
      estimates: estimatesOn ? { canCreate: canCreateWorkcenter(perms, "estimates") } : null,
      rfqs: rfqOn ? { canEdit: canEditWorkcenter(perms, "rfqs") } : null,
      canEditDeal: canEditWorkcenter(perms, "pipeline"),
    },
  };
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function loadConfig(admin: SupabaseClient, tenantId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  return ((data?.config ?? {}) as Record<string, unknown>) ?? {};
}

// ── The BOQ rows, as the Costing tab needs them ──────────────────────────────────────────────────────────────────────────

type BoqRowLite = { boq_id: string | null; line_id: string; item: string; priced: boolean; stale: boolean; row_no: number };

/** The deal's rows: every selected deal line, with its BOQ item number where it has one. Removed rows are left out. */
async function loadRows(admin: SupabaseClient, tenantId: string, oppId: string, validityDays: number, today: string): Promise<{ rows: BoqRowLite[]; lines: (DocLineForRfq & { is_selected?: boolean | null })[] }> {
  const dealLines = await loadOpportunityLines(admin, tenantId, oppId);
  const { data, error } = await admin.from("tender_boq_lines")
    .select("id, line_id, item_no, row_no, removed_in_revision, price_source, price_as_of, stale_accepted").eq("tenant_id", tenantId).eq("opportunity_id", oppId).limit(5000);
  const boqByLine = new Map<string, Record<string, unknown>>();
  if (!error) for (const b of (data ?? []) as Record<string, unknown>[]) if (b.line_id) boqByLine.set(String(b.line_id), b);
  const rows: BoqRowLite[] = [];
  for (const l of dealLines) {
    if (l.is_selected === false || l.break_of) continue;
    const b = boqByLine.get(l.id);
    if (b?.removed_in_revision === true) continue;
    const rate = Number(l.rate);
    const priced = rate > 0;
    const src = (b?.price_source as string | null) ?? null;
    const stale = priced && !!src && isStale(src as Parameters<typeof isStale>[0], (b?.price_as_of as string | null) ?? null, today, validityDays) && b?.stale_accepted !== true;
    rows.push({
      boq_id: b ? String(b.id) : null, line_id: l.id, priced, stale,
      item: String((b?.item_no as string | null) ?? l.sl_no ?? b?.row_no ?? "").trim() || "—", row_no: Number(b?.row_no ?? 0),
    });
  }
  // The client's order where the BOQ gives one.
  if (rows.some((x) => x.row_no > 0)) rows.sort((a, b) => (a.row_no || 1e9) - (b.row_no || 1e9));
  return { rows, lines: dealLines as unknown as (DocLineForRfq & { is_selected?: boolean | null })[] };
}

function summarise(rows: readonly BoqRowLite[]): BoqSummary {
  return { rows: rows.length, priced: rows.filter((x) => x.priced).length, unpriced: rows.filter((x) => !x.priced).length, stale: rows.filter((x) => x.stale).length };
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type RfqHead = Pick<Rfq, "id" | "ref" | "title" | "status" | "origin_type" | "origin_id" | "origin_label" | "respond_by" | "created_at">;
const RFQ_COLS = "id, ref, title, status, origin_type, origin_id, origin_label, respond_by, created_at";

export async function buildCostingState(r: CostingRequest): Promise<CostingData> {
  const { admin, tenantId, opp } = r;
  const [config, today] = [await loadConfig(admin, tenantId), await tenantToday(tenantId)];
  const rfqCfg = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq);
  const validity = priceValidityDays(config as Parameters<typeof priceValidityDays>[0]);
  const { rows, lines } = await loadRows(admin, tenantId, opp.id, validity, today);
  const itemOfBoq = new Map(rows.filter((x) => x.boq_id).map((x) => [x.boq_id!, x.item]));
  const itemOfLine = new Map(rows.map((x) => [x.line_id, x.item]));

  // Estimates
  let est: EstimatesState | null = null;
  let pendingEstimates = false;
  if (r.estimates) {
    est = await buildEstimatesState(r);
    pendingEstimates = est.pending;
  }
  const items: CostingItem[] = [];
  const rowsOfEstimate = new Map<string, string[]>();
  if (est && !est.pending) {
    for (const l of est.links) {
      const item = itemOfBoq.get(l.boq_id);
      if (item) rowsOfEstimate.set(l.estimate_id, [...(rowsOfEstimate.get(l.estimate_id) ?? []), item]);
    }
  }

  // RFQs
  let pendingRfqs = false;
  const rfqHeads: RfqHead[] = [];
  if (r.rfqs) {
    const estimateIds = est && !est.pending ? est.estimates.map((e) => e.id) : [];
    const a = await admin.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).eq("origin_type", "opportunity").eq("origin_id", opp.id).order("created_at", { ascending: false }).limit(200);
    if (a.error) pendingRfqs = isMissingRelation(a.error);
    else rfqHeads.push(...((a.data ?? []) as unknown as RfqHead[]));
    if (!pendingRfqs && estimateIds.length > 0) {
      for (const part of chunks(estimateIds, 100)) {
        const b = await admin.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).eq("origin_type", "estimate").in("origin_id", part).order("created_at", { ascending: false }).limit(200);
        if (!b.error) rfqHeads.push(...((b.data ?? []) as unknown as RfqHead[]));
      }
    }
  }
  const rfqItems = pendingRfqs ? [] : await rfqItemsFor(r, rfqHeads, { rows, itemOfLine, rowsOfEstimate, today, staleDays: rfqCfg.price_valid_days, lines });

  if (est && !est.pending) {
    const rfqsOfEstimate = new Map<string, CostingEstimateItem["rfqs"]>();
    for (const h of rfqHeads) {
      if (h.origin_type !== "estimate" || !h.origin_id) continue;
      rfqsOfEstimate.set(h.origin_id, [...(rfqsOfEstimate.get(h.origin_id) ?? []), {
        id: h.id, ref: h.ref, status_label: RFQ_STATUS_LABEL[h.status as RfqStatus] ?? h.status, tone: RFQ_STATUS_TONE[h.status as RfqStatus] ?? "blue",
      }]);
    }
    for (const e of est.estimates) {
      const mine = rowsRef(rowsOfEstimate.get(e.id) ?? []);
      items.push({
        kind: "estimate", id: e.id, ref: e.ref, name: e.name, template_name: e.template_name, status: e.status, cost_total: e.cost_total, price: e.price, currency: e.currency,
        updated_at: e.updated_at, rows: mine, linked_rows: e.linked_boq_lines, stale_links: e.stale_links, missing_count: e.missing_count,
        stale_link_ids: est.links.filter((l) => l.estimate_id === e.id && l.stale).map((l) => l.id),
        state: estimateState({ status: e.status, stale_links: e.stale_links, missing_count: e.missing_count, linked_rows: e.linked_boq_lines }),
        rfqs: rfqsOfEstimate.get(e.id) ?? [], locked: !!e.standard_quote_id,
      });
    }
  }
  items.push(...rfqItems);
  items.sort((x, y) => String(y.kind === "estimate" ? y.updated_at : y.created_at).localeCompare(String(x.kind === "estimate" ? x.updated_at : x.created_at)));

  const boq = summarise(rows);
  const out = rfqItems.filter((x) => rfqIsOut(x.status));

  // Templates for "New estimate"
  let templates: { id: string; name: string }[] = [];
  if (r.estimates?.canCreate) {
    const t = await admin.from("estimate_templates").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(200);
    templates = ((t.error ? [] : t.data ?? []) as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name }));
  }

  // The deal's lines as RFQ starting lines (unpriced ones ticked, lines already on an RFQ named and unticked).
  let rfqLines: CostingData["rfq_lines"] = [];
  if (r.rfqs?.canEdit && !pendingRfqs) {
    const linked = await rfqLineStatuses(admin, tenantId, lines.map((l) => (l as { rfq_line_id?: string | null }).rfq_line_id ?? "").filter(Boolean));
    const order = new Map(rows.map((x, i) => [x.line_id, i]));
    const ordered = [...lines].filter((l) => order.has(l.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    rfqLines = tenderRfqLines(ordered, (rl) => linked[rl]?.ref ?? null);
  }

  return {
    pending_estimates: pendingEstimates, pending_rfqs: pendingRfqs, estimates_on: !!r.estimates, rfqs_on: !!r.rfqs,
    can_edit: r.canEditDeal, can_create_estimate: !!r.estimates?.canCreate && r.canEditDeal, can_award: !!r.rfqs?.canEdit && r.canEditDeal,
    items, boq,
    tiles: { priced: boq.priced, unpriced: boq.unpriced, rfqs_out: out.length, replies_in: out.reduce((s, x) => s + x.suppliers_replied, 0) },
    templates, rfq_lines: rfqLines, rfq_origin_label: `Deal ${opp.ref ?? opp.title}`,
    markup_default: tenderMarkupDefault(config as Parameters<typeof tenderMarkupDefault>[0]),
    currency: String((config as { currency?: unknown }).currency ?? opp.currency ?? ""), today, stage: opp.stage, bid_locked: bidIsLocked(opp.stage),
  };
}

async function rfqItemsFor(
  r: CostingRequest, heads: readonly RfqHead[],
  ctx: { rows: readonly BoqRowLite[]; itemOfLine: Map<string, string>; rowsOfEstimate: Map<string, string[]>; today: string; staleDays: number; lines: readonly unknown[] },
): Promise<CostingRfqItem[]> {
  if (heads.length === 0) return [];
  const { admin, tenantId } = r;
  const ids = heads.map((h) => h.id);
  type L = { id: string; rfq_id: string; qty: number | null; status: string; awarded_unit_cost: number | null };
  type S = { id: string; rfq_id: string; status: string };
  const lineRows: L[] = [];
  const supRows: S[] = [];
  for (const part of chunks(ids, 100)) {
    const [l, s] = await Promise.all([
      admin.from("rfq_lines").select("id, rfq_id, qty, status, awarded_unit_cost").eq("tenant_id", tenantId).in("rfq_id", part).limit(5000),
      admin.from("rfq_suppliers").select("id, rfq_id, status").eq("tenant_id", tenantId).in("rfq_id", part).limit(2000),
    ]);
    lineRows.push(...((l.data ?? []) as unknown as L[]).map((x) => ({ ...x, qty: num(x.qty), awarded_unit_cost: num(x.awarded_unit_cost) })));
    supRows.push(...((s.data ?? []) as unknown as S[]));
  }
  const respRows: (CompareResponse & { rfq_supplier_id: string })[] = [];
  const liveSupplier = supRows.filter((s) => s.status !== "cancelled");
  for (const part of chunks(liveSupplier.map((s) => s.id), 100)) {
    const { data } = await admin.from("rfq_responses").select("id, rfq_supplier_id, rfq_line_id, status, unit_price, fx_rate, currency, valid_until, submitted_at, lead_time_days, moq, note")
      .eq("tenant_id", tenantId).in("rfq_supplier_id", part).limit(5000);
    respRows.push(...((data ?? []) as unknown as (CompareResponse & { rfq_supplier_id: string })[]).map((x) => ({ ...x, unit_price: num(x.unit_price), fx_rate: num(x.fx_rate), moq: num(x.moq) })));
  }
  const awardsByRfq = new Map<string, number>();
  {
    const { data, error } = await admin.from("rfq_line_awards").select("rfq_id, rfq_line_id, applied_to_deal_at").eq("tenant_id", tenantId).in("rfq_id", ids).is("superseded_at", null).limit(5000);
    if (!error) for (const a of (data ?? []) as { rfq_id: string; applied_to_deal_at: string | null }[]) if (!a.applied_to_deal_at) awardsByRfq.set(a.rfq_id, (awardsByRfq.get(a.rfq_id) ?? 0) + 1);
  }
  // deal line per RFQ line (the line that asked): the item numbers an RFQ prices
  const askedBy = new Map<string, string[]>();
  for (const l of ctx.lines as { id: string; rfq_line_id?: string | null }[]) if (l.rfq_line_id) askedBy.set(l.rfq_line_id, [...(askedBy.get(l.rfq_line_id) ?? []), l.id]);

  const supOf = new Map<string, S[]>();
  for (const s of supRows) supOf.set(s.rfq_id, [...(supOf.get(s.rfq_id) ?? []), s]);
  const out: CostingRfqItem[] = [];
  for (const h of heads) {
    const lines = lineRows.filter((l) => l.rfq_id === h.id && l.status !== "cancelled");
    const sups = (supOf.get(h.id) ?? []).filter((s) => s.status !== "cancelled" && s.status !== "pending");
    const supIds = new Set((supOf.get(h.id) ?? []).filter((s) => s.status !== "cancelled").map((s) => s.id));
    const resp = respRows.filter((x) => supIds.has(x.rfq_supplier_id));
    const { valid } = lowestByLine(resp, ctx.today, ctx.staleDays);
    let total = 0, counted = 0, allAwarded = true;
    for (const l of lines) {
      const q = l.qty != null && l.qty > 0 ? l.qty : 1;
      if (l.status === "awarded" && l.awarded_unit_cost != null) { total += l.awarded_unit_cost * q; counted++; continue; }
      allAwarded = false;
      const best = valid.get(l.id);
      if (best) { total += best.landed * q; counted++; }
    }
    const isDeal = h.origin_type === "opportunity";
    const rowItems = isDeal
      ? lines.flatMap((l) => (askedBy.get(l.id) ?? []).map((dealLine) => ctx.itemOfLine.get(dealLine) ?? "")).filter(Boolean)
      : ctx.rowsOfEstimate.get(h.origin_id ?? "") ?? [];
    const linesAwarded = lines.filter((l) => l.status === "awarded").length;
    const replied = sups.filter((s) => s.status === "replied" || s.status === "declined").length;
    out.push({
      kind: "rfq", id: h.id, ref: h.ref, title: h.title, status: h.status, created_at: h.created_at, respond_by: h.respond_by,
      origin: isDeal ? "deal" : "estimate", origin_label: h.origin_label,
      rows: rowsRef(rowItems), suppliers_total: sups.length, suppliers_replied: replied, lines_total: lines.length, lines_awarded: linesAwarded,
      total: counted > 0 ? roundMoney(total) : null, total_is_awarded: counted > 0 && allAwarded,
      state: rfqState({ status: h.status, suppliers_total: sups.length, suppliers_replied: replied, lines_total: lines.length, lines_awarded: linesAwarded }),
      awarded_unpriced: isDeal ? awardsByRfq.get(h.id) ?? 0 : 0,
    });
  }
  return out;
}

// ── An RFQ of this deal ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The RFQ, when it belongs to this deal (raised from it, or from one of its estimates). Anything else, in this workspace or another, is null. */
export async function loadDealRfq(r: Pick<CostingRequest, "admin" | "tenantId" | "opp">, rfqId: unknown): Promise<{ rfq: Rfq; origin: "deal" | "estimate" } | null> {
  if (!isUuid(rfqId)) return null;
  const { data, error } = await r.admin.from("rfqs").select("*").eq("id", rfqId).eq("tenant_id", r.tenantId).maybeSingle();
  if (error || !data) return null;
  const rfq = data as unknown as Rfq;
  if (rfq.origin_type === "opportunity" && rfq.origin_id === r.opp.id) return { rfq, origin: "deal" };
  if (rfq.origin_type === "estimate" && rfq.origin_id && (await loadDealEstimate(r.admin, r.tenantId, r.opp.id, rfq.origin_id))) return { rfq, origin: "estimate" };
  return null;
}

export async function buildCompareView(r: CostingRequest, rfqId: string): Promise<CompareView | null> {
  const { admin, tenantId, opp } = r;
  const found = await loadDealRfq(r, rfqId);
  if (!found) return null;
  const b = await loadRfqBundle(admin, tenantId, rfqId, { messages: false });
  if (!b) return null;
  const [config, today] = [await loadConfig(admin, tenantId), await tenantToday(tenantId)];
  const cfg = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq);
  const validity = priceValidityDays(config as Parameters<typeof priceValidityDays>[0]);
  const { rows } = await loadRows(admin, tenantId, opp.id, validity, today);
  const itemOfLine = new Map(rows.map((x) => [x.line_id, x.item]));
  const dealLines = found.origin === "deal" ? await loadOpportunityLines(admin, tenantId, opp.id) : [];
  const askedBy = new Map<string, string[]>();
  for (const l of dealLines) {
    const rl = (l as { rfq_line_id?: string | null }).rfq_line_id;
    if (rl) askedBy.set(rl, [...(askedBy.get(rl) ?? []), itemOfLine.get(l.id) ?? l.sl_no ?? ""]);
  }
  const awardState = await loadCurrentAwards(admin, tenantId, rfqId).catch(() => ({ rows: [], pending: true }));
  const names = await loadActorNames(admin, tenantId, awardState.rows.map((a) => a.chosen_by));
  const status = found.rfq.status;
  return {
    rfq: { id: found.rfq.id, ref: found.rfq.ref, title: found.rfq.title, status, respond_by: found.rfq.respond_by, origin: found.origin },
    lines: b.lines.filter((l) => l.status !== "cancelled").map((l) => ({
      id: l.id, sl_no: l.sl_no, description: l.description, uom: l.uom, qty: l.qty, status: l.status, awarded_unit_cost: l.awarded_unit_cost, rows: (askedBy.get(l.id) ?? []).filter(Boolean),
    })),
    // Only what the screen draws: never the reply link, the token or an email address.
    suppliers: b.suppliers.filter((s) => s.status !== "cancelled").map((s) => ({
      id: s.id, supplier_id: s.supplier_id, name: s.suppliers?.name ?? "Supplier", status: s.status, currency: s.currency, incoterm: s.incoterm,
      reminder_count: s.reminder_count, last_reminded_at: s.last_reminded_at,
    })),
    responses: b.responses.map((x) => ({
      id: x.id, rfq_supplier_id: x.rfq_supplier_id, rfq_line_id: x.rfq_line_id, status: x.status, unit_price: x.unit_price, fx_rate: x.fx_rate, currency: x.currency,
      lead_time_days: x.lead_time_days, moq: x.moq, valid_until: x.valid_until, note: x.note, submitted_at: x.submitted_at, is_awarded: x.is_awarded, offered_description: x.offered_description,
    })),
    awards: awardState.rows.map((a) => ({
      id: a.id, rfq_line_id: a.rfq_line_id, rfq_supplier_id: a.rfq_supplier_id, response_id: a.response_id, chosen_at: a.chosen_at,
      chosen_by_name: a.chosen_by ? names.get(a.chosen_by) ?? null : null, reason: a.reason, not_lowest: a.not_lowest, landed_unit: a.landed_unit,
      applied_to_deal_at: a.applied_to_deal_at, applied_rate: a.applied_rate,
    })),
    awards_pending: awardState.pending, today, stale_days: cfg.price_valid_days, max_reminders: cfg.max_reminders,
    tenant_currency: String((config as { currency?: unknown }).currency ?? opp.currency ?? "INR"),
    markup_default: tenderMarkupDefault(config as Parameters<typeof tenderMarkupDefault>[0]),
    can_award: !!r.rfqs?.canEdit && r.canEditDeal && !["draft", "cancelled", "closed"].includes(status) && !awardState.pending,
    bid_locked: bidIsLocked(opp.stage), prices_rows: found.origin === "deal",
  };
}

// ── Award and price ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type AwardBody = {
  rfq_id?: unknown; line_id?: unknown; response_id?: unknown; rfq_supplier_id?: unknown; all?: unknown; fx_rate?: unknown; reason?: unknown;
  replace?: unknown; markup_pct?: unknown;
  /** Write the cost, markup and source of awards already standing (awarded elsewhere, or a write that failed) without awarding again. */
  apply_only?: unknown;
};

export type PricedRow = { rfq_line_id: string; item: string; from: number; to: number; cost: number; markup_pct: number };
export type AwardAndPriceResult = {
  ok: true; results: AwardOutcome[]; priced: PricedRow[]; skipped: { rfq_line_id: string; reason: string }[]; markup_pct: number | null; bid_locked: boolean;
};

export async function awardAndPrice(r: CostingRequest, body: AwardBody): Promise<AwardAndPriceResult | ({ ok: false } & Failure)> {
  if (!r.rfqs?.canEdit) return { ok: false, status: 403, error: "You can view RFQs but not award them" };
  if (!r.canEditDeal) return { ok: false, status: 403, error: "You can view this deal but not change it" };
  const { admin, tenantId, opp } = r;
  const found = await loadDealRfq(r, body.rfq_id);
  if (!found) return { ok: false, status: 404, error: "RFQ not found" };
  const { rfq } = found;
  if (["cancelled", "closed", "draft"].includes(rfq.status)) return { ok: false, status: 409, error: rfq.status === "draft" ? "Send the RFQ before awarding." : "This RFQ is closed." };

  const config = await loadConfig(admin, tenantId);
  const cfg = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq);
  const requested = body.markup_pct === undefined || body.markup_pct === null || body.markup_pct === "" ? null : parseMarkup(body.markup_pct);
  if (body.markup_pct !== undefined && body.markup_pct !== null && body.markup_pct !== "" && requested === null) return { ok: false, status: 422, error: "Markup must be a number from 0 to 1000." };
  const fallback = tenderMarkupDefault(config as Parameters<typeof tenderMarkupDefault>[0]);
  const user = await getAuthUser();
  const ctx = { tenantId, userId: r.userId, email: user?.email ?? null };
  const today = await tenantToday(tenantId);

  // Which RFQ lines
  let targets: AwardTarget[] = [];
  let lineIds: string[] = [];
  if (body.apply_only === true) {
    const cur = await loadCurrentAwards(admin, tenantId, rfq.id);
    if (cur.pending) return { ok: false, status: 503, error: "Recording an award needs the database update (migration 0224). Ask your administrator to apply it." };
    const only = body.line_id === undefined ? null : isUuid(body.line_id) ? String(body.line_id) : "";
    lineIds = cur.rows.filter((a) => !a.applied_to_deal_at && (only === null || a.rfq_line_id === only)).map((a) => a.rfq_line_id);
    if (only === "") lineIds = [];
    if (!lineIds.length) return { ok: false, status: 422, error: "There is no awarded price waiting to be written onto a row." };
  } else if (body.all === true && body.rfq_supplier_id !== undefined) {
    if (!isUuid(body.rfq_supplier_id)) return { ok: false, status: 404, error: "Supplier not on this RFQ" };
    const { data: rs } = await admin.from("rfq_suppliers").select("id").eq("id", body.rfq_supplier_id as string).eq("tenant_id", tenantId).eq("rfq_id", rfq.id).maybeSingle();
    if (!rs) return { ok: false, status: 404, error: "Supplier not on this RFQ" };
    const { data: resps } = await admin.from("rfq_responses").select("id, rfq_line_id, status, unit_price").eq("tenant_id", tenantId).eq("rfq_supplier_id", rs.id as string);
    const priced = ((resps ?? []) as { id: string; rfq_line_id: string; status: string; unit_price: number | null }[]).filter((x) => x.status !== "no_quote" && x.unit_price !== null);
    if (!priced.length) return { ok: false, status: 422, error: "That supplier hasn't quoted any line." };
    targets = priced.map((x) => ({ lineId: x.rfq_line_id, responseId: x.id }));
  } else {
    if (!isUuid(body.line_id)) return { ok: false, status: 422, error: "line_id is required" };
    targets = [{ lineId: body.line_id as string, responseId: isUuid(body.response_id) ? (body.response_id as string) : null }];
    // A response id that is not a uuid is not "no award": it is a bad request. (null/undefined is the old "no award" shape; the screen does not use it.)
    if (body.response_id !== undefined && body.response_id !== null && !isUuid(body.response_id)) return { ok: false, status: 404, error: "Response not found on this line" };
    if (targets[0].responseId === null) return { ok: false, status: 422, error: "Choose the supplier's answer to award." };
  }

  let results: AwardOutcome[] = [];
  if (body.apply_only !== true) {
    try {
      results = await awardWithDecision(admin, ctx, { rfq, targets, reason: body.reason, replace: body.replace === true, fxRate: body.fx_rate, staleDays: cfg.price_valid_days });
    } catch (e) {
      if (e instanceof AwardError) return { ok: false, status: e.status, error: e.message, extra: e.extra };
      throw e;
    }
    lineIds = results.filter((x) => x.status === "awarded").map((x) => x.line_id);
  }

  // The price goes onto the BOQ rows. Only for an RFQ raised from the deal: an estimate RFQ's award already went into the estimate line
  // and re-priced the rows that estimate prices (writeAwardedCostToEstimate), so there is nothing to write twice.
  let priced: PricedRow[] = [];
  let skipped: { rfq_line_id: string; reason: string }[] = [];
  if (found.origin === "deal" && lineIds.length > 0) {
    try {
      const w = await priceAwardedRows(r, { rfq, lineIds, requested, fallback, today, rfqStaleDays: cfg.price_valid_days, validityDays: priceValidityDays(config as Parameters<typeof priceValidityDays>[0]), email: ctx.email });
      priced = w.priced; skipped = w.skipped;
    } catch (e) {
      skipped = lineIds.map((id) => ({ rfq_line_id: id, reason: e instanceof Error ? e.message : "The BOQ row could not be priced" }));
    }
  }
  return { ok: true, results, priced, skipped, markup_pct: requested, bid_locked: bidIsLocked(opp.stage) };
}

/**
 * Writes the standing award of each RFQ line onto the deal line that asked and its BOQ row: the supplier's landed price as the COST, the
 * markup on top as the rate, the source "RFQ-0012, awarded", the date the supplier gave the price (so the 180 day clock runs from the
 * answer), and the award marked as written. Every id is read back through the workspace and the deal.
 */
async function priceAwardedRows(r: CostingRequest, a: {
  rfq: Pick<Rfq, "id" | "ref">; lineIds: string[]; requested: number | null; fallback: number; today: string; rfqStaleDays: number; validityDays: number; email: string | null;
}): Promise<{ priced: PricedRow[]; skipped: { rfq_line_id: string; reason: string }[] }> {
  const { admin, tenantId, opp } = r;
  const skipped: { rfq_line_id: string; reason: string }[] = [];
  const cur = await loadCurrentAwards(admin, tenantId, a.rfq.id);
  const awards = cur.rows.filter((x) => a.lineIds.includes(x.rfq_line_id));
  if (awards.length === 0) return { priced: [], skipped };

  const respIds = awards.map((x) => x.response_id);
  const { data: respData } = await admin.from("rfq_responses").select("id, submitted_at, valid_until").eq("tenant_id", tenantId).in("id", respIds);
  const resp = new Map(((respData ?? []) as { id: string; submitted_at: string; valid_until: string | null }[]).map((x) => [x.id, x]));

  const { data: dl } = await admin.from("opportunity_lines").select("id, sl_no, qty, rate, discount_pct, rfq_line_id").eq("tenant_id", tenantId).eq("opportunity_id", opp.id).in("rfq_line_id", awards.map((x) => x.rfq_line_id));
  const dealLines = (dl ?? []) as { id: string; sl_no: string | null; qty: number | string; rate: number | string; discount_pct: number | string | null; rfq_line_id: string }[];
  const boqRows = new Map<string, { id: string; item_no: string | null; row_no: number; markup_pct: number | null; price_source: string | null; removed: boolean }>();
  if (dealLines.length > 0) {
    const { data: bq, error } = await admin.from("tender_boq_lines").select("id, line_id, item_no, row_no, markup_pct, price_source, removed_in_revision").eq("tenant_id", tenantId).eq("opportunity_id", opp.id).in("line_id", dealLines.map((x) => x.id));
    if (!error) for (const b of (bq ?? []) as Record<string, unknown>[]) boqRows.set(String(b.line_id), { id: String(b.id), item_no: (b.item_no as string | null) ?? null, row_no: Number(b.row_no ?? 0), markup_pct: num(b.markup_pct), price_source: (b.price_source as string | null) ?? null, removed: b.removed_in_revision === true });
    else if (!isMissingSchema(error)) throw new Error(error.message);
  }

  const priced: PricedRow[] = [];
  const now = new Date().toISOString();
  for (const award of awards) {
    const line = dealLines.find((x) => x.rfq_line_id === award.rfq_line_id);
    if (!line) { skipped.push({ rfq_line_id: award.rfq_line_id, reason: "No deal line asked about this RFQ line" }); continue; }
    if (award.landed_unit === null || !(award.landed_unit >= 0)) { skipped.push({ rfq_line_id: award.rfq_line_id, reason: "The award has no price" }); continue; }
    const boq = boqRows.get(line.id);
    if (boq?.removed) { skipped.push({ rfq_line_id: award.rfq_line_id, reason: "The BOQ row was removed in a revision" }); continue; }
    const answer = resp.get(award.response_id);
    const markup = awardMarkup({ requested: a.requested, rowMarkup: boq?.markup_pct, fallback: a.fallback });
    const f = awardedFields({
      cost: award.landed_unit, markupPct: markup, rfqRef: a.rfq.ref, answeredOn: answer?.submitted_at ? answer.submitted_at.slice(0, 10) : null,
      validity: answer ? responseValidity({ valid_until: answer.valid_until, submitted_at: answer.submitted_at }, a.today, a.rfqStaleDays) : "stale", today: a.today, validityDays: a.validityDays,
    });
    if (f.rate > 9_999_999_999.99) { skipped.push({ rfq_line_id: award.rfq_line_id, reason: "The rate is too large" }); continue; }
    const amount = lineAmount(Number(line.qty), f.rate, Number(line.discount_pct ?? 0));
    const up = await admin.from("opportunity_lines").update({ rate: f.rate, amount }).eq("id", line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    if (up.error) { skipped.push({ rfq_line_id: award.rfq_line_id, reason: up.error.message }); continue; }
    if (boq) {
      await admin.from("tender_boq_lines").update({
        price_source: f.price_source, price_source_ref: f.price_source_ref, price_as_of: f.price_as_of, stale_accepted: f.stale_accepted,
        unit_cost: f.unit_cost, markup_pct: f.markup_pct, priced_by: r.userId, priced_at: now, updated_at: now,
      }).eq("id", boq.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    }
    await admin.from("rfq_line_awards").update({ applied_to_deal_at: now, applied_by: r.userId, applied_rate: f.rate })
      .eq("tenant_id", tenantId).eq("rfq_id", a.rfq.id).eq("rfq_line_id", award.rfq_line_id).is("superseded_at", null);
    priced.push({ rfq_line_id: award.rfq_line_id, item: boq?.item_no ?? line.sl_no ?? "", from: Number(line.rate), to: f.rate, cost: f.unit_cost, markup_pct: f.markup_pct });
  }

  if (priced.length > 0) {
    const config = await loadConfig(admin, tenantId);
    await refreshOpportunityDerived(admin, tenantId, opp.id, opportunityStages(config as Parameters<typeof opportunityStages>[0]));
    // The history says the rate and where it came from; the cost and the markup are internal and are not written to it.
    await logChange(admin, {
      tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: r.userId, actorEmail: a.email,
      changes: priced.flatMap((p) => [
        { field: `BOQ rate ${p.item || "row"}`, from: p.from, to: p.to },
        { field: "BOQ rate source", from: null, to: awardSourceRef(a.rfq.ref) },
      ]),
    });
  }
  return { priced, skipped };
}
