import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { resolveReply } from "@/lib/rfq/publicReply";
import { storeAttachment, saveResponses, notifyRfqTeam } from "@/lib/rfq/server";
import { parseReplySheet } from "@/lib/rfq/sheet";
import { cleanResponse, type CleanResponse } from "@/lib/rfq/rules";
import { RFQ_LIMITS } from "@/lib/rfq/types";

// POST multipart { file } -- the supplier attaches their own quotation (PDF,
// Excel, image) from the reply page. If it is the RFQ's own reply sheet, its
// rows are read into prices too. Same link checks as the reply API.

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ sid: string; token: string }> }) {
  const { sid, token } = await params;
  const admin = createAdminSupabase();
  const ctx = await resolveReply(admin, sid, token);
  if (!ctx.ok) return NextResponse.json({ error: "This link is no longer valid." }, { status: ctx.reason === "expired" ? 410 : 404 });
  if (!ctx.open) return NextResponse.json({ error: "This request is closed." }, { status: 409 });
  const tenantId = ctx.tenant.id;
  const rfqId = ctx.bundle.rfq.id;

  const { count } = await admin.from("rfq_messages").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("rfq_supplier_id", ctx.rs.id).eq("channel", "portal");
  if ((count ?? 0) >= RFQ_LIMITS.maxSubmissionsPerSupplier) return NextResponse.json({ error: "Too many uploads on this link. Please email the buyer instead." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file." }, { status: 422 });
  if (file.size > RFQ_LIMITS.maxAttachmentBytes) return NextResponse.json({ error: "Files must be 10 MB or less." }, { status: 413 });
  const content = Buffer.from(await file.arrayBuffer());
  const stored = await storeAttachment(admin, tenantId, rfqId, { filename: file.name, contentType: file.type || "application/octet-stream", content });
  if (!stored) return NextResponse.json({ error: "Only PDF, Excel, CSV, Word, JPG or PNG files can be uploaded." }, { status: 422 });

  let saved = 0;
  if (stored.content_type.includes("spreadsheetml")) {
    try {
      const valid = new Set(ctx.view.lines.map((l) => l.id));
      const rows: CleanResponse[] = [];
      for (const input of await parseReplySheet(content, valid)) {
        const c = cleanResponse(input);
        if (c.ok && c.value) rows.push(c.value);
      }
      if (rows.length) saved = (await saveResponses(admin, { tenantId, rfqId, rs: ctx.rs, rows, source: "link" })).saved;
    } catch { /* not our sheet -- kept as a plain attachment */ }
  }
  await admin.from("rfq_messages").insert({
    tenant_id: tenantId, rfq_id: rfqId, rfq_supplier_id: ctx.rs.id, direction: "in", channel: "portal",
    from_address: ctx.rs.email_to ?? ctx.rs.suppliers?.email ?? null,
    subject: "File uploaded", body_text: saved ? `${stored.filename} — ${saved} line(s) read from the reply sheet` : stored.filename,
    attachments: [stored], status: "received",
  });
  if (!saved && ["sent", "viewed", "pending"].includes(ctx.rs.status)) {
    await admin.from("rfq_suppliers").update({ status: "replied", replied_at: new Date().toISOString(), reply_source: "link", updated_at: new Date().toISOString() }).eq("id", ctx.rs.id).eq("tenant_id", tenantId);
  }
  await notifyRfqTeam(admin, ctx.tenant, ctx.bundle.rfq, `${ctx.rs.suppliers?.name ?? "A supplier"} uploaded ${stored.filename}`);
  return NextResponse.json({ ok: true, saved, filename: stored.filename });
}
