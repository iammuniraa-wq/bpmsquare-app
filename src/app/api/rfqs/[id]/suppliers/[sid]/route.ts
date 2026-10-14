import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, refreshRfqStatus } from "@/lib/rfq/server";
import { logChange } from "@/lib/changeLog";

// One recipient of an RFQ.
// PATCH { email_to?, contact_name? }
// PATCH { action: "remove" }     -- the supplier drops out; its link dies
// PATCH { action: "new_link" }   -- rotate the nonce: every link sent so far
//                                   stops working (e.g. forwarded to the wrong
//                                   person); the next send carries a new one
// DELETE                         -- only before anything was sent

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function load(admin: ReturnType<typeof import("@/lib/supabase-server").createAdminSupabase>, tenantId: string, rfqId: string, sid: string) {
  const { data } = await admin.from("rfq_suppliers").select("*, suppliers(name), rfqs(ref)").eq("id", sid).eq("tenant_id", tenantId).eq("rfq_id", rfqId).maybeSingle();
  return data as (Record<string, unknown> & { suppliers: { name: string } | null; rfqs: { ref: string } | null }) | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id, sid } = await params;
    const rs = await load(admin, tenantId, id, sid);
    if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const label = rs.rfqs?.ref ?? null;
    const who = rs.suppliers?.name ?? "supplier";

    if (body.action === "remove" || body.action === "new_link") {
      const patch: Record<string, unknown> = { token_nonce: crypto.randomUUID().replace(/-/g, ""), updated_at: now };
      if (body.action === "remove") patch.status = "cancelled";
      await admin.from("rfq_suppliers").update(patch).eq("id", sid).eq("tenant_id", tenantId);
      if (body.action === "remove") await refreshRfqStatus(admin, tenantId, id);
      await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: label, action: "update", actorId: userId, actorEmail: email, changes: [{ field: body.action === "remove" ? "supplier removed" : "reply link reissued", from: null, to: who }] });
      return NextResponse.json({ ok: true });
    }

    const patch: Record<string, unknown> = {};
    if ("email_to" in body) {
      const e = typeof body.email_to === "string" ? body.email_to.trim() : "";
      if (e && !EMAIL_RE.test(e)) return NextResponse.json({ error: "That email address doesn't look valid." }, { status: 422 });
      patch.email_to = e || null;
    }
    if ("contact_name" in body) patch.contact_name = typeof body.contact_name === "string" && body.contact_name.trim() ? body.contact_name.trim().slice(0, 120) : null;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
    await admin.from("rfq_suppliers").update({ ...patch, updated_at: now }).eq("id", sid).eq("tenant_id", tenantId);
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: label, action: "update", actorId: userId, actorEmail: email, changes: Object.entries(patch).map(([k, v]) => ({ field: `${who} ${k}`, from: rs[k] ?? null, to: v })) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id, sid } = await params;
    const rs = await load(admin, tenantId, id, sid);
    if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
    if (rs.status !== "pending") return NextResponse.json({ error: "This supplier was already sent the RFQ — remove them instead, so the history stays." }, { status: 409 });
    await admin.from("rfq_suppliers").delete().eq("id", sid).eq("tenant_id", tenantId);
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: rs.rfqs?.ref ?? null, action: "update", actorId: userId, actorEmail: email, changes: [{ field: "supplier removed", from: rs.suppliers?.name ?? null, to: null }] });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
