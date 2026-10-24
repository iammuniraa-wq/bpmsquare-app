import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import { priceDocumentLine } from "@/lib/pricing/quoteLine";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { insertLinesTolerant, writeHeaderTolerant, resolveLineIdsAndSelection } from "@/lib/pricing/quoteLineFlags";
import { documentTotal } from "@/lib/sales/lineTotals";
import { insertWithMasterRef } from "@/lib/masterRef";
import type { TenantConfig } from "@/lib/constants";
import type { Estimate, EstimateLine, EstimateTemplate, EstimateTotals } from "@/lib/types";
import { computeEstimate, summariseLines, roundMoney } from "./compute";
import type { ComputeSuccess, ScheduleQty, ComputedLine } from "./compute";
import { applyOverrides, readOverride } from "./overrides";
import {
  normaliseLine, persistLine, toSummarisable, toQuoteSource, templateGroupNames, unpricedCodes,
  skuOf, reusableCosts, scheduleFromLines, snapshotOf, type PersistLine, type ProductSnapshot,
} from "./lines";
import { betterProduct, indexByKey, isKitType, kitDecision, type CatalogueProduct, type KitCost } from "./productItems";
import { isMatchKey, parseMatchKey } from "./productMatch";
import { loadBomGraph, rollUpFor } from "@/lib/products/bomServer";
import {
  buildQuoteLines, alternativesInput, tagAlternatives, plainRows, quoteBlockers,
  type AlternativeSet, type QuoteRowDraft,
} from "./quoteLines";
import type { EstimateTemplateBody } from "./types";
import type { EstimateParams, TemplateIssue } from "./template";
import type { ListParams } from "./requests";

// Estimator server core (0131, docs/estimator-architecture.md §4). Estimate
// tables carry the standard tenant-isolation RLS, so the routes use the SESSION
// client and still chain .eq("tenant_id", tenantId) on every query
// (MULTI_TENANT_GUARDRAILS.md); the quote assembler uses the service-role
// client like the Fence assembler does, and chains the tenant filter on each
// query it makes. Every foreign id (account, contact, template, product) is
// verified against the tenant before it is used.

export const PENDING_MESSAGE = "Estimates are waiting for a database update (migration 0131 has not been applied to this database).";

/** A table or column the database does not have yet (migration pending). */
export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? "");
}

// ── Access ───────────────────────────────────────────────────────────────────

export type EstimatorAction = "view" | "create" | "edit" | "delete";

export type EstimatorCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
};

/**
 * Route guard: signed in, the tenant owns the estimator module (404 otherwise,
 * so the endpoint does not advertise itself), and the Estimates workcenter
 * grants the action. Throws {status, message}.
 */
export async function estimatorAccess(action: EstimatorAction): Promise<EstimatorCtx> {
  const a = await requireTenantUser();
  if (!(await tenantOwnsObject(a.tenantId, "estimates"))) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const allowed = action === "view" ? canViewWorkcenter(perms, "estimates")
    : action === "create" ? canCreateWorkcenter(perms, "estimates")
    : action === "edit" ? canEditWorkcenter(perms, "estimates")
    : canDeleteWorkcenter(perms, "estimates");
  if (!allowed) throw { status: 403, message: "Forbidden" };
  const user = await getAuthUser();
  return { ...a, email: user?.email ?? null };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  if (typeof err.status !== "number") console.error("estimator route failed:", e);
  return Response.json({ error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error" }, { status: err.status ?? 500 });
}

export function pendingResponse(): Response {
  return Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });
}

// ── Tenant settings ──────────────────────────────────────────────────────────

export type TenantMeta = { vat_pct: number; currency: string | null };

/** VAT from the tenant's tax settings (0 when none) and its currency. */
export async function loadTenantMeta(tenantId: string): Promise<TenantMeta> {
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const cfg = (data?.config ?? {}) as Partial<TenantConfig> & { currency?: string };
  const rate = Number(cfg.tax?.rate);
  return {
    vat_pct: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0,
    currency: typeof cfg.currency === "string" && cfg.currency ? cfg.currency : null,
  };
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export type Loaded<T> = { data: T | null; missing: boolean };

const PAGE = 1000;

export function templateBody(t: Pick<EstimateTemplate, "geometry" | "inputs" | "rates" | "rules">): EstimateTemplateBody {
  return { ...(t.geometry ? { geometry: t.geometry } : {}), inputs: t.inputs ?? [], rates: t.rates ?? [], rules: t.rules ?? [] };
}

export async function loadTemplate(supabase: SupabaseClient, tenantId: string, id: string): Promise<Loaded<EstimateTemplate>> {
  const { data, error } = await supabase.from("estimate_templates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  return { data: (data as EstimateTemplate | null) ?? null, missing: false };
}

export async function loadEstimate(supabase: SupabaseClient, tenantId: string, id: string): Promise<Loaded<Estimate>> {
  const { data, error } = await supabase.from("estimates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  const row = data as Estimate | null;
  return { data: row ? { ...row, margin_pct: Number(row.margin_pct ?? 0) } : null, missing: false };
}

/** Every line of an estimate, in order (paged: a schedule can run past 1000). */
export async function loadLines(supabase: SupabaseClient, tenantId: string, estimateId: string): Promise<EstimateLine[]> {
  const out: EstimateLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("estimate_lines").select("*")
      .eq("tenant_id", tenantId).eq("estimate_id", estimateId)
      .order("sort_order").order("created_at").order("id")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]).map(normaliseLine));
    if (data.length < PAGE) break;
  }
  return out;
}

export type ListedEstimate = {
  id: string; ref: string | null; name: string; status: string;
  account_id: string | null; account_name: string | null; contact_id: string | null;
  template_id: string | null; template_name: string | null; template_version: number | null;
  currency: string | null; margin_pct: number; totals: EstimateTotals | null;
  standard_quote_id: string | null; created_at: string; updated_at: string;
};

export async function listEstimates(
  supabase: SupabaseClient, tenantId: string, p: ListParams
): Promise<{ rows: ListedEstimate[]; total: number; missing: boolean }> {
  let q = supabase
    .from("estimates")
    .select("id, ref, name, status, account_id, contact_id, template_id, template_version, currency, margin_pct, totals, standard_quote_id, created_at, updated_at, accounts(name), estimate_templates(name)", { count: "exact" })
    .eq("tenant_id", tenantId);
  if (p.status) q = q.eq("status", p.status);
  if (p.account_id) q = q.eq("account_id", p.account_id);
  if (p.template_id) q = q.eq("template_id", p.template_id);
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q
    .order(p.sort, { ascending: p.dir === "asc" })
    .order("id")
    .range(from, from + p.page_size - 1);
  if (error) {
    if (isMissingRelation(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: error.message };
  }
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const { accounts, estimate_templates, ...rest } = r;
    return {
      ...(rest as unknown as ListedEstimate),
      margin_pct: Number(r.margin_pct ?? 0),
      account_name: one(accounts as { name: string } | { name: string }[] | null)?.name ?? null,
      template_name: one(estimate_templates as { name: string } | { name: string }[] | null)?.name ?? null,
    };
  });
  return { rows, total: count ?? rows.length, missing: false };
}

export type EstimateBundle = {
  estimate: Estimate;
  lines: EstimateLine[];
  /** Null when the template was deleted since the estimate was made. */
  template: EstimateTemplate | null;
  /** The estimate was made from an older version of its template. */
  template_outdated: boolean;
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  quote: { id: string; ref: string; status: string } | null;
};

/** Everything an estimate screen needs, in one tenant-scoped read. */
export async function loadEstimateBundle(supabase: SupabaseClient, tenantId: string, id: string): Promise<{ bundle: EstimateBundle | null; missing: boolean }> {
  const est = await loadEstimate(supabase, tenantId, id);
  if (!est.data) return { bundle: null, missing: est.missing };
  const e = est.data;
  const [lines, tpl, account, contact, quote] = await Promise.all([
    loadLines(supabase, tenantId, id),
    e.template_id ? loadTemplate(supabase, tenantId, e.template_id) : Promise.resolve<Loaded<EstimateTemplate>>({ data: null, missing: false }),
    e.account_id ? supabase.from("accounts").select("id, name").eq("id", e.account_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    e.contact_id ? supabase.from("contacts").select("id, name").eq("id", e.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    e.standard_quote_id ? supabase.from("standard_quotes").select("id, ref, status").eq("id", e.standard_quote_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    missing: false,
    bundle: {
      estimate: e,
      lines,
      template: tpl.data,
      template_outdated: !!tpl.data && e.template_version !== null && e.template_version < tpl.data.version,
      account: (account.data as { id: string; name: string } | null) ?? null,
      contact: (contact.data as { id: string; name: string } | null) ?? null,
      quote: (quote.data as { id: string; ref: string; status: string } | null) ?? null,
    },
  };
}

// ── Foreign id verification ──────────────────────────────────────────────────

/** Every id that is not this tenant's row is reported by name; null = all good. */
export async function verifyForeignIds(
  supabase: SupabaseClient, tenantId: string,
  ids: { account_id?: string | null; contact_id?: string | null; template_id?: string | null; product_id?: string | null }
): Promise<string | null> {
  const checks: [string, string, string | null | undefined][] = [
    ["accounts", "Account", ids.account_id], ["contacts", "Contact", ids.contact_id],
    ["estimate_templates", "Template", ids.template_id], ["products", "Product", ids.product_id],
  ];
  for (const [table, label, id] of checks) {
    if (!id) continue;
    const { data, error } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error && isMissingRelation(error)) continue;
    if (!data) return `${label} not found.`;
  }
  return null;
}

// ── Pricing (the two-pass flow from the E1 hand-off) ─────────────────────────

const PRODUCT_COLS = "id, sku, ref, name, item_type, uom, cost_price, status, created_at";
// Before migration 0133 there is no item_type column: read without it.
const PRODUCT_COLS_NO_TYPE = "id, sku, ref, name, uom, cost_price, status, created_at";

type PgResult = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
type ProductQuery = { in: (col: string, vals: string[]) => PgResult };

/** Tenant-scoped product read that degrades when the item_type column is not there yet. */
async function readProducts(supabase: SupabaseClient, tenantId: string, narrow: (q: ProductQuery) => PgResult): Promise<CatalogueProduct[]> {
  for (const cols of [PRODUCT_COLS, PRODUCT_COLS_NO_TYPE]) {
    const { data, error } = await narrow(supabase.from("products").select(cols).eq("tenant_id", tenantId) as unknown as ProductQuery);
    if (!error) return toCatalogueProducts(data);
    if (!isMissingRelation(error)) return [];
  }
  return [];
}

export function toCatalogueProducts(data: unknown): CatalogueProduct[] {
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), sku: (r.sku as string | null) ?? null, ref: (r.ref as string | null) ?? null, name: String(r.name ?? ""),
    item_type: (r.item_type as string | null | undefined) ?? null, uom: (r.uom as string | null) ?? null,
    cost_price: r.cost_price === null || r.cost_price === undefined ? null : Number(r.cost_price),
    status: (r.status as string | null) ?? null, created_at: (r.created_at as string | null) ?? null,
  }));
}

export type ResolvedProducts = { byKey: Map<string, CatalogueProduct>; byId: Map<string, CatalogueProduct> };

/**
 * The tenant's products behind a set of template keys (a SKU or a product
 * reference) and ids. Every read is tenant-scoped; an id that is not this
 * tenant's simply does not come back. If a key is on several products an active
 * one wins, then the oldest, so the answer does not change between runs.
 */
export async function resolveProducts(supabase: SupabaseClient, tenantId: string, keys: string[], ids: string[] = []): Promise<ResolvedProducts> {
  const allKeys = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  const uniqueKeys = allKeys.filter((k) => !isMatchKey(k));
  const matchKeys = allKeys.filter(isMatchKey);
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const found: CatalogueProduct[] = [];
  for (let i = 0; i < uniqueKeys.length; i += 100) {
    const chunk = uniqueKeys.slice(i, i + 100);
    found.push(...await readProducts(supabase, tenantId, (q) => q.in("sku", chunk)));
    const refs = [...new Set([...chunk, ...chunk.map((k) => k.toUpperCase())])];
    found.push(...await readProducts(supabase, tenantId, (q) => q.in("ref", refs)));
  }
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    found.push(...await readProducts(supabase, tenantId, (q) => q.in("id", chunk)));
  }
  // Rules that name their product by catalogue attributes: one tenant-scoped read per distinct match.
  const byMatch = new Map<string, CatalogueProduct>();
  for (let i = 0; i < matchKeys.length; i += 6) {
    await Promise.all(matchKeys.slice(i, i + 6).map(async (key) => {
      const attrs = parseMatchKey(key);
      if (!attrs) return;
      const hits = await readProductsByAttrs(supabase, tenantId, attrs);
      let best: CatalogueProduct | undefined;
      for (const p of hits) best = betterProduct(best, p);
      if (best) { byMatch.set(key, best); found.push(best); }
    }));
  }
  const byId = new Map<string, CatalogueProduct>();
  for (const p of found) byId.set(p.id, p);
  const byKey = indexByKey([...byId.values()], uniqueKeys);
  for (const [k, p] of byMatch) byKey.set(k, p);
  return { byKey, byId };
}

/** The tenant's products whose `custom_data` carries every attribute (text equality). */
export async function readProductsByAttrs(supabase: SupabaseClient, tenantId: string, attrs: Record<string, string>): Promise<CatalogueProduct[]> {
  for (const cols of [PRODUCT_COLS, PRODUCT_COLS_NO_TYPE]) {
    let q = supabase.from("products").select(cols).eq("tenant_id", tenantId);
    for (const [k, v] of Object.entries(attrs)) q = q.eq(`custom_data->>${k}`, v);
    const { data, error } = await q.limit(50);
    if (!error) return toCatalogueProducts(data);
    if (!isMissingRelation(error)) return [];
  }
  return [];
}

/**
 * The rolled-up cost of each BOM / kit among these products, from the products
 * module's own roll-up (`rollUpBom`, the function behind "Apply to product
 * cost"). A kit with no components, or a database without the BOM table (0133
 * pending), is simply absent: it is then costed like any other product.
 */
export async function loadKitCosts(supabase: SupabaseClient, tenantId: string, products: readonly CatalogueProduct[]): Promise<Map<string, KitCost>> {
  const out = new Map<string, KitCost>();
  const kits = [...new Map(products.filter((p) => isKitType(p.item_type)).map((p) => [p.id, p])).values()];
  if (kits.length === 0) return out;
  try {
    const graph = await loadBomGraph(supabase, tenantId, kits[0].id, kits.slice(1).map((k) => k.id));
    for (const k of kits) {
      if (graph.getLines(k.id).length === 0) continue;
      const r = rollUpFor(graph, k.id);
      out.set(k.id, { total: r.total, incomplete: r.incomplete, missing: r.missing.map((m) => m.name) });
    }
  } catch {
    // The BOM tables are not readable: price the kits from their stored cost.
  }
  return out;
}

export type PricingSource = "engine" | "product_cost" | "kit_rollup" | "reused";

/** What pricing found out about the product behind a rule line. */
export type PricedProduct = { id: string; name: string; sku: string | null; ref: string | null; item_type: string | null; kit_incomplete: boolean };

export type PriceOutcome = {
  unit_costs: Record<string, number>;
  product_ids: Record<string, string>;
  products: Record<string, PricedProduct>;
  sources: Record<string, PricingSource>;
  unresolved: string[];
  unpriced: string[];
  warnings: string[];
};

const PRICE_CONCURRENCY = 6;

export type PriceNeed = {
  code: string;
  /** A SKU or a product reference, as the template wrote it. */
  sku?: string;
  /** A catalogue pick: already a product id (still checked against the tenant). */
  productId?: string;
  qty: number;
};

/**
 * Price the product-backed lines that came back `needs_price`: the key (SKU or
 * product reference) names a product in this tenant's catalogue. A BOM / kit with
 * components is costed from its rolled-up components; any other product goes
 * through `priceDocumentLine()` (the same call Standard Quotes and Fence make) and
 * when the engine has nothing for it (no price book, or no cost on file) the
 * product's own cost_price is the internal cost. A key with no product, or a
 * product with neither, is reported rather than guessed.
 */
export async function priceProductRules(
  supabase: SupabaseClient, tenantId: string,
  args: { estimateId: string | null; accountId: string | null; needs: PriceNeed[]; catalogueOnly?: boolean }
): Promise<PriceOutcome> {
  const out: PriceOutcome = { unit_costs: {}, product_ids: {}, products: {}, sources: {}, unresolved: [], unpriced: [], warnings: [] };
  if (args.needs.length === 0) return out;
  const { byKey, byId } = await resolveProducts(
    supabase, tenantId, args.needs.map((n) => n.sku ?? "").filter(Boolean), args.needs.map((n) => n.productId ?? "").filter(Boolean)
  );
  const kitCosts = await loadKitCosts(supabase, tenantId, [...byId.values()]);
  const notes = new Set<string>();

  const one = async (n: PriceNeed) => {
    const product = (n.productId ? byId.get(n.productId) : undefined) ?? (n.sku ? byKey.get(n.sku.trim()) : undefined);
    if (!product) { out.unresolved.push(n.code); return; }
    const kit = kitCosts.get(product.id) ?? null;
    const decision = kitDecision(product.name, kit);
    if (decision.note) notes.add(decision.note);
    out.product_ids[n.code] = product.id;
    out.products[n.code] = { id: product.id, name: product.name, sku: product.sku, ref: product.ref, item_type: product.item_type, kit_incomplete: !!kit?.incomplete };

    if (decision.cost !== null) {
      out.unit_costs[n.code] = decision.cost;
      out.sources[n.code] = "kit_rollup";
      return;
    }
    // A preview must leave nothing behind, and every engine call stores a
    // pricing document and a meter row, so it prices from the product's own cost.
    if (!args.catalogueOnly) {
      try {
        const priced = await priceDocumentLine(tenantId, {
          productId: product.id, accountId: args.accountId, quantity: n.qty > 0 ? n.qty : 1,
          documentType: "standard_quote", sourceId: args.estimateId,
        });
        if (priced.ok && Number.isFinite(priced.unit_rate) && priced.unit_rate >= 0) {
          out.unit_costs[n.code] = priced.unit_rate;
          out.sources[n.code] = "engine";
          return;
        }
        if (!priced.ok) notes.add(`No engine price for ${product.name}.`);
      } catch {
        notes.add("The pricing engine is not available for this workspace.");
      }
    }
    const cost = product.cost_price;
    if (cost !== null && Number.isFinite(cost) && cost > 0) {
      out.unit_costs[n.code] = cost;
      out.sources[n.code] = "product_cost";
    } else {
      out.unpriced.push(n.code);
    }
  };

  for (let i = 0; i < args.needs.length; i += PRICE_CONCURRENCY) {
    await Promise.all(args.needs.slice(i, i + PRICE_CONCURRENCY).map(one));
  }
  if (args.catalogueOnly) out.warnings.push("Priced from the catalogue's own costs. The saved estimate uses your pricing engine where it has a price.");
  else if (Object.values(out.sources).includes("product_cost")) out.warnings.push("Some product lines use the product's own cost because the pricing engine had no price for them.");
  out.warnings.push(...notes);
  return out;
}

export type CalcInput = {
  tenantId: string;
  estimateId: string | null;
  accountId: string | null;
  template: EstimateTemplateBody;
  params: Record<string, unknown>;
  margin_pct: number;
  vat_pct: number;
  schedule?: ScheduleQty[];
  /** Unit costs to keep instead of pricing again (a margin-only change). */
  reuse?: Record<string, number>;
  reuseProducts?: Record<string, string>;
  /** Price product lines from the catalogue's own cost, never the pricing engine (the live preview: it stores nothing). */
  catalogueOnly?: boolean;
};

export type CalcOutput =
  | { ok: true; result: ComputeSuccess; pricing: PriceOutcome }
  | { ok: false; issues: TemplateIssue[] };

/** Pass 1 quantities, price what needs a price, pass 2 with the unit costs. */
export async function computeAndPrice(supabase: SupabaseClient, input: CalcInput): Promise<CalcOutput> {
  const base = { margin_pct: input.margin_pct, vat_pct: input.vat_pct, schedule: input.schedule };
  const first = computeEstimate(input.template, input.params, { ...base, unit_costs: input.reuse });
  if (!first.ok) return { ok: false, issues: first.issues };

  const pricing: PriceOutcome = {
    unit_costs: { ...(input.reuse ?? {}) }, product_ids: { ...(input.reuseProducts ?? {}) }, products: {},
    sources: Object.fromEntries(Object.keys(input.reuse ?? {}).map((c) => [c, "reused" as const])),
    unresolved: [], unpriced: [], warnings: [],
  };
  if (first.unpriced.length > 0) {
    const needs = first.unpriced.map((code) => {
      const lines = first.lines.filter((l) => l.code === code);
      return { code, sku: lines[0]?.sku ?? "", qty: lines.reduce((a, l) => a + l.qty_gross, 0) };
    }).filter((n) => n.sku);
    const priced = await priceProductRules(supabase, input.tenantId, { estimateId: input.estimateId, accountId: input.accountId, needs, catalogueOnly: input.catalogueOnly });
    Object.assign(pricing.unit_costs, priced.unit_costs);
    Object.assign(pricing.product_ids, priced.product_ids);
    Object.assign(pricing.products, priced.products);
    Object.assign(pricing.sources, priced.sources);
    pricing.unresolved = priced.unresolved;
    pricing.unpriced = priced.unpriced;
    pricing.warnings = priced.warnings;
  }

  const second = Object.keys(pricing.unit_costs).length > 0
    ? computeEstimate(input.template, input.params, { ...base, unit_costs: pricing.unit_costs })
    : first;
  if (!second.ok) return { ok: false, issues: second.issues };
  return { ok: true, result: second, pricing };
}

// ── Recompute + persistence ──────────────────────────────────────────────────

const labelOf = (l: ComputedLine, ruleDescription: Map<string, string>): string | null => {
  if (l.source !== "schedule") return null;
  const base = ruleDescription.get(l.code) ?? "";
  return base && l.description.startsWith(`${base} - `) ? l.description.slice(base.length + 3) : null;
};

const CHUNK = 500;

type SaveArgs = {
  supabase: SupabaseClient; tenantId: string; estimate: Estimate;
  result: ComputeSuccess; pricing: PriceOutcome; template: EstimateTemplate;
  oldLines: EstimateLine[]; vat_pct: number; currency: string | null;
};

/**
 * Replace the estimate's computed (rule/schedule) lines with the new ones and
 * keep its manual lines; then total everything and save the estimate. The new
 * lines are inserted BEFORE the old ones are removed, so a failed insert leaves
 * the estimate as it was.
 */
async function saveComputation(a: SaveArgs): Promise<{ lines: EstimateLine[]; totals: EstimateTotals; dropped: string[] }> {
  const { supabase, tenantId, estimate, result, pricing, template, oldLines } = a;
  const oldComputed = oldLines.filter((l) => l.source !== "manual");
  const manual = oldLines.filter((l) => l.source === "manual");
  const ruleDescription = new Map(template.rules.map((r) => [r.code, r.description]));

  // What a priced line learned about its product rides on the line. A recalculation
  // that did not reprice keeps the snapshot the old line already had.
  const oldSnapshot = new Map<string, ProductSnapshot>();
  for (const o of oldComputed) { const snap = o.code ? snapshotOf(o) : null; if (o.code && snap && !oldSnapshot.has(o.code)) oldSnapshot.set(o.code, snap); }
  const snapshotFor = (code: string): ProductSnapshot | null => {
    const p = pricing.products[code];
    return p ? { sku: p.sku, ref: p.ref, kit_incomplete: p.kit_incomplete } : (oldSnapshot.get(code) ?? null);
  };
  const fresh = result.lines.map((l) => persistLine(l, pricing.product_ids[l.code] ?? null, labelOf(l, ruleDescription), snapshotFor(l.code)));
  const { rows, dropped } = applyOverrides<PersistLine>(fresh, oldComputed);
  const n = rows.length;

  const toInsert = rows.map((r, i) => ({
    tenant_id: tenantId, estimate_id: estimate.id,
    sort_order: i + 1, code: r.code, group_key: r.group_key, description: r.description, uom: r.uom,
    qty: r.qty, waste_pct: r.waste_pct, unit_cost: r.unit_cost, cost_total: r.cost_total,
    component: r.component, product_id: r.product_id, source: r.source, element_ref: r.element_ref,
    wbs_code: r.wbs_code, custom_data: r.custom_data,
  }));
  const insertedIds: string[] = [];
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { data, error } = await supabase.from("estimate_lines").insert(toInsert.slice(i, i + CHUNK)).select("id");
    if (error) {
      if (insertedIds.length > 0) await supabase.from("estimate_lines").delete().eq("tenant_id", tenantId).in("id", insertedIds);
      throw { status: isMissingRelation(error) ? 503 : 500, message: isMissingRelation(error) ? PENDING_MESSAGE : error.message };
    }
    insertedIds.push(...((data ?? []) as { id: string }[]).map((x) => x.id));
  }

  const oldIds = oldComputed.map((l) => l.id);
  for (let i = 0; i < oldIds.length; i += 200) {
    const { error } = await supabase.from("estimate_lines").delete().eq("tenant_id", tenantId).eq("estimate_id", estimate.id).in("id", oldIds.slice(i, i + 200));
    if (error) {
      await supabase.from("estimate_lines").delete().eq("tenant_id", tenantId).in("id", insertedIds);
      throw { status: 500, message: `Could not replace the old lines: ${error.message}` };
    }
  }

  // Manual lines sit after the computed ones, in their existing order.
  for (let i = 0; i < manual.length; i++) {
    const want = n + i + 1;
    if (manual[i].sort_order !== want) {
      await supabase.from("estimate_lines").update({ sort_order: want }).eq("id", manual[i].id).eq("tenant_id", tenantId);
      manual[i] = { ...manual[i], sort_order: want };
    }
  }

  const groups = templateGroupNames(template.rules);
  const summary = summariseLines(
    [...toSummarisable(rows, groups), ...toSummarisable(manual, groups)],
    { margin_pct: estimate.margin_pct, vat_pct: a.vat_pct }
  );
  const stillUnpriced = [
    ...rows.filter((r) => r.qty > 0 && r.cost_total === null).map((r) => r.code ?? r.description),
    ...manual.filter((m) => m.qty > 0 && m.cost_total === null).map((m) => m.code ?? m.description),
  ];
  const warnings = [...result.warnings, ...pricing.warnings, ...dropped.map((d) => `A hand edit to "${d}" no longer applies: that line is not in the recalculated estimate.`)];
  const totals: EstimateTotals = {
    ...summary,
    unpriced: [...new Set(stillUnpriced)],
    unresolved: pricing.unresolved,
    pricing: Object.fromEntries(Object.entries(pricing.sources)),
    warnings,
    computed_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("estimates").update({
    params: result.params, totals, model: result.model, template_version: template.version, margin_pct: estimate.margin_pct,
    currency: a.currency ?? estimate.currency, updated_at: new Date().toISOString(),
  }).eq("id", estimate.id).eq("tenant_id", tenantId);
  if (error) throw { status: 500, message: error.message };

  return { lines: await loadLines(supabase, tenantId, estimate.id), totals, dropped };
}

export type RecomputeOptions = {
  /** New input values (otherwise the stored ones). */
  params?: Record<string, unknown>;
  /** Margin to use (otherwise the stored one). */
  margin_pct?: number;
  /** Price product lines again (default true); false keeps the stored unit costs. */
  reprice?: boolean;
  /** A new element schedule replaces the stored one (null clears it). */
  schedule?: ScheduleQty[] | null;
  /** The account to price for, when it is being changed in the same request. */
  account_id?: string | null;
};

export type RecomputeResult =
  | { ok: true; estimate: Estimate; lines: EstimateLine[]; totals: EstimateTotals; dropped: string[] }
  | { ok: false; status: number; error: string; issues?: TemplateIssue[] };

/**
 * Recalculate an estimate from its template: compute, price, and replace its
 * computed lines. Manual lines and hand edits to computed lines are kept. A
 * quoted estimate can still be recalculated; its quote is not touched.
 */
export async function recomputeEstimate(ctx: EstimatorCtx, estimateId: string, opts: RecomputeOptions = {}): Promise<RecomputeResult> {
  const { supabase, tenantId } = ctx;
  const est = await loadEstimate(supabase, tenantId, estimateId);
  if (est.missing) return { ok: false, status: 503, error: PENDING_MESSAGE };
  const estimate = est.data;
  if (!estimate) return { ok: false, status: 404, error: "Estimate not found" };
  if (!estimate.template_id) return { ok: false, status: 409, error: "This estimate has no template, so it cannot be calculated." };
  const tpl = await loadTemplate(supabase, tenantId, estimate.template_id);
  if (!tpl.data) return { ok: false, status: 409, error: "This estimate's template no longer exists, so it cannot be recalculated." };

  const oldLines = await loadLines(supabase, tenantId, estimateId);
  const meta = await loadTenantMeta(tenantId);
  const margin = opts.margin_pct ?? estimate.margin_pct;
  const vat = estimate.totals?.vat_pct ?? meta.vat_pct;
  const reprice = opts.reprice !== false;
  const keep = reprice ? { costs: {}, products: {} } : reusableCosts(oldLines);

  const calc = await computeAndPrice(supabase, {
    tenantId, estimateId, accountId: opts.account_id !== undefined ? opts.account_id : estimate.account_id,
    template: templateBody(tpl.data), params: opts.params ?? estimate.params,
    margin_pct: margin, vat_pct: vat,
    schedule: opts.schedule === null ? [] : (opts.schedule ?? scheduleFromLines(oldLines)),
    reuse: keep.costs, reuseProducts: keep.products,
  });
  if (!calc.ok) return { ok: false, status: 422, error: calc.issues[0]?.message ?? "The estimate could not be calculated.", issues: calc.issues };

  const saved = await saveComputation({
    supabase, tenantId, estimate: { ...estimate, margin_pct: margin }, result: calc.result, pricing: calc.pricing,
    template: tpl.data, oldLines, vat_pct: vat, currency: estimate.currency ?? meta.currency,
  });
  const fresh = await loadEstimate(supabase, tenantId, estimateId);
  return { ok: true, estimate: fresh.data ?? { ...estimate, margin_pct: margin }, lines: saved.lines, totals: saved.totals, dropped: saved.dropped };
}

/** Re-total the stored lines after a hand edit (no recompute of rules). */
export async function refreshTotals(supabase: SupabaseClient, tenantId: string, estimate: Estimate): Promise<{ lines: EstimateLine[]; totals: EstimateTotals }> {
  const lines = await loadLines(supabase, tenantId, estimate.id);
  const meta = estimate.totals?.vat_pct === undefined ? await loadTenantMeta(tenantId) : null;
  const vat = estimate.totals?.vat_pct ?? meta?.vat_pct ?? 0;
  const summary = summariseLines(toSummarisable(lines, new Map()), { margin_pct: estimate.margin_pct, vat_pct: vat });
  const totals: EstimateTotals = {
    ...(estimate.totals ?? {}),
    ...summary,
    unpriced: unpricedCodes(lines),
  };
  const { error } = await supabase.from("estimates").update({ totals, updated_at: new Date().toISOString() }).eq("id", estimate.id).eq("tenant_id", tenantId);
  if (error) throw { status: 500, message: error.message };
  return { lines, totals };
}

/** Next sort order for a hand-added line. */
export async function nextSortOrder(supabase: SupabaseClient, tenantId: string, estimateId: string): Promise<number> {
  const { data } = await supabase.from("estimate_lines").select("sort_order").eq("tenant_id", tenantId).eq("estimate_id", estimateId).order("sort_order", { ascending: false }).limit(1);
  return (Number((data as { sort_order: number }[] | null)?.[0]?.sort_order) || 0) + 1;
}

/** Insert an estimate with a fresh EST- ref, retrying a lost race on the ref. */
export async function insertEstimate(supabase: SupabaseClient, tenantId: string, record: Record<string, unknown>) {
  let last: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await insertWithMasterRef<Estimate>(supabase, "estimates", tenantId, record, "*");
    if (!error && data) return { data, error: null };
    last = error;
    // The ref index is named *_tenant_ref_key (not _uniq), which
    // insertWithMasterRef's own retry does not recognise.
    if (error?.code !== "23505") break;
  }
  return { data: null, error: last };
}

// ── Estimate -> Standard Quote ───────────────────────────────────────────────

export class EstimateQuoteError extends Error {
  constructor(message: string, public status: number = 422, public quoteId: string | null = null) { super(message); }
}

export type AssembleQuoteResult = {
  quoteId: string;
  ref: string;
  subtotal: number;
  tax_pct: number;
  total: number;
  lines: number;
  /** "included" when every option of the flagged select input is a quote option. */
  alternatives: "included" | "none";
  notes: string[];
};

/**
 * The one place an estimate becomes a real Standard Quote (generic version of
 * assembleFenceStandardQuote). It refuses when any product line is unresolved
 * or unpriced; writes one customer-facing line per group (or per line when the
 * template says so) priced at cost + margin, with the tenant's tax on the
 * header; never writes a unit cost or the margin onto a quote line; and is
 * idempotent: an estimate that already has a quote answers 409, and a lost race
 * is undone rather than leaving a second quote.
 */
export async function assembleEstimateQuote(tenantId: string, estimateId: string, opts: { userId?: string | null } = {}): Promise<AssembleQuoteResult> {
  const admin = createAdminSupabase();
  const est = await loadEstimate(admin, tenantId, estimateId);
  if (est.missing) throw new EstimateQuoteError(PENDING_MESSAGE, 503);
  const estimate = est.data;
  if (!estimate) throw new EstimateQuoteError("Estimate not found", 404);
  if (estimate.standard_quote_id) throw new EstimateQuoteError("This estimate already has a quote.", 409, estimate.standard_quote_id);
  if (!estimate.account_id) throw new EstimateQuoteError("Add an account to this estimate before creating a quote.", 400);

  // Foreign ids are re-verified here, not trusted because they were once saved.
  const { data: acct } = await admin.from("accounts").select("id").eq("id", estimate.account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) throw new EstimateQuoteError("Account not found for this tenant.", 400);
  if (estimate.contact_id) {
    const { data: contact } = await admin.from("contacts").select("id").eq("id", estimate.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) throw new EstimateQuoteError("Contact not found for this tenant.", 400);
  }

  const tpl = estimate.template_id ? (await loadTemplate(admin, tenantId, estimate.template_id)).data : null;
  const groups = tpl ? templateGroupNames(tpl.rules) : new Map<string, string>();
  const lines = await loadLines(admin, tenantId, estimateId);
  const source = lines.map((l) => toQuoteSource(l, groups));
  const blockers = quoteBlockers(source);
  if (blockers.length > 0) throw new EstimateQuoteError(blockers.join(" "), 422);

  const granularity = tpl?.quote_granularity === "line" ? "line" : "group";
  const meta = await loadTenantMeta(tenantId);
  const taxPct = estimate.totals?.vat_pct ?? meta.vat_pct;
  const notes: string[] = [];

  let rows: QuoteRowDraft[];
  let alternatives: "included" | "none" = "none";
  const altInput = tpl ? alternativesInput(tpl.inputs) : null;
  const built = buildQuoteLines(source, { granularity, margin_pct: estimate.margin_pct });
  if (!built.ok) throw new EstimateQuoteError(built.problems.join(" "), 422);

  if (tpl && altInput) {
    const costs = reusableCosts(lines).costs;
    const manualSource = lines.filter((l) => l.source === "manual").map((l) => toQuoteSource(l, groups));
    const sets: AlternativeSet[] = [];
    const chosen = String(estimate.params?.[altInput.key] ?? altInput.default);
    for (const option of altInput.options ?? []) {
      if (option.key === chosen) {
        sets.push({ key: option.key, label: option.label, lines: built.lines });
        continue;
      }
      const res = computeEstimate(templateBody(tpl), { ...estimate.params, [altInput.key]: option.key }, {
        margin_pct: estimate.margin_pct, vat_pct: taxPct, unit_costs: costs, schedule: scheduleFromLines(lines),
      });
      if (!res.ok) throw new EstimateQuoteError(`The "${option.label}" option could not be calculated: ${res.issues[0]?.message ?? "invalid"}`, 422);
      const fresh = res.lines.map((l) => persistLine(l, null, null));
      const withEdits = applyOverrides(fresh, lines.filter((l) => l.source !== "manual")).rows;
      const optSource = [
        ...withEdits.map((r) => ({
          description: r.description, uom: r.uom, qty: r.qty, waste_pct: r.waste_pct,
          group: String(r.custom_data?.group ?? r.group_key), group_key: r.group_key, cost_total: r.cost_total,
        })),
        ...manualSource,
      ];
      const optBlockers = quoteBlockers(optSource.map((s) => ({ ...s, sku: null, product_id: null })));
      if (optBlockers.length > 0) throw new EstimateQuoteError(`The "${option.label}" option cannot be quoted: ${optBlockers.join(" ")}`, 422);
      const optBuilt = buildQuoteLines(optSource, { granularity, margin_pct: estimate.margin_pct });
      if (!optBuilt.ok) throw new EstimateQuoteError(`The "${option.label}" option cannot be quoted: ${optBuilt.problems.join(" ")}`, 422);
      sets.push({ key: option.key, label: option.label, lines: optBuilt.lines });
    }
    rows = tagAlternatives(sets, chosen);
    alternatives = "included";
    notes.push(`Each "${altInput.label}" option is on the quote as an alternative; the estimate's own choice is selected. Product unit costs are those used for the chosen option.`);
  } else {
    rows = plainRows(built.lines);
    notes.push(altInput ? "" : "No finish-level alternatives were added: the template has no select input flagged for quoting alternatives.");
  }

  // Header first, zeroed -- same order the Fence assembler and the Standard
  // Quote form follow.
  let quoteId: string | null = null;
  let ref: string | null = null;
  let headerErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quoteId; attempt++) {
    const candidate = await generateNextStandardQuoteRef(admin, tenantId);
    const result = await writeHeaderTolerant(
      {
        tenant_id: tenantId, ref: candidate, account_id: estimate.account_id, contact_id: estimate.contact_id ?? null,
        status: "draft", header_discount_pct: 0, tax_pct: taxPct, shipping_amount: 0, subtotal: 0, total: 0,
        created_by: opts.userId ?? null,
      },
      async (row) => await admin.from("standard_quotes").insert(row).select("id, ref").single()
    );
    if (!result.error) {
      const d = result.data as { id: string; ref: string };
      quoteId = d.id; ref = d.ref;
    } else if ((result.error as { code?: string }).code === "23505") {
      headerErr = result.error;
    } else { headerErr = result.error; break; }
  }
  if (!quoteId || !ref) throw new EstimateQuoteError(headerErr?.message ?? "Failed to create the quote header", 500);

  const undo = async () => { await admin.from("standard_quotes").delete().eq("id", quoteId!).eq("tenant_id", tenantId); };

  const lineRows = resolveLineIdsAndSelection(rows.map((r) => ({
    tenant_id: tenantId, standard_quote_id: quoteId!, sl_no: r.sl_no, description: r.description, uom: r.uom,
    qty: r.qty, rate: r.rate, discount_pct: 0, amount: r.amount,
    group_id: r.group_id, group_label: r.group_label, group_type: r.group_type, is_selected: r.is_selected,
    show_on_pdf: true,
  })));
  const { error: linesErr } = await insertLinesTolerant(admin, "standard_quote_lines", lineRows);
  if (linesErr) { await undo(); throw new EstimateQuoteError(linesErr.message, 500); }

  const subtotal = roundMoney(documentTotal(lineRows as unknown as Parameters<typeof documentTotal>[0]));
  const totals = computeStandardQuoteTotals(subtotal, 0, taxPct, 0);
  const { error: totErr } = await admin.from("standard_quotes").update({ subtotal, total: roundMoney(totals.total) }).eq("id", quoteId).eq("tenant_id", tenantId);
  if (totErr) { await undo(); throw new EstimateQuoteError(totErr.message, 500); }

  // Claim the estimate. A second request that got this far loses here and its
  // quote is removed, so one estimate never ends up with two.
  const { data: claimed, error: claimErr } = await admin
    .from("estimates")
    .update({ standard_quote_id: quoteId, status: "quoted", updated_at: new Date().toISOString() })
    .eq("id", estimateId).eq("tenant_id", tenantId).is("standard_quote_id", null)
    .select("id");
  if (claimErr || !claimed || claimed.length === 0) {
    await undo();
    const again = await loadEstimate(admin, tenantId, estimateId);
    throw new EstimateQuoteError("This estimate already has a quote.", 409, again.data?.standard_quote_id ?? null);
  }

  return {
    quoteId, ref, subtotal, tax_pct: taxPct, total: roundMoney(totals.total),
    lines: lineRows.length, alternatives, notes: notes.filter(Boolean),
  };
}


// ── Templates ────────────────────────────────────────────────────────────────

export type TemplateSummary = {
  id: string; name: string; description: string | null; trade: string | null; geometry: string | null;
  version: number; is_active: boolean; quote_granularity: string;
  input_count: number; rule_count: number; estimate_count: number; updated_at: string;
  keywords: string[]; icon: string | null; locked: boolean; customer_visible: boolean;
};

/** How many estimates were made from each template (0 when the table is missing). */
export async function templateUsage(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("estimates").select("template_id").eq("tenant_id", tenantId).in("template_id", ids).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as { template_id: string }[]) counts.set(r.template_id, (counts.get(r.template_id) ?? 0) + 1);
    if (data.length < PAGE) break;
  }
  return counts;
}

export async function listTemplates(supabase: SupabaseClient, tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<{ rows: TemplateSummary[]; missing: boolean }> {
  let q = supabase.from("estimate_templates").select("*").eq("tenant_id", tenantId).order("name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return { rows: [], missing: true };
    throw { status: 500, message: error.message };
  }
  const templates = (data ?? []) as EstimateTemplate[];
  const usage = await templateUsage(supabase, tenantId, templates.map((t) => t.id));
  return {
    missing: false,
    rows: templates.map((t) => ({
      id: t.id, name: t.name, description: t.description, trade: t.trade, geometry: t.geometry ?? null,
      version: t.version, is_active: t.is_active, quote_granularity: t.quote_granularity,
      input_count: (t.inputs ?? []).length, rule_count: (t.rules ?? []).length,
      estimate_count: usage.get(t.id) ?? 0, updated_at: t.updated_at,
      keywords: t.keywords ?? [], icon: t.icon ?? null, locked: t.locked === true, customer_visible: t.customer_visible === true,
    })),
  };
}

/** Insert a template; a name already used in this workspace is a 409. */
export async function insertTemplate(
  supabase: SupabaseClient, tenantId: string, userId: string,
  header: {
    name: string; description?: string | null; trade?: string | null; quote_granularity?: "group" | "line";
    /** Catalogue fields (0213). Left out of the insert while the migration is pending. */
    keywords?: string[] | null; icon?: string | null; locked?: boolean; customer_visible?: boolean;
  },
  body: EstimateTemplateBody
): Promise<{ data: EstimateTemplate | null; status: number; error: string | null }> {
  const base = {
    tenant_id: tenantId, name: header.name, description: header.description ?? null, trade: header.trade ?? null,
    geometry: body.geometry ?? null, version: 1, is_active: true,
    inputs: body.inputs, rates: body.rates, rules: body.rules,
    quote_granularity: header.quote_granularity ?? "group", created_by: userId,
  };
  const catalogue = {
    ...(header.keywords && header.keywords.length > 0 ? { keywords: header.keywords } : {}),
    ...(header.icon ? { icon: header.icon } : {}),
    ...(header.locked ? { locked: true } : {}),
    ...(header.customer_visible ? { customer_visible: true } : {}),
  };
  let { data, error } = await supabase.from("estimate_templates").insert({ ...base, ...catalogue }).select("*").single();
  // 0213 not applied yet: the template is still created, as an ordinary editable one.
  if (error && Object.keys(catalogue).length > 0 && error.code !== "23505" && isMissingRelation(error)) {
    ({ data, error } = await supabase.from("estimate_templates").insert(base).select("*").single());
  }
  if (error) {
    if (isMissingRelation(error)) return { data: null, status: 503, error: PENDING_MESSAGE };
    if (error.code === "23505") return { data: null, status: 409, error: `A template named "${header.name}" already exists.` };
    return { data: null, status: 500, error: error.message };
  }
  return { data: data as EstimateTemplate, status: 201, error: null };
}
