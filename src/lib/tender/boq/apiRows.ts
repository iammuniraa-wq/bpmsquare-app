import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryableField } from "@/lib/api/query";
import { readAllPages } from "@/lib/pagedRead";
import { tenantToday } from "@/lib/tenantClock";
import { relinkPlan } from "./diff";
import { isStale, priceValidityDays, type PriceSource } from "./price";

// The customer-safe view of a tender's Bill of quantities for the v1 API, MCP, Talk to data, the report builder and the Data Workbench
// export: one row per line, as the BOQ screen shows it (item, cost code, description = the line's name, details, unit, quantity, our unit
// rate and amount, where the rate came from, its date and the line's status) plus the client's own other columns (client_columns).
//
// DELIBERATELY NOT SELECTED, anywhere on these surfaces: unit_cost, markup_pct and price_source_ref (the cost we paid, the margin on
// it, and the supplier / RFQ / past deal that gave it), priced_by, priced_at, stale_accepted, line_id, source_id, item_key. One
// loader feeds the DW export and every API route so they cannot drift. apiExposure.test.ts fails the build if a select here names one.

export const TENDER_BOQ_LINE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "tender_id", type: "string" },
  { path: "tender_ref", type: "string", searchable: true },
  { path: "tender_no", type: "string", searchable: true },
  { path: "row_no", type: "number" },
  { path: "item_no", type: "string", searchable: true },
  { path: "cost_code", type: "string", searchable: true },
  { path: "description", type: "string", searchable: true },
  { path: "details", type: "string", searchable: true },
  // An object of the client's own column labels and cell texts (Sr #, Bill #, Section...). Returned, not queried.
  { path: "client_columns", type: "string" },
  { path: "unit", type: "string" },
  { path: "quantity", type: "number" },
  { path: "rate", type: "number" },
  { path: "amount", type: "number" },
  { path: "rate_source", type: "string" },
  { path: "price_as_of", type: "date" },
  { path: "status", type: "string" },
];

const LINE_COLS = "id, line_id, row_no, item_no, cost_code, file_description, file_uom, file_qty, price_source, price_as_of, stale_accepted, removed_in_revision, file_details, client_data";
// The same without the two client-format columns, for a database where migration 0242 has not been applied yet.
const LINE_COLS_BASE = "id, line_id, row_no, item_no, cost_code, file_description, file_uom, file_qty, price_source, price_as_of, stale_accepted, removed_in_revision";
const missingColumn = (e: { code?: string } | null | undefined) => !!e && (e.code === "42703" || e.code === "PGRST204");
const DEAL_LINE_COLS = "id, sl_no, description, uom, qty, rate, amount";

export type BoqApiSource = { file_name: string; version: number; uploaded_at: string };
export type BoqApiStatus = "priced" | "unpriced" | "stale" | "removed";
export type BoqApiContext = { validity: number; today: string };
export type BoqApiOpts = {
  /** Shared by a caller that loads many tenders, so the workspace setting and the date are read once. */
  ctx?: BoqApiContext;
  /** The deal's ref and the tender number, when the caller already has them. */
  tender?: { ref: string | null; tender_no: string | null };
};

type DealLine = { id: string; sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; amount: number };
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function boqApiContext(admin: SupabaseClient, tenantId: string): Promise<BoqApiContext> {
  const [{ data }, today] = await Promise.all([admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(), tenantToday(tenantId)]);
  return { validity: priceValidityDays((data?.config ?? {}) as Parameters<typeof priceValidityDays>[0]), today };
}

export async function loadBoqRowsForApi(admin: SupabaseClient, tenantId: string, opportunityId: string, opts: BoqApiOpts = {}): Promise<{ source: BoqApiSource | null; rows: Record<string, unknown>[] }> {
  const empty = { source: null, rows: [] };
  const { data: src, error: srcErr } = await admin.from("tender_boq_sources").select("file_name, version, uploaded_at").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("is_current", true).maybeSingle();
  // Migration 0223 pending (a missing table), or no file yet: an empty Bill of quantities, never an error.
  if (srcErr || !src) return empty;
  const source: BoqApiSource = { file_name: String(src.file_name), version: Number(src.version ?? 1), uploaded_at: String(src.uploaded_at ?? "") };

  const readLines = (full: boolean) => readAllPages<Record<string, unknown>>((lo, hi) => (full
    ? admin.from("tender_boq_lines").select(LINE_COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("row_no").order("id", { ascending: true }).range(lo, hi)
    : admin.from("tender_boq_lines").select(LINE_COLS_BASE).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("row_no").order("id", { ascending: true }).range(lo, hi)));
  const [lines, deal, ctx, tender] = await Promise.all([
    readLines(true).then((res) => (missingColumn(res.error) ? readLines(false) : res)),
    readAllPages<Record<string, unknown>>((lo, hi) => admin.from("opportunity_lines").select(DEAL_LINE_COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("id", { ascending: true }).range(lo, hi)),
    opts.ctx ?? boqApiContext(admin, tenantId),
    opts.tender ? Promise.resolve(opts.tender) : loadTenderNames(admin, tenantId, opportunityId),
  ]);
  if (lines.error || deal.error) return empty;

  const dealLines: DealLine[] = (deal.data ?? []).map((l) => ({
    id: String(l.id), sl_no: (l.sl_no as string | null) ?? null, description: String(l.description ?? ""), uom: (l.uom as string | null) ?? null,
    qty: num(l.qty), rate: num(l.rate), amount: num(l.amount),
  }));
  const live = new Set(dealLines.map((l) => l.id));
  const rows = lines.data ?? [];

  // The BOQ screen restores a row's link to its deal line when a save in the Lines editor cut it; read-only here.
  const orphans = rows.filter((r) => r.removed_in_revision !== true && (!r.line_id || !live.has(String(r.line_id))));
  const claimed = new Set(rows.filter((r) => r.line_id && live.has(String(r.line_id))).map((r) => String(r.line_id)));
  const plan = relinkPlan(
    orphans.map((o) => ({ id: String(o.id), item_no: (o.item_no as string | null) ?? null, row_no: num(o.row_no), file_description: String(o.file_description ?? ""), file_uom: (o.file_uom as string | null) ?? null })),
    dealLines.filter((l) => !claimed.has(l.id)).map((l) => ({ id: l.id, sl_no: l.sl_no, description: l.description, uom: l.uom })),
  );
  const byId = new Map(dealLines.map((l) => [l.id, l]));

  const out: Record<string, unknown>[] = [];
  for (const b of rows) {
    const lineId = live.has(String(b.line_id ?? "")) ? String(b.line_id) : plan.get(String(b.id)) ?? null;
    const l = lineId ? byId.get(lineId) : undefined;
    const removed = b.removed_in_revision === true;
    if (removed && !l) continue;
    const rate = l ? l.rate : 0;
    const priced = !!l && rate > 0;
    const asOf = typeof b.price_as_of === "string" ? b.price_as_of.slice(0, 10) : null;
    const sourceCode = (b.price_source as PriceSource | null) ?? null;
    const stale = priced && !!sourceCode && isStale(sourceCode, asOf, ctx.today, ctx.validity) && b.stale_accepted !== true;
    const status: BoqApiStatus = removed ? "removed" : !priced ? "unpriced" : stale ? "stale" : "priced";
    out.push({
      id: b.id,
      tender_id: opportunityId,
      tender_ref: tender.ref,
      tender_no: tender.tender_no,
      row_no: num(b.row_no),
      item_no: b.item_no ?? null,
      cost_code: b.cost_code ?? null,
      description: l?.description ?? String(b.file_description ?? ""),
      details: (b.file_details as string | null | undefined) ?? null,
      client_columns: b.client_data && typeof b.client_data === "object" && Object.keys(b.client_data as object).length > 0 ? b.client_data : null,
      unit: (b.file_uom as string | null) ?? l?.uom ?? null,
      quantity: l ? l.qty : num(b.file_qty),
      rate: priced ? rate : null,
      amount: priced ? round2(l!.amount) : null,
      rate_source: priced ? sourceCode : null,
      price_as_of: priced ? asOf : null,
      status,
    });
  }
  return { source, rows: out };
}

async function loadTenderNames(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ ref: string | null; tender_no: string | null }> {
  const [{ data: opp }, { data: t }] = await Promise.all([
    admin.from("opportunities").select("ref").eq("id", opportunityId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("opportunity_tenders").select("tender_no").eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  return { ref: (opp?.ref as string | null) ?? null, tender_no: (t?.tender_no as string | null) ?? null };
}

/** The summary a tender record carries: counts on the active lines and the total of the priced ones. */
export function summariseBoqRows(rows: readonly Record<string, unknown>[], source: BoqApiSource | null) {
  const active = rows.filter((r) => r.status !== "removed");
  return {
    lines: active.length,
    priced: active.filter((r) => r.status === "priced" || r.status === "stale").length,
    unpriced: active.filter((r) => r.status === "unpriced").length,
    stale: active.filter((r) => r.status === "stale").length,
    amount: round2(active.reduce((s, r) => s + (typeof r.amount === "number" ? r.amount : 0), 0)),
    file_name: source?.file_name ?? null,
    version: source?.version ?? null,
    uploaded_at: source?.uploaded_at ?? null,
  };
}
