import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { defaultLineVat, einvoicingEnabled } from "@/lib/einvoicing/server";
import { cleanLineVat } from "@/lib/einvoicing/invoiceFields";
import { isSchemaPending } from "@/lib/marketing/pending";

async function recomputeTotal(supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"], invoiceId: string, tenantId: string) {
  const { data: lines } = await supabase.from("invoice_lines").select("amount").eq("invoice_id", invoiceId);
  const total = (lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
  await supabase.from("invoices").update({ total }).eq("id", invoiceId).eq("tenant_id", tenantId);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (invoice.status !== "draft") return NextResponse.json({ error: "Only draft invoices can have lines added" }, { status: 409 });

  const body = await request.json();
  const { description, uom, qty, rate } = body;
  if (!description?.trim()) return NextResponse.json({ error: "description is required" }, { status: 400 });

  const { count } = await supabase.from("invoice_lines").select("id", { count: "exact", head: true }).eq("invoice_id", id);
  const q = Math.max(0, parseFloat(qty) || 1);
  const r = Math.max(0, parseFloat(rate) || 0);

  const baseRow = {
    tenant_id: tenantId,
    invoice_id: id,
    sl_no: String((count ?? 0) + 1),
    description: description.trim(),
    uom: uom || null,
    qty: q,
    rate: r,
    amount: q * r,
  };
  // Saudi e-invoicing (0219): a new line gets the VAT category it was sent with, else the standard one. Other workspaces: nothing added.
  const einv = await einvoicingEnabled(supabase, tenantId);
  const vat = einv ? (() => { const v = cleanLineVat(body); return v.vat_category ? v : defaultLineVat(); })() : {};
  let { data, error } = await supabase.from("invoice_lines").insert({ ...baseRow, ...vat }).select("*").single();
  if (error && einv && isSchemaPending(error)) {
    ({ data, error } = await supabase.from("invoice_lines").insert(baseRow).select("*").single());
  }

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to add the line" }, { status: 500 });
  await recomputeTotal(supabase, id, tenantId);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "invoices", objectId: id, objectLabel: invoice.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Line added", from: null, to: `${data.description}: qty ${data.qty} × rate ${data.rate} = ${data.amount}` }],
  });

  return NextResponse.json(data, { status: 201 });
}
