import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const {
    account_id, type, total, valid_until, notes, terms, scope_of_work,
    entity_id, lines, selected_option_id, meta,
    name, contact_id, po_number, po_amount,
    discount_type, discount_pct, discount_fixed, asset_ids,
    case_id,
  } = body;

  if (!account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  // Verify account belongs to this tenant
  const { data: acct } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", account_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!acct) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Server-side sequential ref generation
  const { count } = await supabase
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const ref = `QT-${new Date().getFullYear()}-${seq}`;

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      account_id,
      ref,
      type: type ?? "quotation",
      status: "draft",
      total: total ?? 0,
      valid_until: valid_until || null,
      notes: notes || null,
      terms: terms || null,
      scope_of_work: scope_of_work || null,
      entity_id: entity_id || null,
      name: name || null,
      contact_id: contact_id || null,
      po_number: po_number || null,
      po_amount: po_amount ? parseFloat(po_amount) : null,
      discount_type: discount_type ?? "pct",
      discount_pct: parseFloat(discount_pct) || 0,
      discount_fixed: parseFloat(discount_fixed) || 0,
      asset_ids: Array.isArray(asset_ids) ? asset_ids : [],
      revision: 1,
      selected_option_id: selected_option_id ?? null,
      meta: meta ?? null,
    })
    .select("id, ref")
    .single();

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  if (Array.isArray(lines) && lines.length > 0) {
    const lineRows = lines
      .filter((l) => l.description?.trim())
      .slice(0, 200)
      .map((l) => {
        const qty  = Math.max(0, parseFloat(l.qty) || 1);
        const rate = Math.max(0, parseFloat(l.rate) || 0);
        const disc = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
        return {
          tenant_id: tenantId,
          quote_id: quote.id,
          description: String(l.description).slice(0, 500),
          uom: l.uom || null,
          qty,
          rate,
          discount_pct: disc,
          amount: qty * rate * (1 - disc / 100),
          group_id:    l.group_id    ?? null,
          group_label: l.group_label ?? null,
          group_type:  l.group_type  ?? null,
        };
      });
    if (lineRows.length > 0) {
      const { error: lErr } = await supabase.from("quote_lines").insert(lineRows);
      if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    }
  }

  // Link quote back to the originating case
  if (case_id) {
    await supabase
      .from("service_cases")
      .update({ quote_id: quote.id, status: "quote_sent" })
      .eq("id", case_id)
      .eq("tenant_id", tenantId);
  }

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id: quote.id,
    rev: 1,
    date: new Date().toISOString().split("T")[0],
    description: "Initial draft",
  });

  return NextResponse.json({ id: quote.id, ref: quote.ref }, { status: 201 });
}
