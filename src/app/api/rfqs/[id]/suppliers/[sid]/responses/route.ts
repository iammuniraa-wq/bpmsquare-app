import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, saveResponses, storeAttachment, type RfqSupplierRow } from "@/lib/rfq/server";
import { cleanResponse, type CleanResponse, type ResponseInput } from "@/lib/rfq/rules";
import { parseReplySheet } from "@/lib/rfq/sheet";
import { logChange } from "@/lib/changeLog";
import { RFQ_LIMITS } from "@/lib/rfq/types";

// The buyer records a supplier's answer -- the common case when a supplier
// just replies to the email with a PDF.
// PUT  { rows: [{ rfq_line_id, status?, unit_price, currency?, lead_time_days?, moq?,
//                 valid_until?, note?, offered_description? }],
//        header?: { supplier_quote_ref?, currency?, incoterm?, freight_amount?,
//                   payment_terms?, valid_until?, note? }, declined?: boolean }
// POST multipart { file }  -- the supplier's returned Excel reply sheet;
//        rows are matched on the hidden line id and saved. The file itself
//        is kept on the conversation.

async function loadRs(admin: Parameters<typeof saveResponses>[0], tenantId: string, rfqId: string, sid: string) {
  const { data } = await admin.from("rfq_suppliers").select("id, status, currency, suppliers(name), rfqs(id, ref, status)")
    .eq("id", sid).eq("tenant_id", tenantId).eq("rfq_id", rfqId).maybeSingle();
  return data as unknown as (Pick<RfqSupplierRow, "id" | "status" | "currency"> & { suppliers: { name: string } | null; rfqs: { id: string; ref: string; status: string } | null }) | null;
}

function cleanHeader(h: Record<string, unknown> | undefined) {
  if (!h) return undefined;
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const out: Record<string, unknown> = {};
  if ("supplier_quote_ref" in h) out.supplier_quote_ref = s(h.supplier_quote_ref, 80);
  if ("currency" in h) out.currency = typeof h.currency === "string" && /^[A-Za-z]{3}$/.test(h.currency.trim()) ? h.currency.trim().toUpperCase() : null;
  if ("incoterm" in h) out.incoterm = s(h.incoterm, 40);
  if ("payment_terms" in h) out.payment_terms = s(h.payment_terms, 200);
  if ("note" in h) out.note = s(h.note, 2000);
  if ("valid_until" in h) out.valid_until = typeof h.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.valid_until) ? h.valid_until : null;
  if ("freight_amount" in h) {
    const n = h.freight_amount === null || h.freight_amount === "" ? null : Number(h.freight_amount);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > RFQ_LIMITS.maxPrice)) throw { status: 422, message: "Freight must be a positive number." };
    out.freight_amount = n;
  }
  return out;
}

function cleanAll(inputs: ResponseInput[]): CleanResponse[] {
  const rows: CleanResponse[] = [];
  for (const [i, input] of inputs.entries()) {
    const c = cleanResponse(input);
    if (!c.ok) throw { status: 422, message: `Row ${i + 1}: ${c.error}` };
    if (c.value) rows.push(c.value);
  }
  return rows;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id, sid } = await params;
    const rs = await loadRs(admin, tenantId, id, sid);
    if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
    if (["closed", "cancelled"].includes(rs.rfqs?.status ?? "")) return NextResponse.json({ error: "This RFQ is closed." }, { status: 409 });
    const body = (await req.json().catch(() => ({}))) as { rows?: ResponseInput[]; header?: Record<string, unknown>; declined?: boolean };
    const rows = cleanAll(Array.isArray(body.rows) ? body.rows.slice(0, RFQ_LIMITS.maxLines) : []);
    const header = cleanHeader(body.header);
    const res = await saveResponses(admin, { tenantId, rfqId: id, rs, rows, source: "buyer", header, declined: body.declined === true });
    await logChange(admin, {
      tenantId, objectType: "rfqs", objectId: id, objectLabel: rs.rfqs?.ref ?? null, action: "update", actorId: userId, actorEmail: email,
      changes: [{ field: `reply from ${rs.suppliers?.name ?? "supplier"}`, from: null, to: body.declined ? "declined" : `${res.saved} line(s) entered` }],
    });
    return NextResponse.json({ ok: true, saved: res.saved });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id, sid } = await params;
    const rs = await loadRs(admin, tenantId, id, sid);
    if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach the supplier's reply sheet." }, { status: 422 });
    if (file.size > RFQ_LIMITS.maxAttachmentBytes) return NextResponse.json({ error: "That file is larger than 10 MB." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    const { data: lineRows } = await admin.from("rfq_lines").select("id").eq("tenant_id", tenantId).eq("rfq_id", id);
    const valid = new Set(((lineRows ?? []) as { id: string }[]).map((l) => l.id));
    let inputs: ResponseInput[];
    try {
      inputs = await parseReplySheet(buf, valid);
    } catch {
      return NextResponse.json({ error: "That file couldn't be read as the RFQ reply sheet (.xlsx)." }, { status: 422 });
    }
    if (!inputs.length) return NextResponse.json({ error: "No rows of this RFQ were found in that sheet — use the reply sheet that came with the RFQ email." }, { status: 422 });
    const rows = cleanAll(inputs);
    const res = await saveResponses(admin, { tenantId, rfqId: id, rs, rows, source: "upload" });
    const stored = await storeAttachment(admin, tenantId, id, {
      filename: file.name, contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: buf,
    });
    await admin.from("rfq_messages").insert({
      tenant_id: tenantId, rfq_id: id, rfq_supplier_id: sid, direction: "note", channel: "system",
      subject: "Reply sheet uploaded", body_text: `${res.saved} line(s) read from ${file.name}`, attachments: stored ? [stored] : [],
      status: "logged", created_by: userId,
    });
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: rs.rfqs?.ref ?? null, action: "update", actorId: userId, actorEmail: email, changes: [{ field: `reply sheet from ${rs.suppliers?.name ?? "supplier"}`, from: null, to: `${res.saved} line(s)` }] });
    return NextResponse.json({ ok: true, saved: res.saved });
  } catch (e) {
    return errorResponse(e);
  }
}
