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
  const { account_id, ref, type, total, valid_until, notes, terms, lines, selected_option_id, meta } = body;

  if (!account_id || !ref) {
    return NextResponse.json({ error: "account_id and ref are required" }, { status: 400 });
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

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      account_id,
      ref,
      type: type ?? "repair",
      status: "draft",
      total: total ?? 0,
      valid_until: valid_until || null,
      notes: [notes, terms].filter(Boolean).join("\n\n") || null,
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

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id: quote.id,
    rev: 1,
    date: new Date().toISOString().split("T")[0],
    description: "Initial draft",
  });

  return NextResponse.json({ id: quote.id, ref: quote.ref }, { status: 201 });
}
