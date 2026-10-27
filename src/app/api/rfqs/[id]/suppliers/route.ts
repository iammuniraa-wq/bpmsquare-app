import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse } from "@/lib/rfq/server";
import { logChange } from "@/lib/changeLog";
import { RFQ_LIMITS } from "@/lib/rfq/types";
import { assertTenderSuppliersAllowed, packageOfRfq } from "@/lib/supplierGroups/server";

// POST { supplier_ids: string[] } -- add suppliers to an RFQ. Each becomes
// its own recipient with its own reply link; nothing is sent until Send.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await admin.from("rfqs").select("id, ref, status, origin_type, origin_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (["closed", "cancelled"].includes(rfq.status as string)) return NextResponse.json({ error: "This RFQ is closed." }, { status: 409 });
    const body = (await req.json().catch(() => ({}))) as { supplier_ids?: string[] };
    const ids = [...new Set((body.supplier_ids ?? []).filter((x) => typeof x === "string" && x))];
    if (!ids.length) return NextResponse.json({ error: "Choose at least one supplier." }, { status: 422 });
    // A tender RFQ (a deal's, an estimate's for a deal, or a buy-out round) may add only the client's approved suppliers, when the client has such a list.
    const allowed = await assertTenderSuppliersAllowed(admin, tenantId, { origin_type: rfq.origin_type as string | null, origin_id: rfq.origin_id as string | null, package_id: await packageOfRfq(admin, tenantId, id) }, ids);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error, ...(allowed.extra ?? {}) }, { status: allowed.status });

    const { data: existing } = await admin.from("rfq_suppliers").select("supplier_id").eq("tenant_id", tenantId).eq("rfq_id", id);
    const have = new Set(((existing ?? []) as { supplier_id: string }[]).map((r) => r.supplier_id));
    if (have.size + ids.filter((x) => !have.has(x)).length > RFQ_LIMITS.maxSuppliers) {
      return NextResponse.json({ error: `At most ${RFQ_LIMITS.maxSuppliers} suppliers per RFQ.` }, { status: 422 });
    }
    // Every supplier id is verified against this tenant before it is linked.
    const { data: sups } = await admin.from("suppliers").select("id, name, email").eq("tenant_id", tenantId).in("id", ids);
    const found = (sups ?? []) as { id: string; name: string; email: string | null }[];
    if (found.length !== ids.length) return NextResponse.json({ error: "A supplier was not found." }, { status: 404 });
    const fresh = found.filter((s) => !have.has(s.id));
    if (fresh.length) {
      const { error } = await admin.from("rfq_suppliers").insert(fresh.map((s) => ({ tenant_id: tenantId, rfq_id: id, supplier_id: s.id, email_to: s.email })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: rfq.ref as string, action: "update", actorId: userId, actorEmail: email, changes: [{ field: "suppliers added", from: null, to: fresh.map((s) => s.name).join(", ") }] });
    }
    return NextResponse.json({ ok: true, added: fresh.length });
  } catch (e) {
    return errorResponse(e);
  }
}
