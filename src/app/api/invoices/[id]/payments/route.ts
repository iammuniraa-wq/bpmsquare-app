import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("invoice_payments")
    .select("*")
    .eq("invoice_id", id)
    .eq("tenant_id", tenantId)
    .order("paid_on", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();
  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "amount is required and must be positive" }, { status: 400 });
  }

  const { data: invoice } = await supabase.from("invoices").select("status, total").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "draft" || invoice.status === "cancelled") {
    return NextResponse.json({ error: `Cannot record a payment against a ${invoice.status} invoice` }, { status: 409 });
  }

  const { error: payErr } = await supabase.from("invoice_payments").insert({
    tenant_id: tenantId,
    invoice_id: id,
    amount,
    paid_on: body.paid_on || new Date().toISOString().slice(0, 10),
    method: body.method || null,
    reference: body.reference || null,
    note: body.note || null,
    created_by: userId,
  });
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  const { data: payments } = await supabase.from("invoice_payments").select("amount").eq("invoice_id", id);
  const paidAmount = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
  const newStatus = paidAmount >= invoice.total ? "paid" : paidAmount > 0 ? "partial" : invoice.status;

  const { data: updated, error: updErr } = await supabase
    .from("invoices")
    .update({ paid_amount: paidAmount, status: newStatus })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json(updated, { status: 201 });
}
