import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle, sendToSupplier, storeAttachment } from "@/lib/rfq/server";
import { getTenant } from "@/lib/tenant";
import { RFQ_LIMITS, type RfqAttachment } from "@/lib/rfq/types";

// The RFQ conversation.
// GET                                   -- every message, oldest first
// POST JSON or multipart:
//   { rfq_supplier_id, body, kind: "email" }  -- email the supplier from inside
//        the RFQ (through the tenant's mail channel, threaded by the subject tag)
//   { rfq_supplier_id?, body, kind: "note" }  -- internal note, or a record of a
//        call / WhatsApp exchange; never leaves the workspace
//   multipart adds files[] -- attached to the email, or kept on the note

export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const { id } = await params;
    const { data: rfq } = await admin.from("rfqs").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const { data } = await admin.from("rfq_messages").select("*").eq("tenant_id", tenantId).eq("rfq_id", id).order("created_at").limit(500);
    return NextResponse.json({ messages: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { id } = await params;
    let body: { rfq_supplier_id?: string; body?: string; kind?: string; channel?: string } = {};
    const files: File[] = [];
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      body = { rfq_supplier_id: String(form.get("rfq_supplier_id") ?? "") || undefined, body: String(form.get("body") ?? ""), kind: String(form.get("kind") ?? "note"), channel: String(form.get("channel") ?? "") };
      for (const f of form.getAll("files")) if (f instanceof File && f.size > 0) files.push(f);
    } else {
      body = (await req.json().catch(() => ({}))) as typeof body;
    }
    const text = (body.body ?? "").trim().slice(0, 10000);
    if (!text && !files.length) return NextResponse.json({ error: "Write a message." }, { status: 422 });
    if (files.length > RFQ_LIMITS.maxAttachmentsPerMessage) return NextResponse.json({ error: `At most ${RFQ_LIMITS.maxAttachmentsPerMessage} files.` }, { status: 422 });
    if (files.some((f) => f.size > RFQ_LIMITS.maxAttachmentBytes)) return NextResponse.json({ error: "Each file must be 10 MB or less." }, { status: 413 });

    const bundle = await loadRfqBundle(ctx.admin, ctx.tenantId, id, { messages: false });
    if (!bundle) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const rs = body.rfq_supplier_id ? bundle.suppliers.find((s) => s.id === body.rfq_supplier_id) : undefined;
    if (body.rfq_supplier_id && !rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });

    const buffers = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) })));

    if (body.kind === "email") {
      if (!rs) return NextResponse.json({ error: "Choose which supplier to email." }, { status: 422 });
      if (!text) return NextResponse.json({ error: "Write a message." }, { status: 422 });
      const tenant = await getTenant();
      if (!tenant || tenant.id !== ctx.tenantId) return NextResponse.json({ error: "Workspace not resolved" }, { status: 400 });
      const r = await sendToSupplier(ctx.admin, { tenant, bundle, rs, kind: "message", message: text, attachments: buffers, actor: { id: ctx.userId, email: ctx.email } });
      if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 502 });
      // Keep a copy of what was attached on the stored message.
      if (buffers.length) {
        const stored: RfqAttachment[] = [];
        for (const b of buffers) { const a = await storeAttachment(ctx.admin, ctx.tenantId, id, b); if (a) stored.push(a); }
        const { data: last } = await ctx.admin.from("rfq_messages").select("id").eq("tenant_id", ctx.tenantId).eq("rfq_id", id).eq("direction", "out").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (last) await ctx.admin.from("rfq_messages").update({ attachments: stored }).eq("id", last.id).eq("tenant_id", ctx.tenantId);
      }
      return NextResponse.json({ ok: true, redirected: r.redirected });
    }

    const stored: RfqAttachment[] = [];
    for (const b of buffers) {
      const a = await storeAttachment(ctx.admin, ctx.tenantId, id, b);
      if (!a) return NextResponse.json({ error: `${b.filename}: only PDF, Excel, CSV, Word, JPG or PNG files can be kept.` }, { status: 422 });
      stored.push(a);
    }
    const channel = body.channel === "whatsapp" ? "whatsapp" : "system";
    const { error } = await ctx.admin.from("rfq_messages").insert({
      tenant_id: ctx.tenantId, rfq_id: id, rfq_supplier_id: rs?.id ?? null, direction: "note", channel,
      body_text: text, attachments: stored, status: "logged", created_by: ctx.userId,
      subject: channel === "whatsapp" ? "WhatsApp" : "Note",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
