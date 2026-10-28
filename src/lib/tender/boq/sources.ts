import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../server";
import type { Candidate } from "./price";

import { readAllPages } from "@/lib/pagedRead";
// Where a BOQ line's price can come from (slice 3a). The sources are read ONCE for a whole set of lines (loadPriceContext, in
// batches of 100 ids) and the matching per line is plain code (candidatesFor), so "Price all" on 600 lines costs a handful of
// queries, not 600. Every query is tenant-scoped on the admin client (MULTI_TENANT_GUARDRAILS.md) and every one tolerates a
// missing table or column: a source that is not there simply offers nothing.
//
//   boq_rate      the rate the client's own file carried.
//   bom           the roll-up of a product's BOM (components x their cost price), or a line of an existing estimate for that product.
//   past_project  the rate on a line of an AWARDED tender of this workspace with the same cost code, product or description.
//   supplier      an answered RFQ line for the product (the latest), or the product's own cost price (dated by cost_price_as_of).
//
// Cost and selling prices are told apart (`kind`): supplier and BOM figures are COSTS, past-project and client rates are selling
// prices. Nothing here decides a markup.

export type SourceLine = { description: string; product_id: string | null; cost_code: string | null; file_rate: number | null };

type ProductRow = { id: string; name: string; sku: string | null; cost_price: number | null; cost_price_as_of: string | null; supplier_id: string | null };
type BomLine = { component_product_id: string; qty: number; scrap_pct: number };
type RfqHit = { ref: string; supplier: string; cost: number; as_of: string | null };
type WonDeal = { ref: string; tender_no: string | null; as_of: string; lines: { desc: string; product_id: string | null; cost_code: string | null; rate: number }[] };

export type PriceContext = {
  /** The client's file: name and upload date, for the "client's rate" candidate. */
  file: { name: string; date: string } | null;
  products: Map<string, ProductRow>;
  byName: Map<string, string>;
  bySku: Map<string, string>;
  supplierNames: Map<string, string>;
  bom: Map<string, BomLine[]>;
  estimates: Map<string, { ref: string; cost: number; as_of: string | null }>;
  rfq: Map<string, RfqHit[]>;
  won: WonDeal[];
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);
const chunk = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const money = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export const emptyContext = (file: PriceContext["file"] = null): PriceContext => ({
  file, products: new Map(), byName: new Map(), bySku: new Map(), supplierNames: new Map(), bom: new Map(), estimates: new Map(), rfq: new Map(), won: [],
});

type Db = SupabaseClient;
async function rows<T>(q: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as T[];
}

async function productsWhere(admin: Db, tenantId: string, col: "id" | "name" | "sku", values: string[]): Promise<ProductRow[]> {
  const out: ProductRow[] = [];
  for (const part of chunk([...new Set(values.filter(Boolean))], 100)) {
    let res = await admin.from("products").select("id, name, sku, cost_price, cost_price_as_of, supplier_id").eq("tenant_id", tenantId).in(col, part);
    // 0113 (cost_price_as_of) or 0132 (supplier_id) may be pending: read what is there.
    if (res.error && isMissingSchema(res.error)) res = await admin.from("products").select("id, name, sku, cost_price").eq("tenant_id", tenantId).in(col, part) as typeof res;
    if (res.error) continue;
    for (const r of (res.data ?? []) as Partial<ProductRow>[]) {
      out.push({ id: r.id!, name: r.name ?? "", sku: r.sku ?? null, cost_price: r.cost_price == null ? null : Number(r.cost_price), cost_price_as_of: day(r.cost_price_as_of), supplier_id: r.supplier_id ?? null });
    }
  }
  return out;
}

export async function loadPriceContext(admin: Db, tenantId: string, opportunityId: string, lines: readonly SourceLine[], file: PriceContext["file"]): Promise<PriceContext> {
  const ctx = emptyContext(file);

  // 1. Which products the lines are about: linked, else the same SKU as the cost code, else the same name as the description.
  const linked = lines.map((l) => l.product_id).filter((x): x is string => !!x);
  const unlinked = lines.filter((l) => !l.product_id);
  const [byId, byName, bySku] = await Promise.all([
    productsWhere(admin, tenantId, "id", linked),
    productsWhere(admin, tenantId, "name", unlinked.map((l) => l.description.trim()).filter((d) => d.length <= 150)),
    productsWhere(admin, tenantId, "sku", unlinked.map((l) => (l.cost_code ?? "").trim()).filter(Boolean)),
  ]);
  for (const p of [...byId, ...byName, ...bySku]) ctx.products.set(p.id, p);
  for (const p of byName) if (!ctx.byName.has(norm(p.name))) ctx.byName.set(norm(p.name), p.id);
  for (const p of bySku) if (p.sku && !ctx.bySku.has(norm(p.sku))) ctx.bySku.set(norm(p.sku), p.id);
  const productIds = [...ctx.products.keys()];

  if (productIds.length > 0) {
    // 2. BOM roll-ups: the consumed components of each product and their cost prices.
    for (const part of chunk(productIds, 100)) {
      for (const b of await rows<{ parent_product_id: string; component_product_id: string; qty: number; scrap_pct: number }>(
        readAllPages((lo, hi) => admin.from("product_bom_lines").select("parent_product_id, component_product_id, qty, scrap_pct").eq("tenant_id", tenantId).eq("line_kind", "consumed").in("parent_product_id", part).order("id", { ascending: true }).range(lo, hi)))) {
        const list = ctx.bom.get(b.parent_product_id) ?? [];
        list.push({ component_product_id: b.component_product_id, qty: Number(b.qty), scrap_pct: Number(b.scrap_pct ?? 0) });
        ctx.bom.set(b.parent_product_id, list);
      }
    }
    const components = [...new Set([...ctx.bom.values()].flat().map((b) => b.component_product_id))].filter((id) => !ctx.products.has(id));
    for (const p of await productsWhere(admin, tenantId, "id", components)) ctx.products.set(p.id, p);

    // 3. Estimates: the newest line of a live estimate for the product.
    const estLines: { estimate_id: string; product_id: string; unit_cost: number; updated_at: string | null }[] = [];
    for (const part of chunk(productIds, 100)) {
      estLines.push(...await rows<{ estimate_id: string; product_id: string; unit_cost: number; updated_at: string | null }>(
        readAllPages((lo, hi) => admin.from("estimate_lines").select("estimate_id, product_id, unit_cost, updated_at").eq("tenant_id", tenantId).in("product_id", part).not("unit_cost", "is", null).order("id", { ascending: true }).range(lo, hi))));
    }
    if (estLines.length > 0) {
      const live = new Map<string, { ref: string | null; name: string; status: string; updated_at: string | null }>();
      for (const part of chunk([...new Set(estLines.map((e) => e.estimate_id))], 100)) {
        for (const e of await rows<{ id: string; ref: string | null; name: string; status: string; updated_at: string | null }>(admin.from("estimates").select("id, ref, name, status, updated_at").eq("tenant_id", tenantId).in("id", part))) {
          if (e.status !== "lost") live.set(e.id, e);
        }
      }
      for (const l of [...estLines].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))) {
        const e = live.get(l.estimate_id);
        if (!e || ctx.estimates.has(l.product_id) || !(Number(l.unit_cost) > 0)) continue;
        ctx.estimates.set(l.product_id, { ref: e.ref ?? e.name, cost: Number(l.unit_cost), as_of: day(e.updated_at ?? l.updated_at) });
      }
    }

    // 4. Answered RFQ lines for the product: rfq_lines -> rfq_responses (quoted) -> rfq_suppliers -> rfqs / suppliers.
    const rfqLines: { id: string; rfq_id: string; product_id: string }[] = [];
    for (const part of chunk(productIds, 100)) {
      rfqLines.push(...await rows<{ id: string; rfq_id: string; product_id: string }>(readAllPages((lo, hi) => admin.from("rfq_lines").select("id, rfq_id, product_id").eq("tenant_id", tenantId).in("product_id", part).order("id", { ascending: true }).range(lo, hi))));
    }
    if (rfqLines.length > 0) {
      const lineProduct = new Map(rfqLines.map((l) => [l.id, l.product_id]));
      const responses: { rfq_supplier_id: string; rfq_line_id: string; unit_price: number; fx_rate: number | null; submitted_at: string | null }[] = [];
      for (const part of chunk(rfqLines.map((l) => l.id), 100)) {
        responses.push(...await rows<(typeof responses)[number]>(readAllPages((lo, hi) => admin.from("rfq_responses").select("rfq_supplier_id, rfq_line_id, unit_price, fx_rate, submitted_at").eq("tenant_id", tenantId).eq("status", "quoted").in("rfq_line_id", part).not("unit_price", "is", null).order("id", { ascending: true }).range(lo, hi))));
      }
      const rs = new Map<string, { rfq_id: string; supplier_id: string; status: string }>();
      for (const part of chunk([...new Set(responses.map((r) => r.rfq_supplier_id))], 100)) {
        for (const s of await rows<{ id: string; rfq_id: string; supplier_id: string; status: string }>(admin.from("rfq_suppliers").select("id, rfq_id, supplier_id, status").eq("tenant_id", tenantId).in("id", part))) rs.set(s.id, s);
      }
      const rfqRef = new Map<string, string>();
      for (const part of chunk([...new Set([...rs.values()].map((s) => s.rfq_id))], 100)) {
        for (const r of await rows<{ id: string; ref: string | null; title: string }>(admin.from("rfqs").select("id, ref, title").eq("tenant_id", tenantId).in("id", part))) rfqRef.set(r.id, r.ref ?? r.title);
      }
      const supplierIds = [...new Set([...[...rs.values()].map((s) => s.supplier_id), ...[...ctx.products.values()].map((p) => p.supplier_id ?? "")])].filter(Boolean);
      for (const part of chunk(supplierIds, 100)) {
        for (const s of await rows<{ id: string; name: string }>(admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", part))) ctx.supplierNames.set(s.id, s.name);
      }
      for (const r of responses) {
        const s = rs.get(r.rfq_supplier_id);
        const pid = lineProduct.get(r.rfq_line_id);
        if (!s || !pid || s.status === "cancelled" || s.status === "declined" || !(Number(r.unit_price) > 0)) continue;
        const list = ctx.rfq.get(pid) ?? [];
        list.push({ ref: rfqRef.get(s.rfq_id) ?? "RFQ", supplier: ctx.supplierNames.get(s.supplier_id) ?? "Supplier", cost: money(Number(r.unit_price) * (Number(r.fx_rate) > 0 ? Number(r.fx_rate) : 1)), as_of: day(r.submitted_at) });
        ctx.rfq.set(pid, list);
      }
      for (const list of ctx.rfq.values()) list.sort((a, b) => (b.as_of ?? "").localeCompare(a.as_of ?? "") || a.cost - b.cost);
    }
    // The preferred supplier's name for the product-cost candidate (0132): fetched above when there was an RFQ; otherwise here.
    const missingNames = [...ctx.products.values()].map((p) => p.supplier_id).filter((id): id is string => !!id && !ctx.supplierNames.has(id));
    for (const part of chunk([...new Set(missingNames)], 100)) {
      for (const s of await rows<{ id: string; name: string }>(admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", part))) ctx.supplierNames.set(s.id, s.name);
    }
  }

  // 5. Past projects: the lines of tender deals this workspace WON (not this deal), with their cost codes.
  const tenderIds = new Set((await rows<{ opportunity_id: string }>(readAllPages((lo, hi) => admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).order("opportunity_id", { ascending: true }).range(lo, hi)))).map((t) => t.opportunity_id));
  tenderIds.delete(opportunityId);
  if (tenderIds.size > 0) {
    const wonOpps = (await rows<{ id: string; ref: string | null; title: string; closed_at: string | null; updated_at: string | null }>(
      readAllPages((lo, hi) => admin.from("opportunities").select("id, ref, title, closed_at, updated_at").eq("tenant_id", tenantId).eq("outcome", "won").order("id", { ascending: true }).range(lo, hi)))).filter((o) => tenderIds.has(o.id));
    const byOpp = new Map<string, WonDeal>();
    const tenderNo = new Map<string, string | null>();
    for (const part of chunk(wonOpps.map((o) => o.id), 100)) {
      for (const t of await rows<{ opportunity_id: string; tender_no: string | null }>(admin.from("opportunity_tenders").select("opportunity_id, tender_no").eq("tenant_id", tenantId).in("opportunity_id", part))) tenderNo.set(t.opportunity_id, t.tender_no);
    }
    for (const o of wonOpps) byOpp.set(o.id, { ref: o.ref ?? o.title, tender_no: tenderNo.get(o.id) ?? null, as_of: day(o.closed_at ?? o.updated_at) ?? "", lines: [] });
    const lineCode = new Map<string, string | null>();
    for (const part of chunk(wonOpps.map((o) => o.id), 100)) {
      for (const b of await rows<{ line_id: string | null; cost_code: string | null }>(readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, cost_code").eq("tenant_id", tenantId).in("opportunity_id", part).order("id", { ascending: true }).range(lo, hi)))) {
        if (b.line_id) lineCode.set(b.line_id, b.cost_code);
      }
      for (const l of await rows<{ id: string; opportunity_id: string; description: string; rate: number; product_id: string | null }>(readAllPages((lo, hi) => admin.from("opportunity_lines").select("id, opportunity_id, description, rate, product_id").eq("tenant_id", tenantId).in("opportunity_id", part).order("id", { ascending: true }).range(lo, hi)))) {
        if (!(Number(l.rate) > 0)) continue;
        byOpp.get(l.opportunity_id)?.lines.push({ desc: norm(l.description), product_id: l.product_id, cost_code: lineCode.get(l.id) ?? null, rate: Number(l.rate) });
      }
    }
    ctx.won = [...byOpp.values()].filter((d) => d.lines.length > 0).sort((a, b) => b.as_of.localeCompare(a.as_of));
  }
  return ctx;
}

/** The product a line is about: its own link, else the product whose SKU is the cost code, else the one named like the description. */
export function resolveProduct(ctx: PriceContext, line: SourceLine): string | null {
  if (line.product_id && ctx.products.has(line.product_id)) return line.product_id;
  if (line.cost_code && ctx.bySku.has(norm(line.cost_code))) return ctx.bySku.get(norm(line.cost_code))!;
  return ctx.byName.get(norm(line.description)) ?? null;
}

/** Every price the sources offer for one line. The picker shows them all; "Price all" picks among them (price.ts pickAuto). */
export function candidatesFor(ctx: PriceContext, line: SourceLine): Candidate[] {
  const out: Candidate[] = [];
  if (line.file_rate && line.file_rate > 0) {
    out.push({ source: "boq_rate", ref: ctx.file?.name ?? "Client file", label: "Rate in the client's file", price: line.file_rate, kind: "sell", as_of: ctx.file?.date ?? null });
  }

  const pid = resolveProduct(ctx, line);
  const product = pid ? ctx.products.get(pid) : undefined;
  if (pid && product) {
    const bom = ctx.bom.get(pid);
    if (bom && bom.length > 0) {
      const parts = bom.map((b) => ({ b, c: ctx.products.get(b.component_product_id) }));
      // A roll-up with a component that has no cost is not a cost: it would under-price the line.
      if (parts.every((p) => p.c && p.c.cost_price != null && p.c.cost_price > 0)) {
        const cost = parts.reduce((s, p) => s + p.b.qty * (1 + p.b.scrap_pct / 100) * p.c!.cost_price!, 0);
        const dates = parts.map((p) => p.c!.cost_price_as_of).filter((d): d is string => !!d).sort();
        out.push({ source: "bom", ref: `BOM of ${product.name}`, label: `BOM of ${product.name} (${bom.length} component${bom.length === 1 ? "" : "s"})`, price: money(cost), kind: "cost", as_of: dates[0] ?? null });
      }
    }
    const est = ctx.estimates.get(pid);
    if (est) out.push({ source: "bom", ref: `Estimate ${est.ref}`, label: `Estimate ${est.ref}`, price: money(est.cost), kind: "cost", as_of: est.as_of });

    for (const h of (ctx.rfq.get(pid) ?? []).slice(0, 3)) {
      out.push({ source: "supplier", ref: `${h.ref} · ${h.supplier}`, label: `${h.ref} · ${h.supplier}`, price: h.cost, kind: "cost", as_of: h.as_of });
    }
    if (product.cost_price != null && product.cost_price > 0) {
      const who = product.supplier_id ? ctx.supplierNames.get(product.supplier_id) : null;
      out.push({ source: "supplier", ref: `Cost price of ${product.name}${who ? ` · ${who}` : ""}`, label: `Product cost price${who ? ` · ${who}` : ""}`, price: money(product.cost_price), kind: "cost", as_of: product.cost_price_as_of });
    }
  }

  // Past projects: the newest awarded tender line that shares the cost code, the product or the description (in that order of trust).
  const code = norm(line.cost_code);
  const desc = norm(line.description);
  const seen: Candidate[] = [];
  for (const deal of ctx.won) {
    let best: { rate: number; why: string; rank: number } | null = null;
    for (const l of deal.lines) {
      const rank = code && l.cost_code && norm(l.cost_code) === code ? 1 : pid && l.product_id === pid ? 2 : desc && l.desc === desc ? 3 : 0;
      if (rank === 0) continue;
      if (!best || rank < best.rank) best = { rate: l.rate, why: rank === 1 ? "same cost code" : rank === 2 ? "same product" : "same description", rank };
    }
    if (best) seen.push({ source: "past_project", ref: `${deal.ref}${deal.tender_no ? ` · ${deal.tender_no}` : ""}`, label: `${deal.ref}${deal.tender_no ? ` · ${deal.tender_no}` : ""} (${best.why})`, price: money(best.rate), kind: "sell", as_of: deal.as_of || null });
    if (seen.length >= 3) break;
  }
  out.push(...seen);
  return out;
}
