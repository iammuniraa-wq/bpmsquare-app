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
  const [{ data: po, error }, { data: lines }] = await Promise.all([
    supabase.from("purchase_orders").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("sl_no"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...po, lines: lines ?? [] });
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

  // status here is header-level transitions only (draft -> sent / cancelled); "partially_received"
  // and "received" are only ever set by the /receive endpoint based on actual received quantities.
  if (body.status && !["draft", "sent", "cancelled"].includes(body.status)) {
    return NextResponse.json({ error: "status must be one of: draft, sent, cancelled" }, { status: 400 });
  }

  const allowed = ["notes", "terms", "order_date", "expected_date", "status", "custom_data"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  const { data, error } = await supabase
    .from("purchase_orders")
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
  const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (po.status !== "draft") {
    return NextResponse.json({ error: "Only draft purchase orders can be deleted" }, { status: 409 });
  }

  const { error } = await supabase.from("purchase_orders").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
