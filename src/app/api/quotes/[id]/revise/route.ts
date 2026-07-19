import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

// Clone a quote (and its lines) into a new draft revision.
// Used when the original is already sent/approved and must not be edited in place.
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

  const newRev = (original.revision ?? 1) + 1;
  const baseRef = String(original.ref).replace(/-R\d+$/, "");
  const newRef  = `${baseRef}-R${newRev}`;

  const { data: created, error: cErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      account_id: original.account_id,
      ref: newRef,
      type: original.type,
      status: "draft",
      total: original.total ?? 0,
      valid_until: original.valid_until,
      notes: original.notes,
      terms: original.terms ?? null,
      scope_of_work: original.scope_of_work ?? null,
      revision: newRev,
      selected_option_id: original.selected_option_id ?? null,
      meta: original.meta ?? null,
      gst_rate: original.gst_rate ?? null,
    })
    .select("id, ref")
    .single();

  if (cErr || !created) {
    return NextResponse.json({ error: cErr?.message ?? "Failed to create revision" }, { status: 500 });
  }

  const { data: lines } = await supabase
    .from("quote_lines")
    .select("description, qty, rate, discount_pct, amount, group_id, group_label, group_type")
    .eq("quote_id", id)
    .eq("tenant_id", tenantId);

  if (Array.isArray(lines) && lines.length > 0) {
    const rows = lines.map((l) => ({ ...l, tenant_id: tenantId, quote_id: created.id }));
    const { error: lErr } = await supabase.from("quote_lines").insert(rows);
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  }

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id: created.id,
    rev: newRev,
    date: new Date().toISOString().split("T")[0],
    description: `Revised from ${original.ref}`,
  });

  return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
}
