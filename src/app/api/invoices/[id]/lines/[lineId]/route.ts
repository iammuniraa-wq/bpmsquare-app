import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

async function recomputeTotal(supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"], invoiceId: string, tenantId: string) {
  const { data: lines } = await supabase.from("invoice_lines").select("amount").eq("invoice_id", invoiceId);
  const total = (lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
  await supabase.from("invoices").update({ total }).eq("id", invoiceId).eq("tenant_id", tenantId);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id, lineId } = await params;
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Only draft invoice lines can be edited" }, { status: 409 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if ("description" in body) patch.description = body.description;
  if ("uom" in body) patch.uom = body.uom;
  if ("qty" in body) patch.qty = Math.max(0, parseFloat(body.qty) || 0);
  if ("rate" in body) patch.rate = Math.max(0, parseFloat(body.rate) || 0);

  const { data: existing } = await supabase.from("invoice_lines").select("qty, rate").eq("id", lineId).eq("invoice_id", id).single();
  if (!existing) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const qty = "qty" in patch ? (patch.qty as number) : existing.qty;
  const rate = "rate" in patch ? (patch.rate as number) : existing.rate;
  patch.amount = qty * rate;

  const { data, error } = await supabase
    .from("invoice_lines")
    .update(patch)
    .eq("id", lineId)
    .eq("invoice_id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recomputeTotal(supabase, id, tenantId);
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id, lineId } = await params;
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Only draft invoice lines can be removed" }, { status: 409 });

  const { error } = await supabase.from("invoice_lines").delete().eq("id", lineId).eq("invoice_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recomputeTotal(supabase, id, tenantId);
  return new NextResponse(null, { status: 204 });
}
