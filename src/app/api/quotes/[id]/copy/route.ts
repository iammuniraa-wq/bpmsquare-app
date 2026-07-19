import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

// Duplicate a quote as a brand-new draft with a fresh QT- reference number.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: original, error: qErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (qErr || !original) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Generate a new sequential ref
  const { count } = await supabase
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const newRef = `QT-${new Date().getFullYear()}-${seq}`;

  const { data: created, error: cErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      account_id:        original.account_id,
      contact_id:        original.contact_id ?? null,
      entity_id:         original.entity_id ?? null,
      ref:               newRef,
      name:              original.name ? `Copy of ${original.name}` : null,
      type:              original.type,
      status:            "draft",
      total:             original.total ?? 0,
      valid_until:       original.valid_until ?? null,
      notes:             original.notes ?? null,
      terms:             original.terms ?? null,
      scope_of_work:     original.scope_of_work ?? null,
      revision:          1,
      discount_type:     original.discount_type ?? "pct",
      discount_pct:      original.discount_pct ?? 0,
      discount_fixed:    original.discount_fixed ?? 0,
      gst_rate:          original.gst_rate ?? null,
      selected_option_id: null,
      meta:              original.meta ?? null,
      custom_data:       original.custom_data ?? null,
      territory:         original.territory ?? null,
      sales_org:         original.sales_org ?? null,
    })
    .select("id, ref")
    .single();

  if (cErr || !created) {
    return NextResponse.json({ error: cErr?.message ?? "Failed to copy quote" }, { status: 500 });
  }

  // Copy all line items
  const { data: lines } = await supabase
    .from("quote_lines")
    .select("description, qty, rate, discount_pct, amount, uom, sl_no, group_id, group_label, group_type, group_description, category, deduction")
    .eq("quote_id", id)
    .eq("tenant_id", tenantId);

  if (Array.isArray(lines) && lines.length > 0) {
    const rows = lines.map((l) => ({ ...l, tenant_id: tenantId, quote_id: created.id }));
    const { error: lErr } = await supabase.from("quote_lines").insert(rows);
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  }

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id:  created.id,
    rev:       1,
    date:      new Date().toISOString().split("T")[0],
    description: `Copied from ${original.ref}`,
  });

  return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
}
