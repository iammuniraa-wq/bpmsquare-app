import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, isMissingRelation } from "@/lib/rfq/server";
import { currentSuppliersForProducts, sanitizeIds } from "@/lib/rfq/currentSupplier";

import { readAllPages } from "@/lib/pagedRead";
// GET ?product_ids=a,b -- which suppliers to ask, from this tenant's own RFQ
// history for these products: who won them, who quoted them, who was asked.
// The RFQ form pre-ticks the best few. History is the tenant's own data; no
// price is returned, only counts and the last award date.
//
// `current` (per product id): the supplier already on record for the product
// -- the product's preferred supplier, else the last awarded RFQ, else the
// last purchase order -- with where it came from and the last price. The
// price is the tenant's own cost history (internal); the old `suppliers`
// shape is unchanged.

type Hit = { supplier_id: string; name: string; email: string | null; awarded: number; quoted: number; asked: number; last_awarded_at: string | null };

export async function GET(req: NextRequest) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const ids = sanitizeIds((req.nextUrl.searchParams.get("product_ids") ?? "").split(","));
    if (!ids.length) return NextResponse.json({ suppliers: [], current: {} });
    const current = await currentSuppliersForProducts(admin, tenantId, ids).catch(() => ({}));

    const { data: lines, error } = await readAllPages((lo, hi) => admin.from("rfq_lines").select("id, rfq_id").eq("tenant_id", tenantId).in("product_id", ids).order("id", { ascending: true }).range(lo, hi));
    if (error) return NextResponse.json({ suppliers: [], current, pending_migration: isMissingRelation(error) });
    const lineIds = (lines ?? []).map((l) => l.id as string);
    const rfqIds = [...new Set((lines ?? []).map((l) => l.rfq_id as string))];
    if (!lineIds.length) return NextResponse.json({ suppliers: [], current });

    const [{ data: sups }, { data: resps }] = await Promise.all([
      admin.from("rfq_suppliers").select("id, supplier_id, suppliers(name, email, status)").eq("tenant_id", tenantId).in("rfq_id", rfqIds),
      admin.from("rfq_responses").select("rfq_supplier_id, status, is_awarded, updated_at").eq("tenant_id", tenantId).in("rfq_line_id", lineIds),
    ]);
    const supplierOf = new Map<string, { supplier_id: string; name: string; email: string | null; active: boolean }>();
    for (const s of (sups ?? []) as unknown as { id: string; supplier_id: string; suppliers: { name: string; email: string | null; status: string } | null }[]) {
      if (s.suppliers) supplierOf.set(s.id, { supplier_id: s.supplier_id, name: s.suppliers.name, email: s.suppliers.email, active: s.suppliers.status !== "inactive" });
    }
    const hits = new Map<string, Hit>();
    const hit = (rsId: string) => {
      const s = supplierOf.get(rsId);
      if (!s || !s.active) return null;
      let h = hits.get(s.supplier_id);
      if (!h) { h = { supplier_id: s.supplier_id, name: s.name, email: s.email, awarded: 0, quoted: 0, asked: 0, last_awarded_at: null }; hits.set(s.supplier_id, h); }
      return h;
    };
    const askedOnce = new Set<string>();
    for (const rsId of supplierOf.keys()) {
      const h = hit(rsId);
      if (h && !askedOnce.has(rsId)) { h.asked++; askedOnce.add(rsId); }
    }
    for (const r of (resps ?? []) as { rfq_supplier_id: string; status: string; is_awarded: boolean; updated_at: string }[]) {
      const h = hit(r.rfq_supplier_id);
      if (!h) continue;
      if (r.status !== "no_quote") h.quoted++;
      if (r.is_awarded) {
        h.awarded++;
        if (!h.last_awarded_at || r.updated_at > h.last_awarded_at) h.last_awarded_at = r.updated_at;
      }
    }
    const ranked = [...hits.values()].sort((a, b) => b.awarded - a.awarded || b.quoted - a.quoted || b.asked - a.asked).slice(0, 10);
    return NextResponse.json({ suppliers: ranked, current });
  } catch (e) {
    return errorResponse(e);
  }
}
