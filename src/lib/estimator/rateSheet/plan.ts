// What a rate sheet does to the catalogue (slice 3c-2). PURE: given the rows of a sheet, the workspace's products and what the
// person chose, it says which row matches which product and how well, which rows are stale or cannot be applied, and exactly what
// each write would be. The server (server.ts) only reads the products, calls this, and writes the result.
//
// Matching is the BOQ's (src/lib/tender/boq/match.ts): the SKU exactly, the SKU written in the name, then word overlap with the
// product name; here a name that is the same once the "(illustrative)" suffix is ignored is exact too. "exact" and an unambiguous
// "strong" match are the only ones applied without a person choosing; a "possible" match, or none, waits for a choice.
//
// A price is a COST: the product's cost_price. Its date is cost_price_as_of, which the BOQ price sources and the pricing engine
// already read, so an imported rate reaches both without any further wiring. The rate it replaces is kept on the product
// (custom_data.previous_cost) and in the change history.

import { createMatcher, STRONG_SCORE } from "@/lib/tender/boq/match";
import type { MatchProduct } from "@/lib/tender/boq/match";
import { ageDays, staleText } from "@/lib/tender/boq/price";
import { editorUom } from "@/lib/sales/uom";
import { ILLUSTRATIVE_DESCRIPTION, ILLUSTRATIVE_SUFFIX, plainProductName } from "../starterCatalogue";
import type { RateRow } from "./parse";

export type CatalogueProduct = {
  id: string;
  name: string;
  sku: string | null;
  uom: string | null;
  cost_price: number | null;
  cost_price_as_of: string | null;
  description: string | null;
  custom_data: Record<string, unknown> | null;
  status: string | null;
};

export type RowStatus = "exact" | "strong" | "possible" | "none" | "blocked" | "duplicate";
export type RateAction = "update" | "add" | "skip";

export type Suggestion = {
  product_id: string;
  name: string;
  sku: string | null;
  uom: string | null;
  score: number;
  reason: string;
  /** What the catalogue has now, so the person sees the change. */
  current_rate: number | null;
  current_as_of: string | null;
  illustrative: boolean;
};

export type PreviewRow = RateRow & {
  /** The date used for this row: its own, else the sheet's. */
  as_of_used: string;
  stale: boolean;
  stale_text: string | null;
  status: RowStatus;
  /** Why a row is blocked or a default is "skip" (shown in words). */
  reason: string | null;
  suggestions: Suggestion[];
  default_action: RateAction;
  default_product_id: string | null;
  unit_differs: boolean;
};

export type PlanContext = {
  /** Today as YYYY-MM-DD (injected, so a test needs no clock). */
  today: string;
  /** The date a row without one gets. */
  sheet_date: string;
  /** The workspace's currency, or null when it has none set. */
  currency: string | null;
  /** config.rfq.price_valid_days. */
  validity_days: number;
};

const compact = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const UNIT_SYNONYMS: Record<string, string> = {
  sqm: "m2", "sq m": "m2", "sq.m": "m2", "m²": "m2", sqmt: "m2", "sq mtr": "m2",
  cum: "m3", "cu m": "m3", "cu.m": "m3", "m³": "m3", cbm: "m3", "cu mtr": "m3",
  mtr: "m", mtrs: "m", lm: "m", rm: "m", meter: "m", metre: "m", meters: "m", metres: "m",
  nos: "nr", no: "nr", "no.": "nr", each: "nr", ea: "nr", pcs: "nr", pc: "nr", piece: "nr", pieces: "nr",
  kgs: "kg", kilogram: "kg", ton: "t", tons: "t", tonne: "t", tonnes: "t", ltr: "l", litre: "l", liter: "l",
};

/** A unit as a comparable key: "Sqm", "sq.m" and "m²" are the same unit. */
export function unitKey(u: string | null | undefined): string {
  const raw = (u ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return "";
  const via = UNIT_SYNONYMS[raw] ?? UNIT_SYNONYMS[editorUom(raw).toLowerCase()] ?? editorUom(raw).toLowerCase();
  return UNIT_SYNONYMS[via] ?? via;
}

const asMatch = (p: CatalogueProduct): MatchProduct => ({ id: p.id, name: plainProductName(p.name), sku: p.sku, uom: p.uom });

function suggestion(p: CatalogueProduct, score: number, reason: string): Suggestion {
  return {
    product_id: p.id, name: p.name, sku: p.sku, uom: p.uom, score, reason,
    current_rate: p.cost_price, current_as_of: p.cost_price_as_of, illustrative: p.custom_data?.illustrative === true,
  };
}

/** Does the date lie in the future? (A "valid from" date a long way ahead is not a price date.) */
const inFuture = (date: string, today: string) => date > today;

/**
 * Classify every row of a sheet against the workspace's products. Nothing is written. The default action of a row is what the
 * person gets if they press Apply without choosing: update the exact or strong match, skip everything else.
 */
export function planRows(rows: readonly RateRow[], products: readonly CatalogueProduct[], ctx: PlanContext): PreviewRow[] {
  const active = products.filter((p) => p.status !== "inactive");
  const byId = new Map(active.map((p) => [p.id, p]));
  const match = createMatcher(active.map(asMatch));
  const byName = new Map<string, CatalogueProduct[]>();
  for (const p of active) {
    const k = compact(plainProductName(p.name));
    if (k.length >= 3) byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  const seenItem = new Map<string, number>();
  const taken = new Map<string, number>();
  const out: PreviewRow[] = [];

  for (const row of rows) {
    const asOf = row.as_of && !inFuture(row.as_of, ctx.today) ? row.as_of : ctx.sheet_date;
    const age = ageDays(asOf, ctx.today);
    const stale = age != null && age > ctx.validity_days;
    const base = {
      ...row, as_of_used: asOf, stale, stale_text: stale ? staleText(asOf, ctx.today) : null,
      status: "none" as RowStatus, reason: null as string | null, suggestions: [] as Suggestion[],
      default_action: "skip" as RateAction, default_product_id: null as string | null, unit_differs: false,
    };

    // A row the workspace cannot take: a currency it does not use.
    if (ctx.currency && row.currency && row.currency !== ctx.currency) {
      out.push({ ...base, status: "blocked", reason: `The sheet is in ${row.currency}; this workspace works in ${ctx.currency}. Convert the rate first.` });
      continue;
    }
    if (row.currency_unreadable) {
      out.push({ ...base, status: "blocked", reason: "The currency is not a three-letter code (for example SAR)." });
      continue;
    }

    // The same item twice in one sheet: the first is used, so two prices never fight over one product.
    const itemKey = compact(row.sku).length >= 3 ? `s:${compact(row.sku)}` : `n:${compact(row.name)}`;
    const earlier = seenItem.get(itemKey);
    if (earlier != null) {
      out.push({ ...base, status: "duplicate", reason: `The same item as row ${earlier}; the first one is used.` });
      continue;
    }
    seenItem.set(itemKey, row.row_no);

    const found = match({ description: row.name, cost_code: row.sku, uom: row.uom }, 3);
    const named = byName.get(compact(row.name));
    const sugg: Suggestion[] = [];
    if (named && named.length === 1 && compact(row.name).length >= 3) sugg.push(suggestion(named[0], 100, "Same name"));
    for (const f of found) {
      const p = byId.get(f.product_id);
      if (p && !sugg.some((s) => s.product_id === p.id)) sugg.push(suggestion(p, f.score, f.reason));
    }
    sugg.sort((a, b) => b.score - a.score);
    const top = sugg[0];
    const ambiguous = !!top && !!sugg[1] && sugg[1].score === top.score;

    let status: RowStatus = "none";
    if (top) status = top.score >= 100 && !ambiguous ? "exact" : top.score >= STRONG_SCORE && !ambiguous ? "strong" : "possible";

    const topProduct = top ? byId.get(top.product_id)! : null;
    const unitDiffers = !!(topProduct && row.uom && topProduct.uom && unitKey(row.uom) !== unitKey(topProduct.uom));
    let action: RateAction = "skip";
    let productId: string | null = null;
    let reason: string | null = null;
    if (top && (status === "exact" || status === "strong")) {
      if (unitDiffers) reason = `The unit differs (sheet: ${row.uom}, catalogue: ${topProduct!.uom}). Check it, then choose Update.`;
      else if (taken.has(top.product_id)) reason = `Row ${taken.get(top.product_id)} already updates this item.`;
      else { action = "update"; productId = top.product_id; taken.set(top.product_id, row.row_no); }
    }
    out.push({ ...base, status, reason, suggestions: sugg.slice(0, 3), default_action: action, default_product_id: productId, unit_differs: unitDiffers });
  }
  return out;
}

// ── What the person chose ────────────────────────────────────────────────────────────────────────────────────────────

export type Decision = { row: number; action: RateAction; product_id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DECISIONS = 2000;

/** The decisions of a request body: only known actions, one per row (the last wins), a product id shaped like one. Null when unusable. */
export function parseDecisions(input: unknown): Decision[] | null {
  if (!Array.isArray(input) || input.length > MAX_DECISIONS) return null;
  const byRow = new Map<number, Decision>();
  for (const d of input as unknown[]) {
    if (!d || typeof d !== "object") return null;
    const o = d as Record<string, unknown>;
    const row = Number(o.row);
    if (!Number.isInteger(row) || row < 1) return null;
    if (o.action !== "update" && o.action !== "add" && o.action !== "skip") return null;
    if (o.action === "update") {
      if (typeof o.product_id !== "string" || !UUID.test(o.product_id)) return null;
      byRow.set(row, { row, action: "update", product_id: o.product_id });
    } else byRow.set(row, { row, action: o.action });
  }
  return [...byRow.values()];
}

/** Defaults for the rows nobody decided: update the exact and strong matches, skip the rest. */
export function withDefaults(rows: readonly PreviewRow[], decisions: readonly Decision[]): Decision[] {
  const chosen = new Map(decisions.map((d) => [d.row, d]));
  return rows.map((r): Decision => chosen.get(r.row_no) ?? (r.default_action === "update" && r.default_product_id
    ? { row: r.row_no, action: "update", product_id: r.default_product_id } : { row: r.row_no, action: "skip" }));
}

export type RowOutcome = { row_no: number; name: string; outcome: "updated" | "added" | "unchanged" | "skipped" | "error"; message: string | null; stale: boolean };

export type UpdateWrite = { kind: "update"; row: PreviewRow; product: CatalogueProduct; patch: Record<string, unknown>; changes: { field: string; from: unknown; to: unknown }[] };
export type AddWrite = { kind: "add"; row: PreviewRow; insert: Record<string, unknown> };
export type Plan = { writes: (UpdateWrite | AddWrite)[]; outcomes: RowOutcome[]; error: string | null };

export type ApplyInput = {
  rows: readonly PreviewRow[];
  decisions: readonly Decision[];
  products: readonly CatalogueProduct[];
  fileName: string;
  today: string;
};

const sourceText = (row: PreviewRow, fileName: string) => (row.note ? row.note : `Rate sheet ${fileName}`).slice(0, 120);

/** The product columns an update writes, with the one-step history of what it replaces. */
export function updatePatch(product: CatalogueProduct, row: PreviewRow, fileName: string, today: string): { patch: Record<string, unknown>; changes: UpdateWrite["changes"] } {
  const before = product.custom_data ?? {};
  const source = sourceText(row, fileName);
  const custom: Record<string, unknown> = { ...before };
  delete custom.illustrative;
  custom.cost_source = source;
  if (row.supplier) custom.cost_supplier = row.supplier; else delete custom.cost_supplier;
  custom.previous_cost = {
    cost_price: product.cost_price, as_of: product.cost_price_as_of, source: typeof before.cost_source === "string" ? before.cost_source : null,
    supplier: typeof before.cost_supplier === "string" ? before.cost_supplier : null, replaced_on: today,
  };
  custom.rate_sheet = { file: fileName.slice(0, 120), row: row.row_no, imported_on: today };

  const patch: Record<string, unknown> = { cost_price: row.rate, cost_price_as_of: row.as_of_used, custom_data: custom };
  const changes: UpdateWrite["changes"] = [];
  if (product.cost_price !== row.rate) changes.push({ field: "cost_price", from: product.cost_price, to: row.rate });
  if (product.cost_price_as_of !== row.as_of_used) changes.push({ field: "cost_price_as_of", from: product.cost_price_as_of, to: row.as_of_used });
  if (before.cost_source !== source) changes.push({ field: "cost source", from: before.cost_source ?? null, to: source });
  if ((before.cost_supplier ?? null) !== (row.supplier ?? null)) changes.push({ field: "cost supplier", from: before.cost_supplier ?? null, to: row.supplier ?? null });
  if (before.illustrative === true) {
    changes.push({ field: "illustrative", from: true, to: false });
    if (product.name.endsWith(ILLUSTRATIVE_SUFFIX)) {
      patch.name = plainProductName(product.name);
      changes.push({ field: "name", from: product.name, to: patch.name });
    }
    if (product.description === ILLUSTRATIVE_DESCRIPTION) {
      patch.description = null;
      changes.push({ field: "description", from: product.description, to: null });
    }
  }
  return { patch, changes };
}

/** The product an "add as new item" creates (before tenant_id and ref). */
export function addInsert(row: PreviewRow, fileName: string): Record<string, unknown> {
  const custom: Record<string, unknown> = { cost_source: sourceText(row, fileName), rate_sheet: { file: fileName.slice(0, 120), row: row.row_no } };
  if (row.supplier) custom.cost_supplier = row.supplier;
  return {
    name: row.name, sku: row.sku, uom: row.uom, cost_price: row.rate, cost_price_as_of: row.as_of_used, status: "active", custom_data: custom,
  };
}

/**
 * Turn the person's choices into writes. Everything is checked first and nothing is half-decided: a choice that cannot be honoured
 * (a blocked or repeated row, a product that is not this workspace's, two rows for one product, a SKU already in the catalogue) is
 * reported on its row and that row is left alone; the rest go ahead.
 */
export function planApply(input: ApplyInput): Plan {
  const byId = new Map(input.products.map((p) => [p.id, p]));
  const skus = new Set(input.products.map((p) => compact(p.sku)).filter(Boolean));
  const choice = new Map(input.decisions.map((d) => [d.row, d]));
  const writes: Plan["writes"] = [];
  const outcomes: RowOutcome[] = [];
  const claimed = new Map<string, number>();
  const addedSkus = new Set<string>();

  for (const row of input.rows) {
    const d = choice.get(row.row_no) ?? { row: row.row_no, action: "skip" as RateAction };
    const out = (outcome: RowOutcome["outcome"], message: string | null = null) =>
      outcomes.push({ row_no: row.row_no, name: row.name, outcome, message, stale: row.stale });
    if (d.action === "skip") { out("skipped"); continue; }
    if (row.status === "blocked" || row.status === "duplicate") { out("error", row.reason); continue; }

    if (d.action === "update") {
      const product = d.product_id ? byId.get(d.product_id) : undefined;
      if (!product) { out("error", "That item is not in this catalogue."); continue; }
      if (claimed.has(product.id)) { out("error", `Row ${claimed.get(product.id)} already updates this item.`); continue; }
      claimed.set(product.id, row.row_no);
      const { patch, changes } = updatePatch(product, row, input.fileName, input.today);
      if (changes.length === 0) { out("unchanged", "The catalogue already has this rate and date."); continue; }
      writes.push({ kind: "update", row, product, patch, changes });
      out("updated");
      continue;
    }

    // add
    const key = compact(row.sku);
    if (key && (skus.has(key) || addedSkus.has(key))) { out("error", "A catalogue item with this SKU already exists. Choose Update and pick it."); continue; }
    if (key) addedSkus.add(key);
    writes.push({ kind: "add", row, insert: addInsert(row, input.fileName) });
    out("added");
  }
  return { writes, outcomes, error: null };
}

export function summarise(outcomes: readonly RowOutcome[]): { updated: number; added: number; unchanged: number; skipped: number; errors: number; stale: number } {
  const n = (o: RowOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  return {
    updated: n("updated"), added: n("added"), unchanged: n("unchanged"), skipped: n("skipped"), errors: n("error"),
    stale: outcomes.filter((x) => (x.outcome === "updated" || x.outcome === "added") && x.stale).length,
  };
}
