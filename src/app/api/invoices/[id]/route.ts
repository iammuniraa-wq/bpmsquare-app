import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitInvoiceSent, emitInvoiceOverdue } from "@/lib/events/emitters";
import { createAdminSupabase } from "@/lib/supabase-server";
import { einvoicingEnabled, gateIssue } from "@/lib/einvoicing/server";
import { INVOICE_EINVOICE_KEYS, cleanInvoiceEinvoicePatch, shapeInvoiceForApi, shapeLineForApi } from "@/lib/einvoicing/invoiceFields";
import type { EinvoiceDocType } from "@/lib/einvoicing/rules";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const [{ data: invoice, error }, { data: lines }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sl_no"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const einv = await einvoicingEnabled(supabase, tenantId);
  if (einv) return NextResponse.json({ ...invoice, lines: lines ?? [] });
  // The e-invoice columns exist on every row once migration 0219 is applied; only an e-invoicing workspace is shown them.
  return NextResponse.json({
    ...shapeInvoiceForApi(invoice as Record<string, unknown>, false),
    lines: (lines ?? []).map((l) => shapeLineForApi(l as Record<string, unknown>, false)),
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  // status here is header-level transitions only -- paid/partial are payment-derived and only
  // ever set by the /payments endpoint, never by direct PATCH.
  if (body.status && !["draft", "sent", "overdue", "cancelled"].includes(body.status)) {
    return NextResponse.json({ error: "status must be one of: draft, sent, overdue, cancelled" }, { status: 400 });
  }

  const allowed = ["due_date", "discount_type", "discount_pct", "discount_fixed", "notes", "terms", "status", "custom_data"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  const { data: before } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  // Saudi e-invoicing (0219): the supply date, a note's reason and the standard/simplified choice are the only e-invoice
  // fields a body may set. The UUID, counter and original-invoice link are the server's alone. A future "cleared" status
  // (E3) will make this route refuse every edit of a cleared or reported invoice here.
  const wantsEinvoice = INVOICE_EINVOICE_KEYS.some((k) => k in body);
  const einv = (wantsEinvoice || patch.status === "sent") && await einvoicingEnabled(supabase, tenantId);
  if (einv && wantsEinvoice) {
    Object.assign(patch, cleanInvoiceEinvoicePatch(body, ((before as { einvoice_doc_type?: EinvoiceDocType | null } | null)?.einvoice_doc_type) ?? null));
  }
  // Sending a draft is the moment an invoice becomes a tax document: it must be ready, and it takes its UUID and counter number.
  if (einv && patch.status === "sent" && (before as { status?: string } | null)?.status === "draft") {
    const gate = await gateIssue(createAdminSupabase(), tenantId, id);
    if (gate.block) return NextResponse.json(gate.body, { status: gate.status });
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("invoices", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "invoices", objectId: id, objectLabel: (data as { ref?: string }).ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  const beforeStatus = (before as { status?: string } | null)?.status;
  const row = data as { ref?: string; account_id: string; contact_id?: string | null; total?: number; paid_amount?: number; due_date?: string | null };
  if (patch.status === "sent" && beforeStatus !== "sent") {
    await emitInvoiceSent(tenantId, { invoiceId: id, ref: row.ref, total: row.total, accountId: row.account_id, contactId: row.contact_id, actorId: user?.id });
  } else if (patch.status === "overdue" && beforeStatus !== "overdue" && row.due_date) {
    await emitInvoiceOverdue(tenantId, { invoiceId: id, ref: row.ref, dueDate: row.due_date, outstanding: (row.total ?? 0) - (row.paid_amount ?? 0), accountId: row.account_id, contactId: row.contact_id });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: invoice } = await supabase.from("invoices").select("ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") {
    return NextResponse.json({ error: "Only draft invoices can be deleted" }, { status: 409 });
  }
  // Saudi e-invoicing: a number in the seller's counter is never given back, so an invoice that holds one is cancelled, not deleted.
  const { data: numbered } = await supabase.from("invoices").select("einvoice_seq").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if ((numbered as { einvoice_seq?: number | null } | null)?.einvoice_seq != null) {
    return NextResponse.json({ error: "This invoice has an e-invoice number. Cancel it instead of deleting it." }, { status: 409 });
  }

  const { error } = await supabase.from("invoices").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "invoices", objectId: id, objectLabel: invoice.ref,
    action: "delete", actorId: user?.id, actorEmail: user?.email,
  });

  return new NextResponse(null, { status: 204 });
}
