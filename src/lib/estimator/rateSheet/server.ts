import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { logChangeBatch } from "@/lib/changeLog";
import type { ChangeLogEntryParams } from "@/lib/changeLog";
import { formatMasterRef, isMasterRefCollision, nextMasterRefSeq } from "@/lib/masterRef";
import { rfqConfig } from "@/lib/rfq/types";
import type { RfqConfig } from "@/lib/constants";
import { csvCell } from "@/lib/import/template";
import { estimatorAccess, isMissingRelation } from "../server";
import type { EstimatorCtx } from "../server";
import { plainProductName, starterCatalogue } from "../starterCatalogue";
import {
  RATE_FIELD_LABEL, RATE_LIMITS, csvToGrid, detectRateLayout, extractRates, parseSheetDate, rateFileKind,
} from "./parse";
import type { ParsedRates, RateColumnMap } from "./parse";
import { readRateWorkbook } from "./workbook";
import { parseDecisions, planApply, planRows, summarise, withDefaults } from "./plan";
import type { ApplyView, PreviewView } from "./view";
import type { CatalogueProduct, PlanContext, RowOutcome } from "./plan";

// The server side of "Import rate sheet" (Settings > Estimate templates). Admin only, estimator module only. The file is read in
// memory and never stored; preview and apply are two calls with the same file, so the server never trusts a row, a match or a
// price that came back from the browser: it reads the file again and takes only the person's choices (a row number, an action,
// a product id) from the request. Every read and write carries the tenant id from requireTenantUser(), and a product id from the
// request must be one of this workspace's before it is written.

export type Failure = { status: number; error: string };
export type RateCtx = EstimatorCtx;

/** The gate: signed in, estimator module on, may edit estimates, and an administrator. */
export async function openRateSheet(): Promise<{ ok: true; ctx: RateCtx } | ({ ok: false } & Failure)> {
  try {
    const ctx = await estimatorAccess("edit");
    if (ctx.role !== "admin") return { ok: false, status: 403, error: "Only an administrator can import a rate sheet." };
    return { ok: true, ctx };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 500, error: err.message ?? "Something went wrong" };
  }
}

const todayKey = () => new Date().toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Upload = {
  bytes: Uint8Array;
  fileName: string;
  /** The date a row without one gets. */
  sheetDate: string;
  decisions: unknown;
};

/** The multipart body of both calls: the file, the sheet date, and (apply only) the choices. */
export async function readUpload(request: NextRequest, today: string = todayKey()): Promise<{ ok: true; input: Upload } | ({ ok: false } & Failure)> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RATE_LIMITS.maxFileBytes + 256 * 1024) return { ok: false, status: 413, error: "The file is larger than 5 MB" };
  let form: FormData;
  try { form = await request.formData(); } catch { return { ok: false, status: 400, error: "Send the file as a form upload" }; }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, status: 400, error: "Choose an Excel or CSV file" };
  if (file.size === 0) return { ok: false, status: 400, error: "The file is empty" };
  if (file.size > RATE_LIMITS.maxFileBytes) return { ok: false, status: 413, error: "The file is larger than 5 MB" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = rateFileKind(file.name || "", bytes);
  if (typeof kind !== "string") return { ok: false, status: 415, error: kind.error };

  const rawDate = form.get("as_of");
  let sheetDate = today;
  if (typeof rawDate === "string" && rawDate.trim()) {
    const d = rawDate.trim();
    if (!ISO_DAY.test(d) || parseSheetDate(d) !== d) return { ok: false, status: 422, error: "The prices-as-of date must be a real date, like 2026-10-26" };
    if (d > today) return { ok: false, status: 422, error: "Prices cannot be dated in the future" };
    sheetDate = d;
  }
  let decisions: unknown = null;
  const rawDecisions = form.get("decisions");
  if (typeof rawDecisions === "string" && rawDecisions.trim()) {
    if (rawDecisions.length > 400_000) return { ok: false, status: 413, error: "Too many choices in one request" };
    try { decisions = JSON.parse(rawDecisions); } catch { return { ok: false, status: 400, error: "The choices could not be read" }; }
  }
  return { ok: true, input: { bytes, fileName: (file.name || "rate-sheet").slice(0, 120), sheetDate, decisions } };
}

export type Sheet = ParsedRates & { sheet: string | null; header_row: number; map: RateColumnMap };

/** Read the file into rows. A file with no header row, or no priced row, is a 422 that says what a rate sheet needs. */
export async function readSheet(input: Upload): Promise<{ ok: true; sheet: Sheet } | ({ ok: false } & Failure)> {
  const kind = rateFileKind(input.fileName, input.bytes);
  if (typeof kind !== "string") return { ok: false, status: 415, error: kind.error };
  let name: string | null = null;
  let grid;
  try {
    if (kind === "xlsx") {
      const chosen = await readRateWorkbook(input.bytes);
      if (!chosen) return { ok: false, status: 422, error: "The workbook has no sheet with anything on it" };
      name = chosen.name;
      grid = chosen.grid;
    } else {
      grid = csvToGrid(new TextDecoder("utf-8").decode(input.bytes));
    }
  } catch {
    return { ok: false, status: 422, error: "Could not read that file. Save it again as .xlsx or .csv." };
  }
  const layout = detectRateLayout(grid);
  if (layout.headerRow == null) {
    return { ok: false, status: 422, error: `I could not find a header row. It needs a ${RATE_FIELD_LABEL.rate} column and an ${RATE_FIELD_LABEL.name} or ${RATE_FIELD_LABEL.sku} column.` };
  }
  const parsed = extractRates(grid, layout.headerRow, layout.map);
  if (parsed.rows.length === 0) return { ok: false, status: 422, error: "No row with an item and a rate was found below the header." };
  return { ok: true, sheet: { ...parsed, sheet: name, header_row: layout.headerRow, map: layout.map } };
}

// ── The workspace's side ─────────────────────────────────────────────────────────────────────────────────────────────

export async function loadPlanContext(tenantId: string, sheetDate: string, today: string = todayKey()): Promise<PlanContext> {
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const cfg = (data?.config ?? {}) as { currency?: unknown; rfq?: RfqConfig };
  return {
    today,
    sheet_date: sheetDate,
    currency: typeof cfg.currency === "string" && /^[A-Za-z]{3}$/.test(cfg.currency) ? cfg.currency.toUpperCase() : null,
    validity_days: rfqConfig(cfg.rfq).price_valid_days,
  };
}

const PRODUCT_COLS = "id, name, sku, uom, cost_price, cost_price_as_of, description, custom_data, status";
const PRODUCT_COLS_NO_DATE = "id, name, sku, uom, cost_price, description, custom_data, status";
const PAGE = 1000;

/** Every product of the workspace. Degrades when cost_price_as_of (migration 0113) is not there yet. */
export async function loadCatalogue(supabase: SupabaseClient, tenantId: string): Promise<{ products: CatalogueProduct[]; hasAsOf: boolean }> {
  for (const [cols, hasAsOf] of [[PRODUCT_COLS, true], [PRODUCT_COLS_NO_DATE, false]] as const) {
    const all: CatalogueProduct[] = [];
    let failed = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("products").select(cols).eq("tenant_id", tenantId).order("created_at").range(from, from + PAGE - 1);
      if (error) {
        if (isMissingRelation(error) && hasAsOf) { failed = true; break; }
        if (isMissingRelation(error)) return { products: [], hasAsOf };
        throw { status: 500, message: error.message };
      }
      for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
        all.push({
          id: String(r.id), name: String(r.name ?? ""), sku: (r.sku as string | null) ?? null, uom: (r.uom as string | null) ?? null,
          cost_price: r.cost_price == null ? null : Number(r.cost_price), cost_price_as_of: (r.cost_price_as_of as string | null | undefined) ?? null,
          description: (r.description as string | null) ?? null, custom_data: (r.custom_data as Record<string, unknown> | null) ?? null, status: (r.status as string | null) ?? null,
        });
      }
      if (!data || data.length < PAGE) break;
    }
    if (!failed) return { products: all, hasAsOf };
  }
  return { products: [], hasAsOf: false };
}

// ── Preview ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildPreview(input: Upload, sheet: Sheet, ctx: PlanContext, products: readonly CatalogueProduct[]): PreviewView {
  const rows = planRows(sheet.rows, products, ctx);
  return {
    file: input.fileName, sheet: sheet.sheet, header_row: sheet.header_row,
    columns: Object.entries(sheet.map).map(([field, column]) => ({ field, label: RATE_FIELD_LABEL[field as keyof typeof RATE_FIELD_LABEL], column: column as number })),
    today: ctx.today, sheet_date: ctx.sheet_date, currency: ctx.currency, validity_days: ctx.validity_days,
    rows, skipped: sheet.skipped.slice(0, 50), skipped_total: sheet.skipped.length, truncated: sheet.truncated,
    counts: {
      rows: rows.length,
      ready: rows.filter((r) => r.default_action === "update").length,
      needs_choice: rows.filter((r) => r.default_action === "skip" && r.status !== "blocked" && r.status !== "duplicate").length,
      not_applied: rows.filter((r) => r.status === "blocked" || r.status === "duplicate").length,
      stale: rows.filter((r) => r.stale).length,
    },
  };
}

export async function previewRateSheet(ctx: RateCtx, input: Upload): Promise<{ ok: true; view: PreviewView } | ({ ok: false } & Failure)> {
  const sheet = await readSheet(input);
  if (!sheet.ok) return sheet;
  const [plan, cat] = await Promise.all([loadPlanContext(ctx.tenantId, input.sheetDate), loadCatalogue(ctx.supabase, ctx.tenantId)]);
  return { ok: true, view: buildPreview(input, sheet.sheet, plan, cat.products) };
}

// ── Apply ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const BATCH = 20;

export async function applyRateSheet(ctx: RateCtx, input: Upload): Promise<{ ok: true; view: ApplyView } | ({ ok: false } & Failure)> {
  const decisions = parseDecisions(input.decisions ?? []);
  if (!decisions) return { ok: false, status: 400, error: "The choices could not be read" };
  const sheet = await readSheet(input);
  if (!sheet.ok) return sheet;
  const plan = await loadPlanContext(ctx.tenantId, input.sheetDate);
  const { products } = await loadCatalogue(ctx.supabase, ctx.tenantId);
  const rows = planRows(sheet.sheet.rows, products, plan);

  const planned = planApply({ rows, decisions: withDefaults(rows, decisions), products, fileName: input.fileName, today: plan.today });
  const outcomes = new Map(planned.outcomes.map((o) => [o.row_no, o]));
  const fail = (rowNo: number, message: string) => {
    const o = outcomes.get(rowNo);
    if (o) outcomes.set(rowNo, { ...o, outcome: "error", message });
  };
  const log: ChangeLogEntryParams[] = [];
  const now = new Date().toISOString();

  const updates = planned.writes.filter((w): w is Extract<typeof w, { kind: "update" }> => w.kind === "update");
  for (let i = 0; i < updates.length; i += BATCH) {
    await Promise.all(updates.slice(i, i + BATCH).map(async (w) => {
      // The id came from THIS workspace's catalogue (planApply checked it); the tenant filter is the backstop.
      const { error } = await ctx.supabase.from("products").update({ ...w.patch, updated_at: now }).eq("id", w.product.id).eq("tenant_id", ctx.tenantId);
      if (error) { fail(w.row.row_no, error.message); return; }
      log.push({
        tenantId: ctx.tenantId, objectType: "products", objectId: w.product.id, objectLabel: plainProductName(w.product.name), action: "update",
        actorId: ctx.userId, actorEmail: ctx.email, changes: [...w.changes, { field: "via", from: null, to: `rate sheet ${input.fileName}` }],
      });
    }));
  }

  const adds = planned.writes.filter((w): w is Extract<typeof w, { kind: "add" }> => w.kind === "add");
  if (adds.length > 0) {
    let inserted: { id: string; name: string; sku: string | null; cost_price: number | null }[] = [];
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = await nextMasterRefSeq(ctx.supabase, "products", ctx.tenantId);
      const res = await ctx.supabase.from("products")
        .insert(adds.map((w, n) => ({ tenant_id: ctx.tenantId, ref: formatMasterRef("products", start + n), ...w.insert })))
        .select("id, name, sku, cost_price");
      error = res.error;
      if (!res.error) { inserted = (res.data ?? []) as typeof inserted; break; }
      if (!isMasterRefCollision(res.error)) break;
    }
    if (error) for (const w of adds) fail(w.row.row_no, error.message);
    for (const p of inserted) {
      log.push({
        tenantId: ctx.tenantId, objectType: "products", objectId: p.id, objectLabel: p.name, action: "create", actorId: ctx.userId, actorEmail: ctx.email,
        changes: [{ field: "sku", from: null, to: p.sku }, { field: "cost_price", from: null, to: p.cost_price }, { field: "via", from: null, to: `rate sheet ${input.fileName}` }],
      });
    }
  }
  await logChangeBatch(ctx.supabase, log);

  const list = planned.outcomes.map((o) => outcomes.get(o.row_no) ?? o);
  return {
    ok: true,
    view: { summary: summarise(list), notes: list.filter((o) => o.outcome === "error" || o.outcome === "unchanged").slice(0, 100), validity_days: plan.validity_days },
  };
}

// ── A sheet to fill in ───────────────────────────────────────────────────────────────────────────────────────────────

/** A CSV the supplier (or the estimator) can fill in: one row for every starter catalogue item this workspace has, rate blank. */
export async function starterRateSheetCsv(ctx: RateCtx): Promise<string> {
  const items = starterCatalogue();
  const plan = await loadPlanContext(ctx.tenantId, todayKey());
  const have = new Set<string>();
  for (let i = 0; i < items.length; i += 100) {
    const { data } = await ctx.supabase.from("products").select("sku").eq("tenant_id", ctx.tenantId).in("sku", items.slice(i, i + 100).map((x) => x.sku));
    for (const r of (data ?? []) as { sku: string | null }[]) if (r.sku) have.add(r.sku);
  }
  const header = ["SKU", "Item name", "Unit", "Rate", "Currency", "Supplier", "As of date"];
  const lines = [header.map(csvCell).join(",")];
  for (const it of items) {
    if (!have.has(it.sku)) continue;
    lines.push([it.sku, it.name, it.uom, "", plan.currency ?? "", "", ""].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
