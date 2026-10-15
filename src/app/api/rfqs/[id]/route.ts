import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle, originHref, refreshRfqStatus, replyLink, documentLinesFor } from "@/lib/rfq/server";
import { logChange, diffForLog } from "@/lib/changeLog";
import { RFQ_LIMITS, rfqConfig } from "@/lib/rfq/types";
import { linkExpiry } from "@/lib/rfq/rules";
import { getTenant } from "@/lib/tenant";
import { whatsappText } from "@/lib/rfq/compose";

// One RFQ. GET is the whole bundle the detail screen needs; PATCH edits the
// header (explicit allowlist) or runs an action; DELETE removes a draft.
//
// PATCH { title?, respond_by?, required_by?, delivery_terms?, currency?,
//         notes_to_supplier?, notes_internal?, custom_data? }
// PATCH { action: "cancel" | "close" | "reopen" }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const { id } = await params;
    const b = await loadRfqBundle(admin, tenantId, id);
    if (!b) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });

    const productIds = [...new Set(b.lines.map((l) => l.product_id).filter((x): x is string => !!x))];
    const { data: products } = productIds.length
      ? await admin.from("products").select("id, ref, name").eq("tenant_id", tenantId).in("id", productIds)
      : { data: [] };
    let caseId: string | null = null;
    if (b.rfq.origin_type === "inspection_report" && b.rfq.origin_id) {
      const { data } = await admin.from("inspection_reports").select("case_id").eq("id", b.rfq.origin_id).eq("tenant_id", tenantId).maybeSingle();
      caseId = (data?.case_id as string | undefined) ?? null;
    }
    // Inbound messages count as read once someone opens the conversation.
    const unread = b.messages.filter((m) => m.direction === "in" && !m.read_at).map((m) => m.id);
    if (unread.length) await admin.from("rfq_messages").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenantId).in("id", unread);

    const tenant = await getTenant();
    const cfg = rfqConfig(tenant?.config?.rfq);
    const suppliers = b.suppliers.map(({ token_nonce, ...rs }) => {
      // The share link is computed for the screen (copy / WhatsApp), never
      // stored, and only ever returned to the buyer.
      const link = tenant && rs.status !== "cancelled" ? replyLink(tenant, rs.id, token_nonce, linkExpiry(b.rfq.respond_by, cfg.link_grace_days)) : null;
      return {
        ...rs,
        reply_link: link,
        whatsapp_text: link && tenant ? whatsappText({ ref: b.rfq.ref ?? "RFQ", title: b.rfq.title, tenantName: tenant.name, respondBy: b.rfq.respond_by }, link) : null,
      };
    });
    return NextResponse.json({
      ...b,
      suppliers,
      unread_marked: unread.length,
      products: products ?? [],
      origin_href: originHref(b.rfq.origin_type, b.rfq.origin_id, { caseId }),
      used_on: await documentLinesFor(admin, tenantId, b.rfq.origin_type, b.rfq.origin_id, b.lines.map((l) => l.id)),
      mail_mode: cfg.mail_mode,
      tenant_currency: tenant?.config?.currency ?? "INR",
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const { data: before } = await admin.from("rfqs").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!before) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();

    if (typeof body.action === "string") {
      const next = body.action === "cancel" ? "cancelled" : body.action === "close" ? "closed" : body.action === "reopen" ? "sent" : null;
      if (!next) return NextResponse.json({ error: "Unknown action" }, { status: 422 });
      if (body.action === "reopen" && !["closed", "cancelled"].includes(before.status as string)) {
        return NextResponse.json({ error: "Only a closed or cancelled RFQ can be reopened." }, { status: 409 });
      }
      await admin.from("rfqs").update({ status: next, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
      if (body.action === "cancel" || body.action === "close") {
        // Every outstanding reply link dies with the RFQ: rotate the nonces.
        const { data: sups } = await admin.from("rfq_suppliers").select("id").eq("tenant_id", tenantId).eq("rfq_id", id);
        for (const s of (sups ?? []) as { id: string }[]) {
          await admin.from("rfq_suppliers").update({ token_nonce: crypto.randomUUID().replace(/-/g, ""), updated_at: now }).eq("id", s.id).eq("tenant_id", tenantId);
        }
      }
      const status = body.action === "reopen" ? await refreshRfqStatus(admin, tenantId, id) : next;
      await logChange(admin, {
        tenantId, objectType: "rfqs", objectId: id, objectLabel: before.ref as string,
        action: body.action === "reopen" ? "reopen" : "update", actorId: userId, actorEmail: email,
        changes: [{ field: "status", from: before.status, to: status }],
      });
      return NextResponse.json({ ok: true, status });
    }

    const patch: Record<string, unknown> = {};
    const text = (k: string, max: number) => {
      if (!(k in body)) return;
      const v = body[k];
      patch[k] = typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    };
    text("delivery_terms", 500);
    text("notes_to_supplier", RFQ_LIMITS.maxText);
    text("notes_internal", RFQ_LIMITS.maxText);
    if ("title" in body) {
      const t = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
      if (!t) return NextResponse.json({ error: "Title can't be empty." }, { status: 422 });
      patch.title = t;
    }
    if ("currency" in body) patch.currency = typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency.trim()) ? body.currency.trim().toUpperCase() : null;
    for (const k of ["respond_by", "required_by"]) {
      if (k in body) patch[k] = typeof body[k] === "string" && DATE_RE.test(body[k] as string) ? body[k] : null;
    }
    if ("custom_data" in body && body.custom_data && typeof body.custom_data === "object") {
      const cf = Object.fromEntries(Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_")));
      patch.custom_data = { ...((before.custom_data as Record<string, unknown> | null) ?? {}), ...cf };
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
    const { error } = await admin.from("rfqs").update({ ...patch, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const changes = diffForLog("rfqs", before as Record<string, unknown>, patch);
    if (changes.length) await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: before.ref as string, action: "update", actorId: userId, actorEmail: email, changes });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const { data: before } = await admin.from("rfqs").select("id, ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!before) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (before.status !== "draft") return NextResponse.json({ error: "Only a draft can be deleted — cancel a sent RFQ instead, so the supplier conversation is kept." }, { status: 409 });
    const { error } = await admin.from("rfqs").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: before.ref as string, action: "delete", actorId: userId, actorEmail: email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
