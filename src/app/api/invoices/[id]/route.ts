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
  const [{ data: invoice, error }, { data: lines }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sl_no"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...invoice, lines: lines ?? [] });
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

  const { data, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") {
    return NextResponse.json({ error: "Only draft invoices can be deleted" }, { status: 409 });
  }

  const { error } = await supabase.from("invoices").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
