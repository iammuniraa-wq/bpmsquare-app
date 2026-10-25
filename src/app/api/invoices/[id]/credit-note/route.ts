import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";
import { logChange } from "@/lib/changeLog";
import { buildNoteFromInvoice } from "@/lib/einvoicing/creditNote";
import { einvoiceColumnsPresent, loadEinvoiceTenant } from "@/lib/einvoicing/server";
import type { EinvoiceLineInput } from "@/lib/einvoicing/rules";

// POST /api/invoices/[id]/credit-note  { reason }
// Saudi e-invoicing: raises a credit note that corrects an issued invoice in full. The note is a new DRAFT invoice with the same
// lines (amounts stay positive; the type says it is a credit), linked to the original, carrying the reason. Edit its lines or send
// it like any invoice; it becomes ready and takes its counter number the same way.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const tenant = await loadEinvoiceTenant(supabase, tenantId);
  if (!tenant.on) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await einvoiceColumnsPresent(supabase))) {
    return NextResponse.json({ error: "Needs a database update (bundle 30, e-invoicing data).", needsDatabaseUpdate: true }, { status: 503 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "A credit note needs a reason." }, { status: 400 });

  // The original is looked up by id AND tenant: another workspace's invoice id simply matches nothing.
  const { data: original } = await supabase.from("invoices").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!original) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (original.einvoice_doc_type === "credit_note" || original.einvoice_doc_type === "debit_note") {
    return NextResponse.json({ error: "A credit or debit note cannot itself be credited." }, { status: 409 });
  }
  if (original.status === "draft" || original.status === "cancelled") {
    return NextResponse.json({ error: "Only an issued invoice can be credited. Edit or cancel a draft instead." }, { status: 409 });
  }

  const { data: existing } = await supabase
    .from("invoices").select("ref, status").eq("tenant_id", tenantId).eq("original_invoice_id", id).neq("status", "cancelled").limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: `A credit note (${existing[0].ref}) already exists for this invoice.` }, { status: 409 });
  }

  const { data: lines } = await supabase.from("invoice_lines").select("*").eq("invoice_id", id).eq("tenant_id", tenantId).order("sl_no");
  if (!lines || lines.length === 0) return NextResponse.json({ error: "The invoice has no lines to credit." }, { status: 409 });

  let note;
  try {
    note = buildNoteFromInvoice(original, lines as EinvoiceLineInput[], reason, "credit_note");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not build the credit note" }, { status: 400 });
  }

  let created: { id: string; ref: string } | null = null;
  let lastErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const ref = await generateNextInvoiceRef(supabase, tenantId);
    const result = await supabase.from("invoices").insert({
      tenant_id: tenantId,
      ref,
      status: "draft",
      total: note.total,
      ...note.header,
      einvoice_uuid: randomUUID(),
      created_by: userId,
    }).select("id, ref").single();
    if (!result.error) created = result.data;
    else if (result.error.code === "23505") lastErr = result.error;
    else { lastErr = result.error; break; }
  }
  if (!created) return NextResponse.json({ error: lastErr?.message ?? "Failed to create the credit note" }, { status: 500 });

  const { error: linesErr } = await supabase
    .from("invoice_lines")
    .insert(note.lines.map((l) => ({ ...l, tenant_id: tenantId, invoice_id: created!.id })));
  if (linesErr) {
    // Do not leave a header with no lines behind.
    await supabase.from("invoices").delete().eq("id", created.id).eq("tenant_id", tenantId);
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "invoices", objectId: created.id, objectLabel: created.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [
      { field: "einvoice_doc_type", from: null, to: "credit_note" },
      { field: "original_invoice_id", from: null, to: original.ref },
      { field: "credit_reason", from: null, to: reason },
      { field: "total", from: null, to: note.total },
    ],
  });

  return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
}
