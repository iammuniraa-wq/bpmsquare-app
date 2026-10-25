import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { einvoicingEnabled } from "@/lib/einvoicing/server";
import { LINE_EINVOICE_KEYS, cleanLineVat } from "@/lib/einvoicing/invoiceFields";

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
  const { data: invoice } = await supabase.from("invoices").select("ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Only draft invoice lines can be edited" }, { status: 409 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if ("description" in body) patch.description = body.description;
  if ("uom" in body) patch.uom = body.uom;
  if ("qty" in body) patch.qty = Math.max(0, parseFloat(body.qty) || 0);
  if ("rate" in body) patch.rate = Math.max(0, parseFloat(body.rate) || 0);

  const { data: existing } = await supabase.from("invoice_lines").select("*").eq("id", lineId).eq("invoice_id", id).eq("tenant_id", tenantId).single();
  if (!existing) return NextResponse.json({ error: "Line not found" }, { status: 404 });

  // Saudi e-invoicing (0219): VAT category, rate and reason, made consistent (Z/E/O are 0%). Ignored for other workspaces.
  if (LINE_EINVOICE_KEYS.some((k) => k in body) && await einvoicingEnabled(supabase, tenantId)) {
    Object.assign(patch, cleanLineVat(body, existing as { vat_category?: null; vat_rate?: number | null; vat_exemption_reason?: string | null }));
  }
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

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "invoices", objectId: id, objectLabel: invoice.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [
      ...(qty !== existing.qty || rate !== existing.rate || !LINE_EINVOICE_KEYS.some((k) => k in patch) ? [{
        field: `Line: ${existing.description}`,
        from: `qty ${existing.qty} × rate ${existing.rate}`,
        to: `qty ${qty} × rate ${rate}`,
      }] : []),
      ...LINE_EINVOICE_KEYS.filter((k) => k in patch && patch[k] !== (existing as Record<string, unknown>)[k]).map((k) => ({
        field: `Line ${existing.description}: ${k}`,
        from: (existing as Record<string, unknown>)[k] ?? null,
        to: patch[k] ?? null,
      })),
    ],
  });

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
  const { data: invoice } = await supabase.from("invoices").select("ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Only draft invoice lines can be removed" }, { status: 409 });

  const { data: existing } = await supabase.from("invoice_lines").select("description, qty, rate, amount").eq("id", lineId).eq("invoice_id", id).maybeSingle();

  const { error } = await supabase.from("invoice_lines").delete().eq("id", lineId).eq("invoice_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recomputeTotal(supabase, id, tenantId);

  if (existing) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "invoices", objectId: id, objectLabel: invoice.ref,
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "Line removed", from: `${existing.description}: qty ${existing.qty} × rate ${existing.rate} = ${existing.amount}`, to: null }],
    });
  }

  return new NextResponse(null, { status: 204 });
}
