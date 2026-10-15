import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle } from "@/lib/rfq/server";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { generateNextPoRef } from "@/lib/poRef";
import { logChange } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";

// Awards -> purchase orders (0130).
// GET   -- the POs raised from this RFQ, and which awarded lines are not
//          ordered yet
// POST  { rfq_supplier_ids?: string[] } -- one DRAFT purchase order per
//          awarded supplier for every awarded line not already on a PO.
//
// Needs the Purchasing module and edit on Purchase Orders as well as RFQs.
// The PO rate is the awarded cost in the workspace currency (the supplier's
// own price and exchange rate are written into the line description), and
// the quantity is the RFQ line's. Drafts only: the buyer checks and sends.

async function existingPos(admin: Awaited<ReturnType<typeof rfqAccess>>["admin"], tenantId: string, rfqId: string) {
  const { data, error } = await admin.from("purchase_orders").select("id, ref, status, supplier_id, total, created_at, suppliers(name)")
    .eq("tenant_id", tenantId).eq("rfq_id", rfqId).order("created_at");
  if (error) return { pos: [] as unknown[], pending: true };
  return { pos: data ?? [], pending: false };
}

/** null when 0130 isn't applied -- then nothing can tell an ordered line
 *  from an unordered one, and raising POs would duplicate them. */
async function orderedResponseIds(admin: Awaited<ReturnType<typeof rfqAccess>>["admin"], tenantId: string, responseIds: string[]): Promise<Set<string> | null> {
  const { data, error } = await admin.from("purchase_order_lines").select("rfq_response_id").eq("tenant_id", tenantId).in("rfq_response_id", responseIds.length ? responseIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) return null;
  return new Set(((data ?? []) as { rfq_response_id: string }[]).map((r) => r.rfq_response_id));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const { id } = await params;
    const b = await loadRfqBundle(admin, tenantId, id, { messages: false });
    if (!b) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const { data: t } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
    const purchasing = !!(t?.features as TenantFeatures | undefined)?.purchasing;
    const awarded = b.responses.filter((r) => r.is_awarded);
    const ordered = await orderedResponseIds(admin, tenantId, awarded.map((r) => r.id));
    const { pos, pending } = await existingPos(admin, tenantId, id);
    return NextResponse.json({ purchasing, pending_migration: pending || ordered === null, purchase_orders: pos, to_order: ordered ? awarded.filter((r) => !ordered.has(r.id)).length : 0 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { admin, supabase, tenantId, userId, role, email } = ctx;
    const { id } = await params;
    const { data: t } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
    if (!(t?.features as TenantFeatures | undefined)?.purchasing) return NextResponse.json({ error: "Purchase orders need the Purchasing module on this workspace." }, { status: 409 });
    const perms = await resolvePermissions(supabase, tenantId, userId, role);
    if (!canEditWorkcenter(perms, "purchase_orders")) return NextResponse.json({ error: "You can't create purchase orders." }, { status: 403 });

    const b = await loadRfqBundle(admin, tenantId, id, { messages: false });
    if (!b) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { rfq_supplier_ids?: string[] };
    const only = Array.isArray(body.rfq_supplier_ids) && body.rfq_supplier_ids.length ? new Set(body.rfq_supplier_ids) : null;

    const awarded = b.responses.filter((r) => r.is_awarded && (!only || only.has(r.rfq_supplier_id)));
    const ordered = await orderedResponseIds(admin, tenantId, awarded.map((r) => r.id));
    if (!ordered) return NextResponse.json({ error: "Raising purchase orders from an RFQ needs migration 0130 applied to this database." }, { status: 503 });
    const todo = awarded.filter((r) => !ordered.has(r.id));
    if (!todo.length) return NextResponse.json({ error: "Every awarded line is already on a purchase order." }, { status: 409 });

    const bySupplier = new Map<string, typeof todo>();
    for (const r of todo) bySupplier.set(r.rfq_supplier_id, [...(bySupplier.get(r.rfq_supplier_id) ?? []), r]);

    const created: { id: string; ref: string; supplier: string; lines: number }[] = [];
    for (const [rsId, resps] of bySupplier) {
      const rs = b.suppliers.find((s) => s.id === rsId);
      if (!rs) continue;
      const lines = resps.map((r, i) => {
        const line = b.lines.find((l) => l.id === r.rfq_line_id)!;
        const qty = Number(line.qty ?? 1) || 1;
        const rate = line.awarded_unit_cost !== null ? Number(line.awarded_unit_cost) : Number(r.unit_price ?? 0);
        const foreign = r.currency && r.fx_rate && Number(r.fx_rate) !== 1;
        return {
          tenant_id: tenantId,
          sl_no: i + 1,
          description: `${line.description}${r.status === "alternative" && r.offered_description ? ` — offered: ${r.offered_description}` : ""}${foreign ? ` (${r.unit_price} ${r.currency} @ ${r.fx_rate})` : ""}`.slice(0, 1000),
          uom: line.uom,
          qty_ordered: qty,
          rate,
          amount: Math.round(qty * rate * 100) / 100,
          product_id: line.product_id,
          rfq_response_id: r.id,
        };
      });
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const header: Record<string, unknown> = {
        tenant_id: tenantId, supplier_id: rs.supplier_id, status: "draft", created_by: userId, total,
        quote_id: b.rfq.origin_type === "quote" ? b.rfq.origin_id : null,
        case_id: b.rfq.origin_type === "case" ? b.rfq.origin_id : null,
        notes: `From ${b.rfq.ref} — ${b.rfq.title}${rs.supplier_quote_ref ? `. Supplier quotation ${rs.supplier_quote_ref}` : ""}${rs.incoterm ? `. ${rs.incoterm}` : ""}`.slice(0, 2000),
        terms: rs.payment_terms ?? null,
        expected_date: b.rfq.required_by,
        rfq_id: id,
        standard_quote_id: b.rfq.origin_type === "standard_quote" ? b.rfq.origin_id : null,
      };
      let po: { id: string; ref: string } | null = null;
      for (let attempt = 0; attempt < 3 && !po; attempt++) {
        const ref = await generateNextPoRef(supabase, tenantId);
        const res = await supabase.from("purchase_orders").insert({ ...header, ref }).select("id, ref").single();
        if (!res.error) po = res.data as { id: string; ref: string };
        else if (res.error.code !== "23505") return NextResponse.json({ error: res.error.message }, { status: 500 });
      }
      if (!po) return NextResponse.json({ error: "Could not allocate a PO number" }, { status: 500 });
      const lineRes = await supabase.from("purchase_order_lines").insert(lines.map((l) => ({ ...l, po_id: po!.id })));
      if (lineRes.error) {
        await supabase.from("purchase_orders").delete().eq("id", po.id).eq("tenant_id", tenantId);
        return NextResponse.json({ error: lineRes.error.message }, { status: 500 });
      }
      await logChange(supabase, { tenantId, objectType: "purchase_orders", objectId: po.id, objectLabel: po.ref, action: "create", actorId: userId, actorEmail: email, changes: [{ field: "from RFQ", from: null, to: b.rfq.ref }, { field: "total", from: null, to: total }] });
      created.push({ id: po.id, ref: po.ref, supplier: rs.suppliers?.name ?? "", lines: lines.length });
    }
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: b.rfq.ref, action: "update", actorId: userId, actorEmail: email, changes: [{ field: "purchase orders raised", from: null, to: created.map((c) => c.ref).join(", ") }] });
    return NextResponse.json({ ok: true, created }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
