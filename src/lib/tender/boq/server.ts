import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { opportunityStages } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, refreshOpportunityDerived } from "@/lib/sales/opportunityServer";
import { linesVersion } from "@/lib/sales/dealLines";
import { safeFileName, sniffAttachment } from "@/lib/inbox/rules";
import type { OpportunityLine } from "@/lib/types";
import { isMissingSchema, loadTender, type TenderRow } from "../server";
import { BOQ_LIMITS, detectColumns, detectLayout, extractLines, planColumns, sameLayout, type BoqLine, type ColumnMap, type ColumnPlan, type ParsedBoq, type SkippedRow } from "./parse";
import { diffBoq, relinkPlan, type BoqDiff, type ExistingLine } from "./diff";
import { defaultMarkupPct, isStale, pickAuto, priceValidityDays, rateFor, refuseCandidate, staleText, type Candidate, type PriceSource } from "./price";
import { manualSourceRef } from "./table";
import { candidatesFor, loadPriceContext, type SourceLine } from "./sources";
import { loadWorkbook, sheetNames, sheetToGrid } from "./workbook";
import { buildAnswerSheet, writePricedWorkbook, type AnswerRow, type PricedRow } from "./write";

import { readAllPages } from "@/lib/pagedRead";
// Server side of the tender BOQ (migration 0223, slice 3a). Every query is tenant-scoped on the admin client and every one
// tolerates the migration being pending (a missing table answers `pending`, never a crash). The BOQ is reached ONLY through
// openBoqRequest(): flags gcc_tender + pipeline, the caller's view (or edit, for a write) of the Pipeline workcenter, and a tender
// deal of THIS workspace. Any miss on the workspace or the deal is the same 404.

export const BOQ_BUCKET = "tender-boq-files";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type BoqRequest = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  opp: NonNullable<Awaited<ReturnType<typeof loadOpportunity>>>;
  tender: TenderRow;
};
export type Failure = { status: number; error: string };

export async function openBoqRequest(opportunityId: string, write: boolean): Promise<{ ok: true; req: BoqRequest } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  for (const key of ["gcc_tender", "pipeline"] as const) {
    if (!(await tenantHasFeature(supabase, tenantId, key))) return notFound;
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "pipeline")) return notFound;
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return notFound;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, opportunityId);
  const tender = opp ? await loadTender(admin, tenantId, opportunityId) : null;
  if (!opp || !tender) return notFound;
  if (write && !canEditWorkcenter(perms, "pipeline")) return { ok: false, status: 403, error: "You can view this deal but not change it" };
  return { ok: true, req: { admin, supabase, tenantId, userId, role, opp, tender } };
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SourceRow = {
  id: string; opportunity_id: string; version: number; is_current: boolean; file_name: string; storage_path: string; size_bytes: number;
  sheet_name: string; header_row: number; header_labels: string[]; column_map: ColumnMap; rate_col: number | null; amount_col: number | null;
  added_columns: boolean; total_row: number | null; line_count: number; uploaded_by: string | null; uploaded_at: string;
};
export type BoqRow = {
  id: string; opportunity_id: string; source_id: string; line_id: string | null; item_key: string; item_no: string | null; cost_code: string | null; row_no: number;
  file_description: string; file_uom: string | null; file_qty: number; file_rate: number | null;
  price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null; stale_accepted: boolean;
  unit_cost: number | null; markup_pct: number | null; removed_in_revision: boolean;
};

const SOURCE_COLS = "id, opportunity_id, version, is_current, file_name, storage_path, size_bytes, sheet_name, header_row, header_labels, column_map, rate_col, amount_col, added_columns, total_row, line_count, uploaded_by, uploaded_at";
const ROW_COLS = "id, opportunity_id, source_id, line_id, item_key, item_no, cost_code, row_no, file_description, file_uom, file_qty, file_rate, price_source, price_source_ref, price_as_of, stale_accepted, unit_cost, markup_pct, removed_in_revision";

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_NUMERIC_12_2 = 9_999_999_999.99;

function toSource(r: Record<string, unknown>): SourceRow {
  return {
    ...(r as unknown as SourceRow), size_bytes: Number(r.size_bytes ?? 0), version: Number(r.version ?? 1),
    uploaded_at: typeof r.uploaded_at === "string" ? r.uploaded_at : new Date().toISOString(),
    header_labels: Array.isArray(r.header_labels) ? (r.header_labels as unknown[]).map(String) : [],
    column_map: (r.column_map && typeof r.column_map === "object" ? r.column_map : {}) as ColumnMap,
  };
}
function toRow(r: Record<string, unknown>): BoqRow {
  return {
    ...(r as unknown as BoqRow), file_qty: Number(r.file_qty ?? 0), file_rate: num(r.file_rate), unit_cost: num(r.unit_cost), markup_pct: num(r.markup_pct),
    price_as_of: typeof r.price_as_of === "string" ? r.price_as_of.slice(0, 10) : null, stale_accepted: r.stale_accepted === true, removed_in_revision: r.removed_in_revision === true,
  };
}

export async function loadCurrentSource(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ source: SourceRow | null; pending: boolean }> {
  const { data, error } = await admin.from("tender_boq_sources").select(SOURCE_COLS).eq("tenant_id", tenantId).eq("opportunity_id", oppId).eq("is_current", true).maybeSingle();
  if (error) return { source: null, pending: isMissingSchema(error) };
  return { source: data ? toSource(data as Record<string, unknown>) : null, pending: false };
}

async function loadRows(admin: SupabaseClient, tenantId: string, oppId: string): Promise<BoqRow[]> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select(ROW_COLS).eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("row_no").order("id", { ascending: true }).range(lo, hi));
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(toRow);
}

async function loadConfig(admin: SupabaseClient, tenantId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  return ((data?.config ?? {}) as Record<string, unknown>) ?? {};
}

/** Restore the link of BOQ rows whose deal line was replaced by a save in the Lines editor. Best effort and idempotent. */
async function relink(admin: SupabaseClient, tenantId: string, oppId: string, rows: BoqRow[], lines: OpportunityLine[]): Promise<BoqRow[]> {
  const live = new Set(lines.map((l) => l.id));
  const orphans = rows.filter((r) => !r.removed_in_revision && (!r.line_id || !live.has(r.line_id)));
  if (orphans.length === 0) return rows;
  const claimed = new Set(rows.filter((r) => r.line_id && live.has(r.line_id)).map((r) => r.line_id!));
  const free = lines.filter((l) => !claimed.has(l.id)).map((l) => ({ id: l.id, sl_no: l.sl_no, description: l.description, uom: l.uom }));
  const plan = relinkPlan(orphans.map((o) => ({ id: o.id, item_no: o.item_no, row_no: o.row_no, file_description: o.file_description, file_uom: o.file_uom })), free);
  const next = rows.map((r) => (plan.has(r.id) ? { ...r, line_id: plan.get(r.id)! } : live.has(r.line_id ?? "") ? r : { ...r, line_id: null }));
  await Promise.all([...plan].map(([id, lineId]) => admin.from("tender_boq_lines").update({ line_id: lineId, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId).eq("opportunity_id", oppId)));
  return next;
}

// ── The screen's state ───────────────────────────────────────────────────────────────────────────────────────────────

export type BoqLineView = {
  id: string; line_id: string | null; row_no: number; item_no: string | null; cost_code: string | null; description: string; uom: string | null; qty: number;
  rate: number; amount: number; priced: boolean; linked: boolean; removed: boolean;
  price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null;
  stale: boolean; stale_text: string | null; stale_accepted: boolean; unit_cost: number | null; markup_pct: number | null; file_rate: number | null;
};
export type BoqState = {
  pending: boolean;
  source: { id: string; file_name: string; sheet_name: string; header_row: number; version: number; uploaded_at: string; line_count: number; added_columns: boolean; total_row: number | null } | null;
  lines: BoqLineView[];
  validity_days: number;
  today: string;
  /** The markup on cost "Price all" starts from: the workspace's own default, else 15. */
  default_markup_pct: number;
  /** `no_product`: active lines still free text (no catalog product), so the BOM and supplier sources find nothing for them. */
  totals: { lines: number; priced: number; unpriced: number; stale: number; amount: number; no_product: number };
  /** Fingerprint of the deal's saved lines as read here; the product match sends it back so a list that went stale is refused. */
  lines_version: string;
};

export async function buildBoqState(r: BoqRequest): Promise<BoqState> {
  const { admin, tenantId, opp } = r;
  const [{ source, pending }, config, today] = await Promise.all([loadCurrentSource(admin, tenantId, opp.id), loadConfig(admin, tenantId), tenantToday(tenantId)]);
  const validity = priceValidityDays(config);
  const markupDefault = defaultMarkupPct(config);
  const empty: BoqState = { pending, source: null, lines: [], validity_days: validity, today, default_markup_pct: markupDefault, totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0, no_product: 0 }, lines_version: "" };
  if (pending || !source) return empty;

  const dealLines = await loadOpportunityLines(admin, tenantId, opp.id);
  const rows = await relink(admin, tenantId, opp.id, await loadRows(admin, tenantId, opp.id), dealLines);
  const byId = new Map(dealLines.map((l) => [l.id, l]));
  const lines: BoqLineView[] = rows
    .filter((b) => !b.removed_in_revision || (b.line_id && byId.has(b.line_id)))
    .map((b) => {
      const l = b.line_id ? byId.get(b.line_id) : undefined;
      const rate = l ? Number(l.rate) : 0;
      const stale = !!b.price_source && isStale(b.price_source, b.price_as_of, today, validity);
      return {
        id: b.id, line_id: l?.id ?? null, row_no: b.row_no, item_no: b.item_no, cost_code: b.cost_code,
        description: l?.description ?? b.file_description, uom: b.file_uom ?? l?.uom ?? null, qty: l ? Number(l.qty) : b.file_qty,
        rate, amount: l ? Number(l.amount) : 0, priced: !!l && rate > 0, linked: !!l, removed: b.removed_in_revision,
        price_source: b.price_source, price_source_ref: b.price_source_ref, price_as_of: b.price_as_of,
        stale, stale_text: stale ? staleText(b.price_as_of, today) : null, stale_accepted: b.stale_accepted,
        unit_cost: b.unit_cost, markup_pct: b.markup_pct, file_rate: b.file_rate,
      };
    });
  const active = lines.filter((l) => !l.removed);
  return {
    pending: false,
    source: { id: source.id, file_name: source.file_name, sheet_name: source.sheet_name, header_row: source.header_row, version: source.version, uploaded_at: source.uploaded_at, line_count: source.line_count, added_columns: source.added_columns, total_row: source.total_row },
    lines, validity_days: validity, today, default_markup_pct: markupDefault,
    totals: {
      lines: active.length, priced: active.filter((l) => l.priced).length, unpriced: active.filter((l) => !l.priced).length,
      stale: active.filter((l) => l.priced && l.stale && !l.stale_accepted).length, amount: round2(active.reduce((s, l) => s + (l.priced ? l.amount : 0), 0)),
      no_product: active.filter((l) => l.linked && !byId.get(l.line_id!)?.product_id).length,
    },
    lines_version: linesVersion(dealLines),
  };
}

// ── Reading an upload ────────────────────────────────────────────────────────────────────────────────────────────────

export type UploadInput = { bytes: Uint8Array; fileName: string; sheet?: string | null; headerRow?: number | null; map?: ColumnMap | null };

export type AnalysisView = {
  sheets: string[]; sheet: string;
  header_row: number | null; map: ColumnMap; headers: { col: number; label: string }[];
  /** The first rows of the sheet as text, so a person can see which row is the header. */
  preview: string[][];
  reused_map: boolean; needs_mapping: boolean;
  line_count: number; sample: BoqLine[]; skipped: SkippedRow[]; skipped_count: number; total_row: number | null; truncated: boolean;
  columns: ColumnPlan | null;
  diff: { added: number; changed: number; unchanged: number; dropped: number; kept: number; added_items: string[]; changed_items: { item: string; fields: string[] }[]; dropped_items: string[]; kept_items: string[] } | null;
};
type Analysed = { view: AnalysisView; parsed: ParsedBoq; headerLabels: string[]; diff: BoqDiff | null; sheet: string };

const itemLabel = (l: { item_no: string | null; description: string }) => (l.item_no ? `${l.item_no} ${l.description}` : l.description).slice(0, 80);

/** The existing BOQ lines of the deal as the diff sees them: what the FILE said last time, and whether the deal line is priced. */
async function existingLines(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ rows: BoqRow[]; lines: OpportunityLine[]; existing: ExistingLine[] }> {
  const dealLines = await loadOpportunityLines(admin, tenantId, oppId);
  const rows = await relink(admin, tenantId, oppId, await loadRows(admin, tenantId, oppId), dealLines);
  const byId = new Map(dealLines.map((l) => [l.id, l]));
  const existing = rows.map((b): ExistingLine => ({
    key: b.item_key, item_no: b.item_no, description: b.file_description, uom: b.file_uom, qty: b.file_qty, cost_code: b.cost_code,
    priced: (b.line_id ? Number(byId.get(b.line_id)?.rate ?? 0) > 0 : false) || b.price_source != null, removed: b.removed_in_revision,
  }));
  return { rows, lines: dealLines, existing };
}

export async function analyseUpload(r: BoqRequest, input: UploadInput): Promise<({ ok: true } & Analysed) | ({ ok: false } & Failure)> {
  if (input.bytes.byteLength === 0) return { ok: false, status: 422, error: "The file is empty" };
  if (input.bytes.byteLength > BOQ_LIMITS.maxFileBytes) return { ok: false, status: 413, error: "The file is larger than 15 MB" };
  const sniffed = sniffAttachment(input.bytes, input.fileName);
  if (!sniffed.ok || sniffed.ext !== "xlsx") return { ok: false, status: 422, error: "Upload the client's BOQ as an Excel .xlsx file (an older .xls can be saved as .xlsx first)" };

  let wb;
  try { wb = await loadWorkbook(input.bytes); } catch { return { ok: false, status: 422, error: "The Excel file could not be read" }; }
  const names = sheetNames(wb);
  if (names.length === 0) return { ok: false, status: 422, error: "The workbook has no sheet with anything in it" };

  const { source: saved } = await loadCurrentSource(r.admin, r.tenantId, r.opp.id);

  // The sheet: the one asked for, else the one with the same name as last time, else the one that reads as the biggest BOQ.
  let sheet = input.sheet ?? null;
  if (sheet && !names.includes(sheet)) return { ok: false, status: 422, error: `There is no sheet called "${sheet.slice(0, 60)}"` };
  const gridOf = (name: string) => sheetToGrid(wb.getWorksheet(name)!);
  if (!sheet && saved && names.includes(saved.sheet_name)) sheet = saved.sheet_name;
  if (!sheet) {
    let best = { name: names[0], lines: -1 };
    for (const name of names.slice(0, 8)) {
      const g = gridOf(name);
      const lay = detectLayout(g);
      const n = lay.headerRow ? extractLines(g, lay.headerRow, lay.map).lines.length : 0;
      if (n > best.lines) best = { name, lines: n };
    }
    sheet = best.name;
  }
  const grid = gridOf(sheet);

  let headerRow: number | null = null;
  let map: ColumnMap = {};
  let reused = false;
  if (input.headerRow && input.headerRow >= 1 && input.headerRow <= Math.max(grid.length, 1)) {
    headerRow = input.headerRow;
    map = input.map ?? (saved && saved.sheet_name === sheet && saved.header_row === headerRow && sameLayout(grid, headerRow, saved.header_labels) ? saved.column_map : detectColumns(grid[headerRow - 1] ?? []).map);
    reused = !input.map && !!saved && saved.sheet_name === sheet && saved.header_row === headerRow && sameLayout(grid, headerRow, saved.header_labels);
  } else if (saved && saved.sheet_name === sheet && sameLayout(grid, saved.header_row, saved.header_labels)) {
    headerRow = saved.header_row; map = input.map ?? saved.column_map; reused = !input.map;
  } else {
    const lay = detectLayout(grid);
    headerRow = lay.headerRow; map = input.map ?? lay.map;
  }
  const mapOk = map.description != null && map.qty != null;
  const needsMapping = headerRow == null || !mapOk;
  const parsed: ParsedBoq = !needsMapping ? extractLines(grid, headerRow!, map) : { lines: [], skipped: [], total_row: null, truncated: false };
  const headerCells = headerRow ? grid[headerRow - 1] ?? [] : [];
  const headerLabels = headerCells.map((c) => (c == null ? "" : String(c)));

  const ex = !needsMapping && saved ? await existingLines(r.admin, r.tenantId, r.opp.id) : null;
  const diff = ex && ex.existing.length > 0 ? diffBoq(ex.existing, parsed.lines) : null;
  const colCount = Math.min(BOQ_LIMITS.maxColumns, Math.max(1, ...grid.slice(0, 40).map((row) => row.length)));

  const view: AnalysisView = {
    sheets: names, sheet, header_row: headerRow, map,
    headers: Array.from({ length: colCount }, (_, i) => ({ col: i + 1, label: headerLabels[i] ?? "" })),
    preview: grid.slice(0, 15).map((row) => Array.from({ length: Math.min(colCount, 12) }, (_, i) => (row[i] == null ? "" : String(row[i]).slice(0, 40)))),
    reused_map: reused, needs_mapping: needsMapping,
    line_count: parsed.lines.length, sample: parsed.lines.slice(0, 8), skipped: parsed.skipped.slice(0, 30), skipped_count: parsed.skipped.length, total_row: parsed.total_row, truncated: parsed.truncated,
    columns: !needsMapping ? planColumns(grid, headerRow!, map) : null,
    diff: diff && {
      added: diff.added.length, changed: diff.changed.length, unchanged: diff.unchanged, dropped: diff.dropped.length, kept: diff.kept.length,
      added_items: diff.added.slice(0, 30).map(itemLabel), changed_items: diff.changed.slice(0, 30).map((c) => ({ item: itemLabel(c.line), fields: c.fields })),
      dropped_items: diff.dropped.slice(0, 30).map(itemLabel), kept_items: diff.kept.slice(0, 30).map(itemLabel),
    },
  };
  return { ok: true, view, parsed, headerLabels, diff, sheet };
}

// ── Applying an upload ───────────────────────────────────────────────────────────────────────────────────────────────

const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function inBatches<T>(items: readonly T[], size: number, fn: (x: T) => PromiseLike<unknown>) {
  for (const part of chunks(items, size)) await Promise.all(part.map(fn));
}

export type ApplyResult = { ok: true; line_count: number; added: number; changed: number; dropped: number; kept: number; priced_from_file: number } | ({ ok: false } & Failure);

export async function applyUpload(r: BoqRequest, input: UploadInput): Promise<ApplyResult> {
  const { admin, tenantId, userId, opp } = r;
  const a = await analyseUpload(r, input);
  if (!a.ok) return a;
  if (a.view.needs_mapping || !a.view.header_row) return { ok: false, status: 422, error: "Pick the header row and the Description and Quantity columns first" };
  if (a.parsed.lines.length === 0) return { ok: false, status: 422, error: "No lines were found below the header row" };
  const view = a.view;
  const incoming = a.parsed.lines;
  const today = await tenantToday(tenantId);
  const config = await loadConfig(admin, tenantId);
  const { source: previous, pending } = await loadCurrentSource(admin, tenantId, opp.id);
  if (pending) return { ok: false, status: 503, error: "The BOQ needs a database update (migration 0223)" };

  // 1. The original file, kept so the priced workbook can be written back into it.
  const sniffed = sniffAttachment(input.bytes, input.fileName);
  const ext = sniffed.ok ? sniffed.ext : "xlsx";
  const path = `${tenantId}/${opp.id}/${randomUUID()}.${ext}`;
  const up = await admin.storage.from(BOQ_BUCKET).upload(path, Buffer.from(input.bytes), { contentType: XLSX_MIME, upsert: false });
  if (up.error) return { ok: false, status: 500, error: "The file could not be stored" };
  const undoFile = async () => { await admin.storage.from(BOQ_BUCKET).remove([path]); };

  // 2. A new current source; the previous one stays as history.
  if (previous) {
    const { error } = await admin.from("tender_boq_sources").update({ is_current: false }).eq("id", previous.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    if (error) { await undoFile(); return { ok: false, status: 500, error: error.message }; }
  }
  const cols = view.columns!;
  const sourceId = randomUUID();
  const { error: sErr } = await admin.from("tender_boq_sources").insert({
    id: sourceId, tenant_id: tenantId, opportunity_id: opp.id, version: (previous?.version ?? 0) + 1, is_current: true,
    file_name: safeFileName(input.fileName, ext), storage_path: path, size_bytes: input.bytes.byteLength, sheet_name: a.sheet, header_row: view.header_row,
    header_labels: a.headerLabels, column_map: view.map, rate_col: cols.rate_col, amount_col: cols.amount_col, added_columns: cols.added,
    total_row: a.parsed.total_row, line_count: incoming.length, uploaded_by: userId,
  });
  if (sErr) {
    if (previous) await admin.from("tender_boq_sources").update({ is_current: true }).eq("id", previous.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    await undoFile();
    return { ok: false, status: isMissingSchema(sErr) ? 503 : 500, error: isMissingSchema(sErr) ? "The BOQ needs a database update (migration 0223)" : sErr.message };
  }

  // 3. The lines: matched ones are updated, new ones inserted, vanished unpriced ones removed, vanished priced ones kept and flagged.
  const { rows, lines: dealLines, existing } = await existingLines(admin, tenantId, opp.id);
  const diff = diffBoq(existing, incoming);
  const rowByKey = new Map(rows.map((x) => [x.item_key, x]));
  const lineById = new Map(dealLines.map((l) => [l.id, l]));
  const now = new Date().toISOString();
  const fileLabel = safeFileName(input.fileName, ext);
  let pricedFromFile = 0;

  const newDealLine = (l: BoqLine) => {
    const id = randomUUID();
    const rate = l.file_rate != null && l.file_rate <= MAX_NUMERIC_12_2 ? round2(l.file_rate) : 0;
    const qty = round2(l.qty);
    return { id, rate, row: { id, tenant_id: tenantId, opportunity_id: opp.id, sl_no: l.item_no ?? String(l.row_no), description: l.description, uom: l.uom, qty, rate, discount_pct: 0, amount: round2(qty * rate), is_selected: true, show_on_pdf: true } };
  };
  const boqBase = (l: BoqLine) => ({ source_id: sourceId, item_no: l.item_no, cost_code: l.cost_code, row_no: l.row_no, file_description: l.description, file_uom: l.uom, file_qty: l.qty, file_rate: l.file_rate, removed_in_revision: false, updated_at: now });
  const fromFile = (rate: number) => rate > 0 ? { price_source: "boq_rate", price_source_ref: fileLabel, price_as_of: today, stale_accepted: false, unit_cost: null, markup_pct: null, priced_by: userId, priced_at: now } : {};

  const toInsertLines: Record<string, unknown>[] = [];
  const toInsertRows: Record<string, unknown>[] = [];
  const updates: (() => PromiseLike<unknown>)[] = [];

  for (const l of incoming) {
    const have = rowByKey.get(l.key);
    const live = have?.line_id ? lineById.get(have.line_id) : undefined;
    if (!have || !live) {
      // A new line, or a known row whose deal line is gone (deleted in the Lines editor): give it a deal line again.
      const made = newDealLine(l);
      toInsertLines.push(made.row);
      if (made.rate > 0) pricedFromFile++;
      if (have) updates.push(() => admin.from("tender_boq_lines").update({ ...boqBase(l), line_id: made.id, ...fromFile(made.rate) }).eq("id", have.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id));
      else toInsertRows.push({ id: randomUUID(), tenant_id: tenantId, opportunity_id: opp.id, line_id: made.id, item_key: l.key, ...boqBase(l), created_at: now, ...fromFile(made.rate) });
      continue;
    }
    // A known line. The deal line follows the file only where the FILE changed since the last upload; a person's edit survives.
    const patch: Record<string, unknown> = {};
    if (have.file_description !== l.description) patch.description = l.description;
    if ((have.file_uom ?? null) !== (l.uom ?? null)) patch.uom = l.uom;
    if (Math.abs(have.file_qty - l.qty) >= 0.0005) patch.qty = round2(l.qty);
    if (l.item_no && have.item_no !== l.item_no) patch.sl_no = l.item_no;
    let boqPatch: Record<string, unknown> = {};
    const unpriced = !(Number(live.rate) > 0);
    if (l.file_rate != null && l.file_rate <= MAX_NUMERIC_12_2 && (unpriced || have.price_source === "boq_rate") && round2(l.file_rate) !== Number(live.rate)) {
      patch.rate = round2(l.file_rate); boqPatch = fromFile(round2(l.file_rate)); pricedFromFile++;
    }
    if ("qty" in patch || "rate" in patch) {
      const qty = (patch.qty as number | undefined) ?? Number(live.qty);
      const rate = (patch.rate as number | undefined) ?? Number(live.rate);
      patch.amount = round2(qty * rate * (1 - Number(live.discount_pct ?? 0) / 100));
    }
    if (Object.keys(patch).length > 0) updates.push(() => admin.from("opportunity_lines").update(patch).eq("id", live.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id));
    updates.push(() => admin.from("tender_boq_lines").update({ ...boqBase(l), ...boqPatch }).eq("id", have.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id));
  }

  for (const part of chunks(toInsertLines, 500)) {
    const { error } = await admin.from("opportunity_lines").insert(part);
    if (error) return { ok: false, status: 500, error: `The lines could not be saved: ${error.message}` };
  }
  for (const part of chunks(toInsertRows, 500)) {
    const { error } = await admin.from("tender_boq_lines").insert(part);
    if (error) return { ok: false, status: 500, error: `The BOQ rows could not be saved: ${error.message}` };
  }
  await inBatches(updates, 20, (u) => u());

  // Lines that left the file.
  const droppedRows = diff.dropped.map((d) => rowByKey.get(d.key)).filter((x): x is BoqRow => !!x);
  const droppedLineIds = droppedRows.map((x) => x.line_id).filter((x): x is string => !!x);
  for (const part of chunks(droppedLineIds, 100)) await admin.from("opportunity_lines").delete().eq("tenant_id", tenantId).eq("opportunity_id", opp.id).in("id", part);
  for (const part of chunks(droppedRows.map((x) => x.id), 100)) await admin.from("tender_boq_lines").delete().eq("tenant_id", tenantId).eq("opportunity_id", opp.id).in("id", part);
  const keptIds = diff.kept.map((d) => rowByKey.get(d.key)?.id).filter((x): x is string => !!x);
  for (const part of chunks(keptIds, 100)) await admin.from("tender_boq_lines").update({ removed_in_revision: true, updated_at: now }).eq("tenant_id", tenantId).eq("opportunity_id", opp.id).in("id", part);

  await refreshOpportunityDerived(admin, tenantId, opp.id, opportunityStages(config as Parameters<typeof opportunityStages>[0]));

  const user = await getAuthUser();
  await logChange(r.supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "BOQ upload", from: previous ? `${previous.file_name} (v${previous.version})` : null, to: `${fileLabel} · ${incoming.length} lines${previous ? ` · ${diff.added.length} added, ${diff.changed.length} changed, ${diff.dropped.length} removed, ${diff.kept.length} kept` : ""}` }],
  });
  return { ok: true, line_count: incoming.length, added: diff.added.length, changed: diff.changed.length, dropped: diff.dropped.length, kept: diff.kept.length, priced_from_file: pricedFromFile };
}

// ── Pricing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LineBundle = { boq: BoqRow; line: OpportunityLine };

export async function bundles(r: BoqRequest, only?: string): Promise<{ source: SourceRow; items: LineBundle[] } | null> {
  const { source } = await loadCurrentSource(r.admin, r.tenantId, r.opp.id);
  if (!source) return null;
  const dealLines = await loadOpportunityLines(r.admin, r.tenantId, r.opp.id);
  const rows = await relink(r.admin, r.tenantId, r.opp.id, await loadRows(r.admin, r.tenantId, r.opp.id), dealLines);
  const byId = new Map(dealLines.map((l) => [l.id, l]));
  const items = rows
    .filter((b) => !b.removed_in_revision && (only ? b.id === only : true))
    .map((b) => ({ boq: b, line: b.line_id ? byId.get(b.line_id) : undefined }))
    .filter((x): x is LineBundle => !!x.line);
  return { source, items };
}

const sourceLine = (x: LineBundle): SourceLine => ({ description: x.line.description, product_id: x.line.product_id ?? null, cost_code: x.boq.cost_code, file_rate: x.boq.file_rate });

export type CandidateView = Candidate & { stale: boolean; stale_text: string | null };

export async function candidatesForLine(r: BoqRequest, boqLineId: string): Promise<{ ok: true; candidates: CandidateView[]; validity_days: number; today: string } | ({ ok: false } & Failure)> {
  const b = await bundles(r, boqLineId);
  if (!b || b.items.length === 0) return { ok: false, status: 404, error: "Line not found" };
  const [config, today] = [await loadConfig(r.admin, r.tenantId), await tenantToday(r.tenantId)];
  const validity = priceValidityDays(config);
  const ctx = await loadPriceContext(r.admin, r.tenantId, r.opp.id, [sourceLine(b.items[0])], { name: b.source.file_name, date: b.source.uploaded_at.slice(0, 10) });
  const candidates = candidatesFor(ctx, sourceLine(b.items[0])).map((c) => {
    const stale = isStale(c.source, c.as_of, today, validity);
    return { ...c, stale, stale_text: stale ? staleText(c.as_of, today) : null };
  });
  return { ok: true, candidates, validity_days: validity, today };
}

export type PriceBody = { source: PriceSource; ref?: string | null; markup_pct?: number | null; accept_stale?: boolean; rate?: number | null };

const cleanMarkup = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1000, v)) : 0);

export async function priceOneLine(r: BoqRequest, boqLineId: string, body: PriceBody): Promise<{ ok: true; rate: number; amount: number } | ({ ok: false } & Failure)> {
  const { admin, tenantId, userId, opp } = r;
  const b = await bundles(r, boqLineId);
  if (!b || b.items.length === 0) return { ok: false, status: 404, error: "Line not found" };
  const { boq, line } = b.items[0];
  const [config, today] = [await loadConfig(admin, tenantId), await tenantToday(tenantId)];
  const validity = priceValidityDays(config);
  const now = new Date().toISOString();
  let rate: number;
  let fields: Record<string, unknown>;

  if (body.source === "manual") {
    const v = typeof body.rate === "number" ? body.rate : Number.NaN;
    if (!Number.isFinite(v) || v < 0 || v > MAX_NUMERIC_12_2) return { ok: false, status: 422, error: "Enter a rate of 0 or more" };
    rate = round2(v);
    // A hand-typed rate is its own source, but the one it replaced is not lost: it is kept in the reference ("was Supplier · RFQ-0012").
    fields = { price_source: "manual", price_source_ref: manualSourceRef(boq), price_as_of: today, stale_accepted: false, unit_cost: null, markup_pct: null };
  } else {
    const ctx = await loadPriceContext(admin, tenantId, opp.id, [sourceLine({ boq, line })], { name: b.source.file_name, date: b.source.uploaded_at.slice(0, 10) });
    // The price comes from the SOURCE as the server finds it now, never from the request: a caller cannot label a number it typed as a supplier's.
    const pick = candidatesFor(ctx, sourceLine({ boq, line })).find((c) => c.source === body.source && c.ref === (body.ref ?? ""));
    if (!pick) return { ok: false, status: 422, error: "That price is no longer offered for this line" };
    const refusal = refuseCandidate(pick, today, validity, body.accept_stale === true);
    if (refusal) return { ok: false, status: 422, error: refusal };
    const markup = cleanMarkup(body.markup_pct);
    rate = rateFor(pick, markup);
    if (rate > MAX_NUMERIC_12_2) return { ok: false, status: 422, error: "That rate is too large" };
    fields = {
      price_source: pick.source, price_source_ref: pick.ref.slice(0, 200), price_as_of: pick.as_of, stale_accepted: isStale(pick.source, pick.as_of, today, validity),
      unit_cost: pick.kind === "cost" ? pick.price : null, markup_pct: pick.kind === "cost" ? markup : null,
    };
  }
  const amount = round2(Number(line.qty) * rate * (1 - Number(line.discount_pct ?? 0) / 100));
  const { error } = await admin.from("opportunity_lines").update({ rate, amount }).eq("id", line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  if (error) return { ok: false, status: 500, error: error.message };
  await admin.from("tender_boq_lines").update({ ...fields, priced_by: userId, priced_at: now, updated_at: now }).eq("id", boq.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  await refreshOpportunityDerived(admin, tenantId, opp.id, opportunityStages(config as Parameters<typeof opportunityStages>[0]));
  const user = await getAuthUser();
  await logChange(r.supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: `BOQ rate ${boq.item_no ?? `row ${boq.row_no}`}`, from: Number(line.rate), to: rate }, { field: "BOQ rate source", from: boq.price_source, to: fields.price_source }],
  });
  return { ok: true, rate, amount };
}

export type EditBody = { qty?: unknown; description?: unknown };
const MAX_QTY = 9_999_999_999.99;

/**
 * Quantity and description of one BOQ row, from the row panel. The rate is changed through priceOneLine (a manual rate), so the source
 * rules live in one place. What the client's FILE said (file_qty, file_description) is never touched: a revised file is still compared
 * with the file, not with our edits. An estimate that priced the row shows "changed" by itself, because its cost per unit now differs.
 */
export async function editBoqLine(r: BoqRequest, boqLineId: string, body: EditBody): Promise<{ ok: true; qty: number; description: string; amount: number } | ({ ok: false } & Failure)> {
  const { admin, tenantId, opp } = r;
  const b = await bundles(r, boqLineId);
  if (!b || b.items.length === 0) return { ok: false, status: 404, error: "Line not found" };
  const { boq, line } = b.items[0];

  const patch: Record<string, unknown> = {};
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const label = boq.item_no ?? `row ${boq.row_no}`;
  let qty = Number(line.qty);
  let description = line.description;
  if (body.qty !== undefined) {
    const q = typeof body.qty === "number" ? body.qty : typeof body.qty === "string" && body.qty.trim() !== "" ? Number(body.qty) : Number.NaN;
    if (!Number.isFinite(q) || q < 0 || q > MAX_QTY) return { ok: false, status: 422, error: "Enter a quantity of 0 or more" };
    qty = round2(q);
    if (qty !== Number(line.qty)) { patch.qty = qty; changes.push({ field: `BOQ quantity ${label}`, from: Number(line.qty), to: qty }); }
  }
  if (body.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim() : "";
    if (!d) return { ok: false, status: 422, error: "A line needs a description" };
    if (d.length > 1000) return { ok: false, status: 422, error: "The description is longer than 1,000 characters" };
    description = d;
    if (d !== line.description) { patch.description = d; changes.push({ field: `BOQ description ${label}`, from: line.description, to: d }); }
  }
  const amount = round2(qty * Number(line.rate) * (1 - Number(line.discount_pct ?? 0) / 100));
  if (Object.keys(patch).length === 0) return { ok: true, qty, description, amount: Number(line.amount) };
  if (patch.qty !== undefined) patch.amount = amount;

  const { error } = await admin.from("opportunity_lines").update(patch).eq("id", line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  if (error) return { ok: false, status: 500, error: error.message };
  const config = await loadConfig(admin, tenantId);
  await refreshOpportunityDerived(admin, tenantId, opp.id, opportunityStages(config as Parameters<typeof opportunityStages>[0]));
  const user = await getAuthUser();
  await logChange(r.supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email, changes,
  });
  return { ok: true, qty, description, amount };
}

export type PriceAllResult = { ok: true; priced: number; left: { id: string; item: string; reason: string }[]; left_count: number };

/** Prices the lines that have no rate, from fresh sources only, in a fixed order. Lines that already have a rate are never touched. */
export async function priceAllLines(r: BoqRequest, markupInput: unknown): Promise<PriceAllResult | ({ ok: false } & Failure)> {
  const { admin, tenantId, userId, opp } = r;
  const b = await bundles(r);
  if (!b) return { ok: false, status: 404, error: "Upload a BOQ first" };
  const todo = b.items.filter((x) => !(Number(x.line.rate) > 0));
  const [config, today] = [await loadConfig(admin, tenantId), await tenantToday(tenantId)];
  const validity = priceValidityDays(config);
  const markup = cleanMarkup(markupInput);
  const ctx = await loadPriceContext(admin, tenantId, opp.id, todo.map(sourceLine), { name: b.source.file_name, date: b.source.uploaded_at.slice(0, 10) });
  const left: { id: string; item: string; reason: string }[] = [];
  const jobs: LineBundle[] = [];
  const picks = new Map<string, { c: Candidate; rate: number }>();
  for (const x of todo) {
    const pick = pickAuto(candidatesFor(ctx, sourceLine(x)), today, validity);
    if (!pick.chosen) { left.push({ id: x.boq.id, item: itemLabel({ item_no: x.boq.item_no, description: x.line.description }), reason: pick.reason }); continue; }
    const rate = rateFor(pick.chosen, markup);
    if (rate > MAX_NUMERIC_12_2) { left.push({ id: x.boq.id, item: itemLabel({ item_no: x.boq.item_no, description: x.line.description }), reason: "The rate is too large" }); continue; }
    picks.set(x.boq.id, { c: pick.chosen, rate });
    jobs.push(x);
  }
  const now = new Date().toISOString();
  await inBatches(jobs, 20, async (x) => {
    const { c, rate } = picks.get(x.boq.id)!;
    const amount = round2(Number(x.line.qty) * rate * (1 - Number(x.line.discount_pct ?? 0) / 100));
    await admin.from("opportunity_lines").update({ rate, amount }).eq("id", x.line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
    await admin.from("tender_boq_lines").update({
      price_source: c.source, price_source_ref: c.ref.slice(0, 200), price_as_of: c.as_of, stale_accepted: false,
      unit_cost: c.kind === "cost" ? c.price : null, markup_pct: c.kind === "cost" ? markup : null, priced_by: userId, priced_at: now, updated_at: now,
    }).eq("id", x.boq.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  });
  if (jobs.length > 0) {
    await refreshOpportunityDerived(admin, tenantId, opp.id, opportunityStages(config as Parameters<typeof opportunityStages>[0]));
    const user = await getAuthUser();
    await logChange(r.supabase, {
      tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "BOQ price all", from: null, to: `${jobs.length} priced, ${left.length} left unpriced (markup ${markup}% on costs)` }],
    });
  }
  return { ok: true, priced: jobs.length, left: left.slice(0, 200), left_count: left.length };
}

// ── Files out ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExportResult = { ok: true; buffer: Buffer; fileName: string; unpriced: number } | ({ ok: false } & Failure);

/** The CLIENT'S file with our unit rates and amounts written into it. Only the selling rate and its amount are passed on: no cost, no markup. */
export async function exportPriced(r: BoqRequest): Promise<ExportResult> {
  const b = await bundles(r);
  if (!b) return { ok: false, status: 404, error: "Upload a BOQ first" };
  const { source, items } = b;
  const dl = await r.admin.storage.from(BOQ_BUCKET).download(source.storage_path);
  if (dl.error || !dl.data) return { ok: false, status: 404, error: "The original file is no longer available. Upload the BOQ again." };
  const original = new Uint8Array(await dl.data.arrayBuffer());
  const rows: PricedRow[] = items.filter((x) => Number(x.line.rate) > 0).map((x) => ({ row_no: x.boq.row_no, rate: Number(x.line.rate), amount: Number(x.line.amount) }));
  const rowNos = items.map((x) => x.boq.row_no);
  const qtyCol = source.column_map.qty ?? null;
  try {
    const buffer = await writePricedWorkbook(original, {
      sheet: source.sheet_name, header_row: source.header_row, qty_col: qtyCol, rate_col: source.rate_col ?? (source.column_map.rate ?? 0), amount_col: source.amount_col ?? (source.column_map.amount ?? 0),
      added: source.added_columns, total_row: source.total_row, first_row: Math.min(...rowNos), last_row: Math.max(...rowNos), rows,
    });
    const base = source.file_name.replace(/\.xlsx$/i, "");
    return { ok: true, buffer, fileName: safeFileName(`${base} - priced.xlsx`, "xlsx"), unpriced: items.length - rows.length };
  } catch (e) {
    return { ok: false, status: 422, error: e instanceof Error ? e.message : "The priced file could not be written" };
  }
}

export async function exportAnswerSheet(r: BoqRequest): Promise<ExportResult> {
  const b = await bundles(r);
  if (!b) return { ok: false, status: 404, error: "Upload a BOQ first" };
  const rows: AnswerRow[] = b.items.map(({ boq, line }) => {
    const priced = Number(line.rate) > 0;
    return {
      item_no: boq.item_no, description: line.description, uom: boq.file_uom ?? line.uom, qty: Number(line.qty), rate: priced ? Number(line.rate) : null, amount: priced ? Number(line.amount) : null,
      notes: priced ? boq.cost_code ?? "" : "Not priced",
    };
  });
  const buffer = await buildAnswerSheet(rows, r.tender.tender_no ?? r.opp.title);
  return { ok: true, buffer, fileName: safeFileName(`${r.tender.tender_no ?? r.opp.ref ?? "BOQ"} - answer sheet.xlsx`, "xlsx"), unpriced: rows.filter((x) => x.rate == null).length };
}

/** For the warning before a download: the lines that would be left blank. */
export function unpricedList(state: BoqState): { item: string; reason: string }[] {
  return state.lines.filter((l) => !l.removed && !l.priced).slice(0, 50).map((l) => ({ item: itemLabel(l), reason: l.linked ? "No rate yet" : "The deal line behind this row was replaced" }));
}
