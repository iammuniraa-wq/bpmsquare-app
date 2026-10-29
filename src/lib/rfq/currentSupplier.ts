import type { SupabaseClient } from "@supabase/supabase-js";
import { pickCurrentSupplier, type Candidate, type CurrentPick } from "./currentSupplierRank";

import { readAllPages } from "@/lib/pagedRead";
// Server half of "current supplier": gathers candidates for a set of
// products and hands them to the pure ranking. Runs on the service-role
// client, so EVERY query carries .eq("tenant_id", tenantId). Each source
// degrades on its own: a missing table or column (migration pending) just
// means that source offers nothing.

export type CurrentSupplier = CurrentPick & { name: string; email: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only well-formed ids, de-duplicated and capped -- they go into .in(). */
export function sanitizeIds(ids: unknown[], max = 100): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x.trim())).map((x) => x.trim().toLowerCase()))].slice(0, max);
}

type Rows = PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>;

async function inChunks<T>(ids: string[], run: (chunk: string[]) => Rows): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await run(ids.slice(i, i + 150));
    if (error) return out;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** product id -> current supplier (null when none on record). */
export async function currentSuppliersForProducts(admin: SupabaseClient, tenantId: string, productIds: unknown[]): Promise<Record<string, CurrentSupplier | null>> {
  const ids = sanitizeIds(productIds);
  const result: Record<string, CurrentSupplier | null> = Object.fromEntries(ids.map((id) => [id, null]));
  if (!ids.length) return result;

  // 1. Preferred supplier on the product (0132 -- the column may not exist yet,
  //    in which case this select errors and the source simply offers nothing).
  const preferred = new Map<string, string>();
  const { data: prods, error: prodErr } = await admin.from("products").select("id, supplier_id").eq("tenant_id", tenantId).in("id", ids);
  if (!prodErr) for (const p of (prods ?? []) as { id: string; supplier_id: string | null }[]) if (p.supplier_id) preferred.set(p.id, p.supplier_id);

  // 2. Awarded RFQ responses for these products.
  const awards = new Map<string, Candidate[]>();
  const { data: lines, error: lineErr } = await readAllPages((lo, hi) => admin.from("rfq_lines").select("id, product_id").eq("tenant_id", tenantId).in("product_id", ids).order("id", { ascending: true }).range(lo, hi));
  if (!lineErr && lines?.length) {
    const productOfLine = new Map((lines as { id: string; product_id: string }[]).map((l) => [l.id, l.product_id]));
    const resps = await inChunks<{ rfq_supplier_id: string; rfq_line_id: string; unit_price: number | null; currency: string | null; updated_at: string }>(
      [...productOfLine.keys()],
      (chunk) => admin.from("rfq_responses").select("rfq_supplier_id, rfq_line_id, unit_price, currency, updated_at")
        .eq("tenant_id", tenantId).eq("is_awarded", true).in("rfq_line_id", chunk),
    );
    const rsIds = [...new Set(resps.map((r) => r.rfq_supplier_id))];
    const rsRows = await inChunks<{ id: string; supplier_id: string }>(rsIds, (chunk) => admin.from("rfq_suppliers").select("id, supplier_id").eq("tenant_id", tenantId).in("id", chunk));
    const supplierOfRs = new Map(rsRows.map((r) => [r.id, r.supplier_id]));
    for (const r of resps) {
      const pid = productOfLine.get(r.rfq_line_id);
      const sid = supplierOfRs.get(r.rfq_supplier_id);
      if (!pid || !sid) continue;
      const list = awards.get(pid) ?? [];
      list.push({ supplier_id: sid, as_of: r.updated_at, unit_price: r.unit_price === null ? null : Number(r.unit_price), currency: r.currency });
      awards.set(pid, list);
    }
  }

  // 3. Purchase order lines for these products (0130 added product_id).
  const orders = new Map<string, Candidate[]>();
  const { data: poLines, error: poLineErr } = await readAllPages((lo, hi) => admin.from("purchase_order_lines").select("product_id, po_id, rate").eq("tenant_id", tenantId).in("product_id", ids).order("id", { ascending: true }).range(lo, hi));
  if (!poLineErr && poLines?.length) {
    const poIds = [...new Set((poLines as { po_id: string }[]).map((l) => l.po_id))];
    const pos = await inChunks<{ id: string; supplier_id: string; order_date: string | null; created_at: string }>(
      poIds,
      (chunk) => admin.from("purchase_orders").select("id, supplier_id, order_date, created_at").eq("tenant_id", tenantId).neq("status", "cancelled").in("id", chunk),
    );
    const poById = new Map(pos.map((p) => [p.id, p]));
    for (const l of poLines as { product_id: string; po_id: string; rate: number | null }[]) {
      const po = poById.get(l.po_id);
      if (!po) continue;
      const list = orders.get(l.product_id) ?? [];
      list.push({ supplier_id: po.supplier_id, as_of: po.order_date ?? po.created_at, unit_price: l.rate === null ? null : Number(l.rate), currency: null });
      orders.set(l.product_id, list);
    }
  }

  // Which of the named suppliers are this tenant's own and still active.
  const named = new Set<string>([...preferred.values()]);
  for (const m of [awards, orders]) for (const list of m.values()) for (const c of list) named.add(c.supplier_id);
  const supplierRows = await inChunks<{ id: string; name: string; email: string | null; status: string | null }>(
    [...named], (chunk) => admin.from("suppliers").select("id, name, email, status").eq("tenant_id", tenantId).in("id", chunk),
  );
  const active = new Map(supplierRows.filter((s) => s.status !== "inactive").map((s) => [s.id, s]));
  const activeIds = new Set(active.keys());

  for (const id of ids) {
    const pick = pickCurrentSupplier({
      preferred: preferred.get(id) ?? null,
      awards: awards.get(id) ?? [],
      purchaseOrders: orders.get(id) ?? [],
      active: activeIds,
    });
    const s = pick ? active.get(pick.supplier_id) : undefined;
    result[id] = pick && s ? { ...pick, name: s.name, email: s.email } : null;
  }
  return result;
}
