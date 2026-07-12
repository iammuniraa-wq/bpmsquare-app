import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// Full edit of a DRAFT quote: header fields + line items (replaced wholesale).
// Server enforces draft-only; sent/approved quotes must use /revise instead.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();
  const { valid_until, notes, terms, scope_of_work, lines, selected_option_id, status } = body;

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, status, discount_type, discount_pct, discount_fixed, selected_option_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Normalize incoming lines and compute total.
  const cleanLines = Array.isArray(lines)
    ? lines
        .filter((l) => l?.description?.trim())
        .slice(0, 200)
        .map((l) => {
          const qty  = Math.max(0, parseFloat(l.qty) || 0);
          const rate = Math.max(0, parseFloat(l.rate) || 0);
          const disc = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
          return {
            tenant_id: tenantId,
            quote_id: id,
            description: String(l.description).slice(0, 500),
            uom: l.uom || null,
            qty,
            rate,
            discount_pct: disc,
            amount: qty * rate * (1 - disc / 100),
            sl_no:             l.sl_no             ?? null,
            group_id:          l.group_id          ?? null,
            group_label:       l.group_label       ?? null,
            group_type:        l.group_type        ?? null,
            group_description: l.group_description ?? null,
          };
        })
    : [];

  // selected_option_id marks which "alternative" (Option A/B) group counts toward the total;
  // items in other alternative groups are kept (so the option can be switched later) but excluded here.
  const effectiveAltId: string | null = selected_option_id !== undefined ? selected_option_id : (quote.selected_option_id ?? null);
  const subtotal = cleanLines
    .filter((l) => !l.group_id || l.group_type !== "alternative" || l.group_id === effectiveAltId)
    .reduce((s, l) => s + l.amount, 0);
  const discPct = Math.max(0, Math.min(100, parseFloat(String(quote.discount_pct)) || 0));
  const discAmount = quote.discount_type === "fixed"
    ? Math.min(Math.round(parseFloat(String(quote.discount_fixed)) || 0), subtotal)
    : Math.round(subtotal * discPct / 100);
  const total = subtotal - discAmount;

  // Update header
  const headerPatch: Record<string, unknown> = {
    valid_until: valid_until || null,
    notes: notes ?? null,
    terms: terms ?? null,
    scope_of_work: scope_of_work ?? null,
    selected_option_id: effectiveAltId,
    total,
  };
  if (status !== undefined) headerPatch.status = status;

  const admin = createAdminSupabase();

  const { error: uErr } = await admin
    .from("quotes")
    .update(headerPatch)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (uErr) { console.error("[edit] header update failed", uErr); return NextResponse.json({ error: uErr.message }, { status: 500 }); }

  // Replace lines wholesale
  const { error: dErr } = await admin
    .from("quote_lines")
    .delete()
    .eq("quote_id", id)
    .eq("tenant_id", tenantId);

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  if (cleanLines.length > 0) {
    const { error: iErr } = await admin.from("quote_lines").insert(cleanLines);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({ id, total }, { status: 200 });
}
