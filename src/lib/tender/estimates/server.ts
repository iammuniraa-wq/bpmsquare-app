import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter } from "@/lib/permissions";
import { opportunityStages } from "@/lib/sales/opportunity";
import { refreshOpportunityDerived } from "@/lib/sales/opportunityServer";
import { rfqConfig } from "@/lib/rfq/types";
import { openTenderDealRequest, type TenderDealRequest } from "@/lib/tender/dealAccess";
import { isMissingSchema } from "@/lib/tender/server";
import { bundles, type BoqRequest } from "@/lib/tender/boq/server";
import { proposeByMatch, proposeSpread, type BoqInput, type Proposal, type ProposalBy } from "./allocate";
import {
  bidIsLocked, cleanShare, costPerUnit, isBasis, isLinkStale, isUuid, listOutputs, missingCosts, outputCost, overAllocated, parseOutput,
  prefillParams, rateFromCost, round2, sumPerUnit, buildUpName, buildUpNote, isRateBuildUp, quantityCheck, quantityView,
  type AllocationLink, type Basis, type EstLine, type MissingCost, type OutputCost, type QtyInputDef, type QuantityView,
} from "./rules";

// Server side of "estimates inside the tender flow" (migration 0227, slice 3c-1). Every query is tenant-scoped on the service-role
// client and tolerates the migration being pending (a missing table or column answers `pending`, never a crash). The only door is
// openEstimatesRequest(): flags gcc_tender + pipeline, the Pipeline view (edit to write), a tender deal of THIS workspace, the
// estimator module and the Estimates view. Any miss is the same 404, and a workspace without the edition reads no new table.
//
// Costs are recomputed here from the estimate as it is NOW. A request names an estimate, an output, a basis and a share; it never
// carries a cost.

export type EstimatesRequest = TenderDealRequest & { canCreateEstimates: boolean };
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };

export const PENDING_ESTIMATES = "Estimates inside a tender need a database update (migration 0227). Ask your administrator to apply it.";

export async function openEstimatesRequest(opportunityId: string, mode: "view" | "write" | "create"): Promise<{ ok: true; req: EstimatesRequest } | ({ ok: false } & Failure)> {
  const gate = await openTenderDealRequest(opportunityId, mode !== "view");
  if (!gate.ok) return gate;
  const { req } = gate;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  if (!(await tenantOwnsObject(req.tenantId, "estimates"))) return notFound;
  const perms = await resolvePermissions(req.supabase, req.tenantId, req.userId, req.role);
  if (!canViewWorkcenter(perms, "estimates")) return notFound;
  const canCreate = canCreateWorkcenter(perms, "estimates");
  if (mode === "create" && !canCreate) return { ok: false, status: 403, error: "You can view estimates but not create them" };
  return { ok: true, req: { ...req, canCreateEstimates: canCreate } };
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (s: unknown): string | null => (typeof s === "string" && s ? s.slice(0, 10) : null);
const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export type EstimateHead = {
  id: string; ref: string | null; name: string; status: string; template_id: string | null; template_name: string | null;
  currency: string | null; margin_pct: number; cost_total: number | null; price: number | null; standard_quote_id: string | null;
  opportunity_id: string | null; created_at: string; updated_at: string;
};

const HEAD_COLS = "id, ref, name, status, template_id, currency, margin_pct, totals, standard_quote_id, opportunity_id, created_at, updated_at";

function toHead(r: Record<string, unknown>): EstimateHead {
  const t = (r.totals ?? null) as { cost_total?: unknown; price?: unknown } | null;
  return {
    id: String(r.id), ref: (r.ref as string | null) ?? null, name: String(r.name ?? ""), status: String(r.status ?? "draft"),
    template_id: (r.template_id as string | null) ?? null, template_name: null, currency: (r.currency as string | null) ?? null,
    margin_pct: Number(r.margin_pct ?? 0), cost_total: num(t?.cost_total), price: num(t?.price), standard_quote_id: (r.standard_quote_id as string | null) ?? null,
    opportunity_id: (r.opportunity_id as string | null) ?? null, created_at: String(r.created_at ?? ""), updated_at: String(r.updated_at ?? ""),
  };
}

/** The estimates made for this deal, newest first. `pending` = migration 0227 has not run (no estimate can belong to a deal yet). */
export async function loadDealEstimates(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ rows: EstimateHead[]; pending: boolean }> {
  const { data, error } = await admin.from("estimates").select(HEAD_COLS).eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("created_at", { ascending: false }).limit(200);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toHead);
  const tplIds = [...new Set(rows.map((r) => r.template_id).filter((x): x is string => !!x))];
  if (tplIds.length > 0) {
    const t = await admin.from("estimate_templates").select("id, name").eq("tenant_id", tenantId).in("id", tplIds);
    const names = new Map(((t.error ? [] : t.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    for (const r of rows) r.template_name = r.template_id ? names.get(r.template_id) ?? null : null;
  }
  return { rows, pending: false };
}

/** One estimate of THIS deal. Null for an estimate of another deal, another workspace or none at all: the caller answers 404. */
export async function loadDealEstimate(admin: SupabaseClient, tenantId: string, oppId: string, estimateId: string): Promise<EstimateHead | null> {
  if (!isUuid(estimateId)) return null;
  const { data, error } = await admin.from("estimates").select(HEAD_COLS).eq("id", estimateId).eq("tenant_id", tenantId).eq("opportunity_id", oppId).maybeSingle();
  if (error || !data) return null;
  return toHead(data as Record<string, unknown>);
}

const LINE_COLS = "id, estimate_id, code, description, uom, qty, waste_pct, unit_cost, cost_total, component, wbs_code, product_id, custom_data, updated_at, sort_order";

export function toEstLine(r: Record<string, unknown>): EstLine {
  return {
    id: String(r.id), code: (r.code as string | null) ?? null, description: String(r.description ?? ""), uom: (r.uom as string | null) ?? null,
    qty: Number(r.qty ?? 0), waste_pct: Number(r.waste_pct ?? 0), unit_cost: num(r.unit_cost), cost_total: num(r.cost_total),
    component: (r.component as string | null) ?? null, wbs_code: (r.wbs_code as string | null) ?? null, product_id: (r.product_id as string | null) ?? null,
    custom_data: r.custom_data && typeof r.custom_data === "object" ? (r.custom_data as Record<string, unknown>) : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/** The lines of several estimates, tenant-scoped, paged past the 1000-row default. */
export async function loadLinesFor(admin: SupabaseClient, tenantId: string, estimateIds: readonly string[]): Promise<Map<string, EstLine[]>> {
  const out = new Map<string, EstLine[]>();
  for (const id of estimateIds) out.set(id, []);
  for (const part of chunks([...new Set(estimateIds)], 50)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("estimate_lines").select(LINE_COLS).eq("tenant_id", tenantId).in("estimate_id", part).order("sort_order").range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as Record<string, unknown>[]) out.get(String(r.estimate_id))?.push(toEstLine(r));
      if (data.length < 1000) break;
    }
  }
  return out;
}

async function loadConfig(admin: SupabaseClient, tenantId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  return ((data?.config ?? {}) as Record<string, unknown>) ?? {};
}

/** product id -> the date its cost was last confirmed (cost_price_as_of, 0113); empty when that column is not there yet. */
async function productCostDates(admin: SupabaseClient, tenantId: string, lines: readonly EstLine[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))];
  const out = new Map<string, string | null>();
  for (const part of chunks(ids, 100)) {
    const { data, error } = await admin.from("products").select("id, cost_price_as_of").eq("tenant_id", tenantId).in("id", part);
    if (error) return out;
    for (const r of (data ?? []) as { id: string; cost_price_as_of: string | null }[]) out.set(r.id, day(r.cost_price_as_of));
  }
  return out;
}

export type LinkRow = {
  id: string; boq_line_id: string; estimate_id: string; output: string; basis: Basis; share_pct: number;
  applied_cost: number | null; applied_at: string | null; estimate_updated_at: string | null; needs_review: boolean; review_note: string | null;
};
const LINK_COLS = "id, boq_line_id, estimate_id, output, basis, share_pct, applied_cost, applied_at, estimate_updated_at, needs_review, review_note";

function toLink(r: Record<string, unknown>): LinkRow {
  return {
    id: String(r.id), boq_line_id: String(r.boq_line_id), estimate_id: String(r.estimate_id), output: String(r.output),
    basis: r.basis === "per_unit" ? "per_unit" : "total", share_pct: Number(r.share_pct ?? 100), applied_cost: num(r.applied_cost),
    applied_at: typeof r.applied_at === "string" ? r.applied_at : null, estimate_updated_at: typeof r.estimate_updated_at === "string" ? r.estimate_updated_at : null,
    needs_review: r.needs_review === true, review_note: (r.review_note as string | null) ?? null,
  };
}

export async function loadLinks(admin: SupabaseClient, tenantId: string, oppId: string, onlyBoq?: readonly string[]): Promise<{ rows: LinkRow[]; pending: boolean }> {
  let q = admin.from("tender_boq_estimate_links").select(LINK_COLS).eq("tenant_id", tenantId).eq("opportunity_id", oppId).limit(10000);
  if (onlyBoq) q = q.in("boq_line_id", [...onlyBoq]);
  const { data, error } = await q;
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toLink), pending: false };
}

// ── Is the estimate made for the quantity the line is priced for? ────────────────────────────────────────────────────────

/**
 * For every link that divides a whole estimate by one BOQ line's quantity (a rate build-up), what the estimate's own inputs say it is
 * measured for, set against the BOQ line's quantity. Nothing is derived from the request and nothing is stored: it is read from the
 * estimate and its template as they are now, so a quantity the person changed afterwards is seen. `links` must be ALL the deal's
 * links (the rule needs to know no other BOQ line draws on the estimate). Anything that cannot be read answers "unknown", which asks
 * for a confirmation: a cost is never allowed to be silently wrong.
 */
export async function quantityChecks(admin: SupabaseClient, tenantId: string, oppId: string, links: readonly LinkRow[]): Promise<Map<string, QuantityView>> {
  const out = new Map<string, QuantityView>();
  const per = new Map<string, number>();
  for (const l of links) per.set(l.estimate_id, (per.get(l.estimate_id) ?? 0) + 1);
  const mine = links.filter((l) => isRateBuildUp(l, per.get(l.estimate_id) ?? 0));
  if (mine.length === 0) return out;

  const estimates = new Map<string, { template_id: string | null; params: Record<string, unknown> }>();
  for (const part of chunks([...new Set(mine.map((l) => l.estimate_id))], 100)) {
    const { data } = await admin.from("estimates").select("id, template_id, params").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", part);
    for (const r of (data ?? []) as { id: string; template_id: string | null; params: unknown }[]) {
      estimates.set(r.id, { template_id: r.template_id ?? null, params: r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {} });
    }
  }
  const templates = new Map<string, QtyInputDef[]>();
  for (const part of chunks([...new Set([...estimates.values()].map((e) => e.template_id).filter((x): x is string => !!x))], 100)) {
    const { data } = await admin.from("estimate_templates").select("id, inputs").eq("tenant_id", tenantId).in("id", part);
    for (const r of (data ?? []) as { id: string; inputs: unknown }[]) if (Array.isArray(r.inputs)) templates.set(r.id, r.inputs as QtyInputDef[]);
  }
  const boq = new Map<string, { line_id: string | null; uom: string | null; label: string }>();
  for (const part of chunks([...new Set(mine.map((l) => l.boq_line_id))], 100)) {
    const { data } = await admin.from("tender_boq_lines").select("id, line_id, item_no, row_no, file_description, file_uom").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", part);
    for (const r of (data ?? []) as { id: string; line_id: string | null; item_no: string | null; row_no: number; file_description: string; file_uom: string | null }[]) {
      boq.set(r.id, { line_id: r.line_id, uom: r.file_uom ?? null, label: itemLabel(r, r.file_description ?? "") });
    }
  }
  const deal = new Map<string, { qty: number; uom: string | null }>();
  for (const part of chunks([...new Set([...boq.values()].map((b) => b.line_id).filter((x): x is string => !!x))], 100)) {
    const { data } = await admin.from("opportunity_lines").select("id, qty, uom").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", part);
    for (const r of (data ?? []) as { id: string; qty: number | string; uom: string | null }[]) deal.set(r.id, { qty: Number(r.qty), uom: r.uom ?? null });
  }

  for (const l of mine) {
    const b = boq.get(l.boq_line_id);
    const line = b?.line_id ? deal.get(b.line_id) : undefined;
    if (!b || !line || !(line.qty > 0)) continue;
    const est = estimates.get(l.estimate_id);
    const check = quantityCheck({ inputs: est?.template_id ? templates.get(est.template_id) : null, params: est?.params, boqUnit: b.uom ?? line.uom, boqQty: line.qty });
    out.set(l.id, quantityView(check, !!l.applied_at, b.label));
  }
  return out;
}

// ── The screens' state ───────────────────────────────────────────────────────────────────────────────────────────────

export type EstimateListItem = EstimateHead & { line_count: number; missing_count: number; stale_links: number; linked_boq_lines: number };
export type LinkView = {
  id: string; boq_id: string; estimate_id: string; estimate_ref: string | null; estimate_name: string; output: string; output_label: string; basis: Basis; share_pct: number;
  applied_cost: number | null; waiting: boolean; stale: boolean; broken: boolean; needs_review: boolean; review_note: string | null;
  /** Only for a rate build-up: is the estimate made for the quantity of the line? Absent = nothing to say. */
  quantity?: QuantityView | null;
};
export type EstimatesState = {
  pending: boolean;
  estimates: EstimateListItem[];
  links: LinkView[];
  today: string;
  valid_days: number;
  bid_locked: boolean;
  stage: string;
};

/** Everything the Estimates tab and the BOQ Prices tab show about the deal's estimates. */
export async function buildEstimatesState(r: Pick<EstimatesRequest, "admin" | "tenantId" | "opp">): Promise<EstimatesState> {
  const { admin, tenantId, opp } = r;
  const [heads, links, config, today] = await Promise.all([loadDealEstimates(admin, tenantId, opp.id), loadLinks(admin, tenantId, opp.id), loadConfig(admin, tenantId), tenantToday(tenantId)]);
  const validDays = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq).price_valid_days;
  const base = { today, valid_days: validDays, bid_locked: bidIsLocked(opp.stage), stage: opp.stage };
  if (heads.pending || links.pending && heads.rows.length === 0) return { pending: heads.pending, estimates: [], links: [], ...base };

  const lines = await loadLinesFor(admin, tenantId, heads.rows.map((e) => e.id));
  const dates = await productCostDates(admin, tenantId, [...lines.values()].flat());
  const byId = new Map(heads.rows.map((e) => [e.id, e]));
  const qtyOf = await boqQuantities(admin, tenantId, opp.id, [...new Set(links.rows.map((l) => l.boq_line_id))]);
  const quantities = await quantityChecks(admin, tenantId, opp.id, links.rows);

  const linkViews: LinkView[] = links.rows.map((l) => {
    const e = byId.get(l.estimate_id);
    const out = e ? outputCost(parseOutput(l.output) ?? { kind: "total" }, lines.get(l.estimate_id) ?? [], e.cost_total) : null;
    const parsed = parseOutput(l.output);
    // Out of date for either reason: the estimate was saved after the figures were applied, or the BOQ quantity moved (a revised file)
    // so the same cost now works out to another cost per unit.
    const qty = qtyOf.get(l.boq_line_id);
    const now = out && qty != null ? costPerUnit({ basis: l.basis, out, boqQty: qty, sharePct: l.share_pct }) : null;
    const moved = !!l.applied_at && l.applied_cost != null && !!now && now.ok && Math.abs(now.perUnit - l.applied_cost) > 0.00005;
    return {
      id: l.id, boq_id: l.boq_line_id, estimate_id: l.estimate_id, estimate_ref: e?.ref ?? null, estimate_name: e?.name ?? "Estimate removed",
      output: l.output, output_label: out?.label ?? (parsed ? l.output : "Unknown output"), basis: l.basis, share_pct: l.share_pct, applied_cost: l.applied_cost,
      waiting: !l.applied_at, stale: (!!e && isLinkStale(l, e.updated_at)) || moved, broken: !e || !out, needs_review: l.needs_review, review_note: l.review_note,
      quantity: quantities.get(l.id) ?? null,
    };
  });
  const estimates: EstimateListItem[] = heads.rows.map((e) => {
    const ls = lines.get(e.id) ?? [];
    const mine = linkViews.filter((l) => l.estimate_id === e.id);
    return {
      ...e, line_count: ls.length, missing_count: missingCosts(ls, today, validDays, dates).length,
      stale_links: mine.filter((l) => l.stale).length, linked_boq_lines: new Set(mine.map((l) => l.boq_id)).size,
    };
  });
  return { pending: false, estimates, links: linkViews, ...base };
}

/** BOQ row id -> the quantity of its deal line now (what a "total" basis spreads the cost over). */
async function boqQuantities(admin: SupabaseClient, tenantId: string, oppId: string, boqIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (boqIds.length === 0) return out;
  const lineOf = new Map<string, string>();
  for (const part of chunks(boqIds, 100)) {
    const { data } = await admin.from("tender_boq_lines").select("id, line_id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", part);
    for (const r of (data ?? []) as { id: string; line_id: string | null }[]) if (r.line_id) lineOf.set(r.id, r.line_id);
  }
  const qty = new Map<string, number>();
  for (const part of chunks([...new Set(lineOf.values())], 100)) {
    const { data } = await admin.from("opportunity_lines").select("id, qty").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", part);
    for (const r of (data ?? []) as { id: string; qty: number | string }[]) qty.set(r.id, Number(r.qty));
  }
  for (const [boq, line] of lineOf) if (qty.has(line)) out.set(boq, qty.get(line)!);
  return out;
}

export type OutputPreview = OutputCost & { per_unit_total: number | null; per_unit_line: number | null; reason: string | null };

/** The outputs one estimate offers a BOQ line, each with the cost per unit it would give at a 100 percent share on each basis. */
export async function previewOutputs(r: Pick<EstimatesRequest, "admin" | "tenantId" | "opp">, estimateId: string, boqQty: number): Promise<{ ok: true; estimate: EstimateHead; outputs: OutputPreview[] } | ({ ok: false } & Failure)> {
  const est = await loadDealEstimate(r.admin, r.tenantId, r.opp.id, estimateId);
  if (!est) return { ok: false, status: 404, error: "Estimate not found" };
  const lines = (await loadLinesFor(r.admin, r.tenantId, [est.id])).get(est.id) ?? [];
  const outputs = listOutputs(lines, est.cost_total).map((o): OutputPreview => {
    const total = costPerUnit({ basis: "total", out: o, boqQty, sharePct: 100 });
    const per = costPerUnit({ basis: "per_unit", out: o, boqQty, sharePct: 100 });
    return { ...o, per_unit_total: total.ok ? total.perUnit : null, per_unit_line: per.ok ? per.perUnit : null, reason: total.ok ? null : total.reason };
  });
  return { ok: true, estimate: est, outputs };
}

// ── Pricing a BOQ line from its links ────────────────────────────────────────────────────────────────────────────────

/** What the pricing needs of a request: the same for a person at the BOQ tab and for the award hook acting for the buyer. */
export type PricingCtx = Pick<EstimatesRequest, "admin" | "tenantId" | "userId" | "opp"> & { email?: string | null };

export type RepriceOpts = {
  markup?: number | null; markReview?: boolean; reviewNote?: string | null;
  /**
   * The caller has dealt with the quantity check itself: a person confirmed it (repriceRequest), or chose the part and saw the cost per
   * unit before saving (applyLinks). Without it, a rate build-up that has not been used yet and is not known to be made for the line's
   * quantity is not priced (an award must never price one silently).
   */
  skipQuantityGuard?: boolean;
};
export type RepriceResult = {
  repriced: { boq_id: string; item: string; from_rate: number; to_rate: number; cost: number }[];
  failed: { boq_id: string; item: string; reason: string }[];
};

const itemLabel = (b: { item_no: string | null; row_no: number }, desc: string) => `${b.item_no ?? `row ${b.row_no}`} ${desc}`.trim().slice(0, 80);
const cleanMarkup = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1000, v)) : null);
const MAX_RATE = 9_999_999_999.99;

/**
 * Prices BOQ lines from ALL their estimate links: each link's cost per unit is recomputed from the estimate as it is now, the line's
 * cost is their sum, and the rate is that cost plus the markup (the BOQ row's own markup unless one is given). Lines whose links cannot
 * be read keep their rate and are reported. Writes the deal line, the BOQ row and the links.
 */
export async function repriceBoqLines(r: PricingCtx, boqIds: readonly string[], opts: RepriceOpts = {}): Promise<RepriceResult> {
  const { admin, tenantId, userId, opp } = r;
  const result: RepriceResult = { repriced: [], failed: [] };
  if (boqIds.length === 0) return result;
  const wanted = new Set(boqIds);
  const [{ rows: dealLinks }, b, config, today] = await Promise.all([
    loadLinks(admin, tenantId, opp.id),
    bundles({ ...r, supabase: admin, role: "member" } as unknown as BoqRequest),
    loadConfig(admin, tenantId), tenantToday(tenantId),
  ]);
  if (!b) return result;
  const allLinks = dealLinks.filter((l) => wanted.has(l.boq_line_id));
  const quantities = opts.skipQuantityGuard ? new Map<string, QuantityView>() : await quantityChecks(admin, tenantId, opp.id, dealLinks);
  const items = b.items.filter((x) => wanted.has(x.boq.id));
  const estimateIds = [...new Set(allLinks.map((l) => l.estimate_id))];
  const heads = new Map<string, EstimateHead>();
  for (const id of estimateIds) { const h = await loadDealEstimate(admin, tenantId, opp.id, id); if (h) heads.set(id, h); }
  const lines = await loadLinesFor(admin, tenantId, [...heads.keys()]);

  const now = new Date().toISOString();
  const stages = opportunityStages(config as Parameters<typeof opportunityStages>[0]);
  const user = await getAuthUser();
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  let wrote = 0;

  for (const { boq, line } of items) {
    const mine = allLinks.filter((l) => l.boq_line_id === boq.id);
    const label = itemLabel(boq, line.description);
    if (mine.length === 0) continue;
    const unconfirmed = mine.map((l) => quantities.get(l.id)).find((q) => q?.needs_confirm);
    if (unconfirmed) { result.failed.push({ boq_id: boq.id, item: label, reason: unconfirmed.note ?? "The quantity of the estimate has not been confirmed" }); continue; }
    const qty = Number(line.qty);
    const parts: { link: LinkRow; perUnit: number; est: EstimateHead }[] = [];
    let problem: string | null = null;
    for (const l of mine) {
      const est = heads.get(l.estimate_id);
      const ref = parseOutput(l.output);
      if (!est || !ref) { problem = "An estimate this line was priced from is no longer on the deal"; break; }
      const out = outputCost(ref, lines.get(est.id) ?? [], est.cost_total);
      if (!out) { problem = `${est.ref ?? est.name}: that part of the estimate is gone`; break; }
      const pu = costPerUnit({ basis: l.basis, out, boqQty: qty, sharePct: l.share_pct });
      if (!pu.ok) { problem = `${est.ref ?? est.name}: ${pu.reason}`; break; }
      parts.push({ link: l, perUnit: pu.perUnit, est });
    }
    if (problem || parts.length === 0) { result.failed.push({ boq_id: boq.id, item: label, reason: problem ?? "No cost found" }); continue; }

    const cost = sumPerUnit(parts.map((p) => p.perUnit));
    const markup = opts.markup ?? boq.markup_pct ?? 0;
    const rate = rateFromCost(cost, markup);
    if (rate > MAX_RATE) { result.failed.push({ boq_id: boq.id, item: label, reason: "The rate is too large" }); continue; }
    const amount = round2(qty * rate * (1 - Number(line.discount_pct ?? 0) / 100));
    const refs = [...new Set(parts.map((p) => p.est.ref ?? p.est.name))];

    const lineUp = await admin.from("opportunity_lines").update({ rate, amount }).eq("id", line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    if (lineUp.error) { result.failed.push({ boq_id: boq.id, item: label, reason: lineUp.error.message }); continue; }
    await admin.from("tender_boq_lines").update({
      price_source: "estimate", price_source_ref: `${refs[0]}${refs.length > 1 ? ` +${refs.length - 1}` : ""}`.slice(0, 200), price_as_of: today, stale_accepted: false,
      unit_cost: cost, markup_pct: markup, priced_by: userId, priced_at: now, updated_at: now,
    }).eq("id", boq.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    for (const p of parts) {
      await admin.from("tender_boq_estimate_links").update({
        applied_cost: p.perUnit, applied_at: now, estimate_updated_at: p.est.updated_at, needs_review: opts.markReview === true,
        review_note: opts.markReview ? (opts.reviewNote ?? null) : null, updated_at: now,
      }).eq("id", p.link.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    }
    wrote++;
    result.repriced.push({ boq_id: boq.id, item: label, from_rate: Number(line.rate), to_rate: rate, cost });
    changes.push({ field: `BOQ rate ${boq.item_no ?? `row ${boq.row_no}`}`, from: Number(line.rate), to: rate }, { field: "BOQ rate source", from: boq.price_source, to: `estimate ${refs.join(", ")}` });
  }

  if (wrote > 0) {
    await refreshOpportunityDerived(admin, tenantId, opp.id, stages);
    await logChange(admin, {
      tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
      actorId: user?.id ?? userId, actorEmail: user?.email ?? r.email ?? null, changes: changes.slice(0, 40),
    });
  }
  return result;
}

// ── Making and removing links ────────────────────────────────────────────────────────────────────────────────────────

export type LinkRequest = { boq_id: string; estimate_id: string; output: string; basis: Basis; share_pct: number };

export type ApplyResult = ({ ok: true } & RepriceResult & { linked: number }) | ({ ok: false } & Failure);

/**
 * Link BOQ lines to estimate outputs and price them, all or nothing: every id is checked against THIS workspace and deal, every output
 * must exist, every cost must compute, and no output may be given out above 100 percent, before the first row is written.
 */
export async function applyLinks(r: EstimatesRequest, items: readonly unknown[], opts: { markup?: unknown } = {}): Promise<ApplyResult> {
  const { admin, tenantId, opp, userId } = r;
  if (items.length === 0) return { ok: false, status: 422, error: "Nothing to link" };
  if (items.length > 2000) return { ok: false, status: 422, error: "At most 2000 lines in one step" };

  const clean: LinkRequest[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const share = cleanShare(x.share_pct ?? 100);
    const out = parseOutput(x.output);
    if (!isUuid(x.boq_id) || !isUuid(x.estimate_id) || !out || !isBasis(x.basis ?? "total") || share === null) return { ok: false, status: 422, error: "A link is missing its line, estimate, output, basis or share" };
    const key = `${x.boq_id}|${x.estimate_id}|${typeof x.output === "string" ? (x.output as string).toLowerCase() : ""}`;
    if (seen.has(key)) return { ok: false, status: 422, error: "The same line, estimate and output are listed twice" };
    seen.add(key);
    clean.push({ boq_id: (x.boq_id as string).toLowerCase(), estimate_id: (x.estimate_id as string).toLowerCase(), output: out.kind === "line" ? `line:${out.id}` : out.kind === "wbs" ? `wbs:${out.code}` : "total", basis: (x.basis ?? "total") as Basis, share_pct: share });
  }

  const b = await bundles(r as unknown as BoqRequest);
  if (!b) return { ok: false, status: 404, error: "Upload a BOQ first" };
  const byBoq = new Map(b.items.map((i) => [i.boq.id, i]));
  for (const c of clean) if (!byBoq.has(c.boq_id)) return { ok: false, status: 404, error: "Line not found" };

  const estimateIds = [...new Set(clean.map((c) => c.estimate_id))];
  const heads = new Map<string, EstimateHead>();
  for (const id of estimateIds) {
    const h = await loadDealEstimate(admin, tenantId, opp.id, id);
    if (!h) return { ok: false, status: 404, error: "Estimate not found" };
    heads.set(id, h);
  }
  const lines = await loadLinesFor(admin, tenantId, estimateIds);

  for (const c of clean) {
    const est = heads.get(c.estimate_id)!;
    const out = outputCost(parseOutput(c.output)!, lines.get(est.id) ?? [], est.cost_total);
    if (!out) return { ok: false, status: 422, error: `${est.ref ?? est.name}: that part of the estimate does not exist` };
    const pu = costPerUnit({ basis: c.basis, out, boqQty: Number(byBoq.get(c.boq_id)!.line.qty), sharePct: c.share_pct });
    if (!pu.ok) return { ok: false, status: 422, error: `${itemLabel(byBoq.get(c.boq_id)!.boq, byBoq.get(c.boq_id)!.line.description)}: ${pu.reason}` };
  }

  const existing = await loadLinks(admin, tenantId, opp.id);
  if (existing.pending) return { ok: false, status: 503, error: PENDING_ESTIMATES };
  const replaced = new Set(clean.map((c) => `${c.boq_id}|${c.estimate_id}|${c.output}`));
  const stays: AllocationLink[] = existing.rows.filter((l) => estimateIds.includes(l.estimate_id) && !replaced.has(`${l.boq_line_id}|${l.estimate_id}|${l.output}`)).map((l) => ({ boq_line_id: l.boq_line_id, output: `${l.estimate_id}:${l.output}`, basis: l.basis, share_pct: l.share_pct }));
  const proposed: AllocationLink[] = clean.map((c) => ({ boq_line_id: c.boq_id, output: `${c.estimate_id}:${c.output}`, basis: c.basis, share_pct: c.share_pct }));
  const over = overAllocated(stays, proposed);
  if (over.length > 0) return { ok: false, status: 409, error: "That would give out more than 100 percent of an estimate part. Lower the shares.", extra: { code: "over_allocated", outputs: over.map((o) => o.split(":").slice(1).join(":")) } };

  const now = new Date().toISOString();
  const byKey = new Map(existing.rows.map((l) => [`${l.boq_line_id}|${l.estimate_id}|${l.output}`, l]));
  const boqIds = new Set<string>();
  for (const c of clean) {
    const have = byKey.get(`${c.boq_id}|${c.estimate_id}|${c.output}`);
    boqIds.add(c.boq_id);
    if (have) {
      const { error } = await admin.from("tender_boq_estimate_links").update({ basis: c.basis, share_pct: c.share_pct, needs_review: false, review_note: null, updated_at: now })
        .eq("id", have.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
      if (error) return { ok: false, status: isMissingSchema(error) ? 503 : 500, error: isMissingSchema(error) ? PENDING_ESTIMATES : error.message };
      continue;
    }
    const { error } = await admin.from("tender_boq_estimate_links").insert({
      tenant_id: tenantId, opportunity_id: opp.id, boq_line_id: c.boq_id, estimate_id: c.estimate_id, output: c.output, basis: c.basis, share_pct: c.share_pct, created_by: userId,
    });
    if (error) {
      if (error.code === "23505") return { ok: false, status: 409, error: "Someone linked the same part a moment ago. Reload and look again." };
      return { ok: false, status: isMissingSchema(error) ? 503 : 500, error: isMissingSchema(error) ? PENDING_ESTIMATES : error.message };
    }
  }
  const priced = await repriceBoqLines(r, [...boqIds], { markup: cleanMarkup(opts.markup), skipQuantityGuard: true });
  return { ok: true, linked: clean.length, ...priced };
}

/** Remove one link. The line keeps its rate; with other links left it is priced from them, with none left it becomes a manual rate. */
export async function removeLink(r: EstimatesRequest, linkId: string): Promise<({ ok: true } & RepriceResult) | ({ ok: false } & Failure)> {
  const { admin, tenantId, opp } = r;
  if (!isUuid(linkId)) return { ok: false, status: 404, error: "Link not found" };
  const { data, error } = await admin.from("tender_boq_estimate_links").select(LINK_COLS).eq("id", linkId).eq("tenant_id", tenantId).eq("opportunity_id", opp.id).maybeSingle();
  if (error) return { ok: false, status: isMissingSchema(error) ? 503 : 500, error: isMissingSchema(error) ? PENDING_ESTIMATES : error.message };
  if (!data) return { ok: false, status: 404, error: "Link not found" };
  const link = toLink(data as Record<string, unknown>);
  const del = await admin.from("tender_boq_estimate_links").delete().eq("id", linkId).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  if (del.error) return { ok: false, status: 500, error: del.error.message };
  const left = await loadLinks(admin, tenantId, opp.id, [link.boq_line_id]);
  if (left.rows.length > 0) return { ok: true, ...(await repriceBoqLines(r, [link.boq_line_id])) };
  await admin.from("tender_boq_lines").update({ price_source: "manual", price_source_ref: null, unit_cost: null, markup_pct: null, updated_at: new Date().toISOString() })
    .eq("id", link.boq_line_id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id).eq("price_source", "estimate");
  return { ok: true, repriced: [], failed: [] };
}

/** "Reviewed": a person looked at lines an RFQ award re-priced by itself. */
export async function markReviewed(r: EstimatesRequest, linkIds: readonly string[]): Promise<number> {
  const ids = linkIds.filter(isUuid);
  if (ids.length === 0) return 0;
  const { data } = await r.admin.from("tender_boq_estimate_links").update({ needs_review: false, review_note: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", r.tenantId).eq("opportunity_id", r.opp.id).in("id", ids).select("id");
  return (data ?? []).length;
}

/** Re-price what was asked for: given links, given BOQ lines, or every stale or waiting link of the deal. */
export async function repriceRequest(
  r: EstimatesRequest, body: { link_ids?: unknown; boq_ids?: unknown; all_stale?: unknown; markup_pct?: unknown; confirm_quantity?: unknown },
): Promise<({ ok: true } & RepriceResult) | ({ ok: false } & Failure)> {
  const links = await loadLinks(r.admin, r.tenantId, r.opp.id);
  if (links.pending) return { ok: false, status: 503, error: PENDING_ESTIMATES };
  const boq = new Set<string>();
  const asked = new Set<string>((Array.isArray(body.link_ids) ? body.link_ids : []).filter(isUuid));
  for (const l of links.rows) if (asked.has(l.id)) boq.add(l.boq_line_id);
  const known = new Set(links.rows.map((l) => l.boq_line_id));
  for (const id of Array.isArray(body.boq_ids) ? body.boq_ids : []) if (isUuid(id) && known.has(id)) boq.add(id);
  if (body.all_stale === true) {
    // The same test the screen uses for "Estimate changed, re-price", plus the builds still waiting to be used.
    const state = await buildEstimatesState(r);
    for (const l of state.links) if (l.stale || l.waiting) boq.add(l.boq_id);
  }
  if (boq.size === 0) return { ok: false, status: 422, error: "Nothing to re-price" };

  // A build-up not yet used is divided by the line's quantity, so a person must say the estimate is made for that quantity unless its
  // own inputs already show it. The screen asks first; this is the rule, so a call that skips the screen meets it too.
  const quantities = await quantityChecks(r.admin, r.tenantId, r.opp.id, links.rows);
  const needs = links.rows.filter((l) => boq.has(l.boq_line_id)).flatMap((l) => { const q = quantities.get(l.id); return q?.needs_confirm ? [{ boq_id: l.boq_line_id, q }] : []; });
  if (needs.length > 0 && body.confirm_quantity !== true) {
    return { ok: false, status: 409, error: needs[0].q.note ?? "Confirm the quantity this estimate is made for", extra: { code: "quantity_unconfirmed", lines: needs.map((n) => n.q) } };
  }
  const out = await repriceBoqLines(r, [...boq], { markup: cleanMarkup(body.markup_pct), skipQuantityGuard: true });
  const done = new Set(out.repriced.map((x) => x.boq_id));
  const confirmed = needs.filter((n) => done.has(n.boq_id));
  if (confirmed.length > 0) {
    const user = await getAuthUser();
    await logChange(r.admin, {
      tenantId: r.tenantId, objectType: "opportunity_tenders", objectId: r.opp.id, objectLabel: `${r.opp.ref ?? ""} ${r.opp.title}`.trim(), action: "update",
      actorId: user?.id ?? r.userId, actorEmail: user?.email ?? null,
      changes: confirmed.slice(0, 40).map(({ q }) => ({ field: `Estimate quantity confirmed for ${q.item}`, from: q.measured ?? "not known", to: `${q.boq_qty}${q.uom ? ` ${q.uom}` : ""}` })),
    });
  }
  return { ok: true, ...out };
}

// ── Build up this rate ───────────────────────────────────────────────────────────────────────────────────────────────

export type BuildResult = { ok: true; estimate_id: string; ref: string | null; link_id: string } | ({ ok: false } & Failure);

/**
 * "Build up this rate": make an estimate for one BOQ line from a template, with the quantity prefilled where the template has an input
 * for it, attach it to the deal, and remember which line it is for (a link that waits, applied when the person comes back and prices
 * the line from its total divided by the quantity). The estimate itself is made by the ordinary estimate route.
 */
export async function buildUpRate(r: EstimatesRequest, input: { boq_id?: unknown; template_id?: unknown; margin_pct?: unknown }): Promise<BuildResult> {
  const { admin, tenantId, opp, userId } = r;
  if (!r.canCreateEstimates) return { ok: false, status: 403, error: "You can view estimates but not create them" };
  if (!isUuid(input.boq_id) || !isUuid(input.template_id)) return { ok: false, status: 422, error: "Choose a line and a template" };
  const b = await bundles(r as unknown as BoqRequest, input.boq_id);
  const item = b?.items[0];
  if (!item) return { ok: false, status: 404, error: "Line not found" };
  const qty = Number(item.line.qty);
  if (!(qty > 0)) return { ok: false, status: 422, error: "The line has no quantity to build a rate for" };

  const t = await admin.from("estimate_templates").select("id, inputs, is_active").eq("id", input.template_id).eq("tenant_id", tenantId).maybeSingle();
  if (t.error) return { ok: false, status: isMissingSchema(t.error) ? 503 : 500, error: isMissingSchema(t.error) ? "Estimates are waiting for a database update" : t.error.message };
  if (!t.data) return { ok: false, status: 404, error: "Template not found" };
  const inputs = ((t.data as { inputs?: unknown }).inputs ?? []) as Parameters<typeof prefillParams>[0];
  const uom = item.boq.file_uom ?? item.line.uom ?? null;
  const params = prefillParams(Array.isArray(inputs) ? inputs : [], uom, qty);

  const margin = cleanShare(input.margin_pct ?? 0);
  const { POST } = await import("@/app/api/estimates/route");
  const res = await POST(new NextRequest(new URL("http://internal.invalid/api/estimates"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: buildUpName({ item_no: item.boq.item_no, description: item.line.description }), template_id: input.template_id, params,
      margin_pct: margin ?? 0, notes: buildUpNote({ item_no: item.boq.item_no, qty, uom }), opportunity_id: opp.id,
    }),
  }));
  const made = (await res.json().catch(() => ({}))) as { id?: string; ref?: string | null; error?: string };
  if (!res.ok || !made.id) return { ok: false, status: res.status >= 400 ? res.status : 500, error: made.error ?? "The estimate could not be made" };

  const link = await admin.from("tender_boq_estimate_links").insert({
    tenant_id: tenantId, opportunity_id: opp.id, boq_line_id: item.boq.id, estimate_id: made.id, output: "total", basis: "total", share_pct: 100, created_by: userId,
  }).select("id").single();
  if (link.error || !link.data) {
    await admin.from("estimates").delete().eq("id", made.id).eq("tenant_id", tenantId);
    return { ok: false, status: isMissingSchema(link.error) ? 503 : 500, error: isMissingSchema(link.error) ? PENDING_ESTIMATES : link.error?.message ?? "The link could not be saved" };
  }
  return { ok: true, estimate_id: made.id, ref: made.ref ?? null, link_id: (link.data as { id: string }).id };
}

// ── Allocate to BOQ ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AllocationView = {
  estimate: EstimateHead;
  outputs: { key: string; label: string; cost: number }[];
  rows: Proposal[];
  /** The links this estimate already has (any BOQ line), so the panel can show what is left over. */
  existing: AllocationLink[];
};

export async function proposeAllocationFor(
  r: Pick<EstimatesRequest, "admin" | "tenantId" | "opp">, estimateId: string, how: { mode: "match" | "spread"; by: ProposalBy; output?: string | null },
): Promise<({ ok: true } & AllocationView) | ({ ok: false } & Failure)> {
  const est = await loadDealEstimate(r.admin, r.tenantId, r.opp.id, estimateId);
  if (!est) return { ok: false, status: 404, error: "Estimate not found" };
  const lines = (await loadLinesFor(r.admin, r.tenantId, [est.id])).get(est.id) ?? [];
  const b = await bundles({ ...r, supabase: r.admin, role: "member" } as unknown as BoqRequest);
  if (!b) return { ok: false, status: 404, error: "Upload a BOQ first" };
  const boq: BoqInput[] = b.items.map(({ boq: x, line }) => ({
    id: x.id, item_no: x.item_no, row_no: x.row_no, description: line.description, uom: x.file_uom ?? line.uom ?? null,
    qty: Number(line.qty), cost_code: x.cost_code, amount: Number(line.amount),
  }));
  const links = await loadLinks(r.admin, r.tenantId, r.opp.id);
  const existing: AllocationLink[] = links.rows.filter((l) => l.estimate_id === est.id).map((l) => ({ boq_line_id: l.boq_line_id, output: l.output, basis: l.basis, share_pct: l.share_pct }));
  const all = listOutputs(lines, est.cost_total);
  let rows: Proposal[];
  if (how.mode === "match") {
    rows = proposeByMatch({ boq, lines, by: how.by, existing, totalCostFallback: est.cost_total });
  } else {
    const ref = parseOutput(how.output ?? "total");
    const out = ref ? outputCost(ref, lines, est.cost_total) : null;
    if (!out) return { ok: false, status: 422, error: "That part of the estimate does not exist" };
    rows = proposeSpread({ boq, output: out, by: how.by, existing });
  }
  return { ok: true, estimate: est, outputs: all.map((o) => ({ key: o.key, label: o.label, cost: o.cost })), rows, existing };
}

// ── Missing costs ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MissingForEstimate = { estimate: EstimateHead; lines: (EstLine & { reason: MissingCost["reason"]; age_days: number | null })[] };

/** The estimates of the deal that have cost lines needing a supplier price, with those lines. */
export async function dealMissingCosts(r: Pick<EstimatesRequest, "admin" | "tenantId" | "opp">): Promise<{ pending: boolean; valid_days: number; today: string; estimates: MissingForEstimate[] }> {
  const { admin, tenantId, opp } = r;
  const [heads, config, today] = await Promise.all([loadDealEstimates(admin, tenantId, opp.id), loadConfig(admin, tenantId), tenantToday(tenantId)]);
  const validDays = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq).price_valid_days;
  if (heads.pending) return { pending: true, valid_days: validDays, today, estimates: [] };
  const lines = await loadLinesFor(admin, tenantId, heads.rows.map((e) => e.id));
  const dates = await productCostDates(admin, tenantId, [...lines.values()].flat());
  const out: MissingForEstimate[] = [];
  for (const e of heads.rows) {
    if (e.standard_quote_id) continue; // a quoted estimate is locked: its costs can no longer change
    const ls = lines.get(e.id) ?? [];
    const byId = new Map(ls.map((l) => [l.id, l]));
    const miss = missingCosts(ls, today, validDays, dates);
    if (miss.length > 0) out.push({ estimate: e, lines: miss.map((m) => ({ ...byId.get(m.line_id)!, reason: m.reason, age_days: m.age_days })) });
  }
  return { pending: false, valid_days: validDays, today, estimates: out };
}
