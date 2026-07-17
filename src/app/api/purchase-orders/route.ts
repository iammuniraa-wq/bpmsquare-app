import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { generateNextPoRef } from "@/lib/poRef";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplier_id");

  let query = supabase.from("purchase_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (supplierId) query = query.eq("supplier_id", supplierId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { supplier_id, quote_id, case_id, order_date, expected_date, notes, terms, lines } = body;

  if (!supplier_id) {
    return NextResponse.json({ error: "supplier_id is required" }, { status: 400 });
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplier_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  if (quote_id) {
    const { data: quote } = await supabase.from("quotes").select("id").eq("id", quote_id).eq("tenant_id", tenantId).maybeSingle();
    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (case_id) {
    const { data: c } = await supabase.from("service_cases").select("id").eq("id", case_id).eq("tenant_id", tenantId).maybeSingle();
    if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const cleanLines = Array.isArray(lines)
    ? lines
        .filter((l) => l?.description?.trim())
        .slice(0, 200)
        .map((l, i) => {
          const qty = Math.max(0, parseFloat(l.qty_ordered) || 1);
          const rate = Math.max(0, parseFloat(l.rate) || 0);
          return {
            tenant_id: tenantId,
            inventory_item_id: l.inventory_item_id || null,
            sl_no: i + 1,
            description: String(l.description).slice(0, 500),
            uom: l.uom || null,
            qty_ordered: qty,
            rate,
            amount: qty * rate,
          };
        })
    : [];

  const total = cleanLines.reduce((s, l) => s + l.amount, 0);

  const baseInsert = {
    tenant_id: tenantId,
    supplier_id,
    quote_id: quote_id || null,
    case_id: case_id || null,
    status: "draft",
    order_date: order_date || null,
    expected_date: expected_date || null,
    notes: notes || null,
    terms: terms || null,
    total,
    created_by: userId,
  };

  // Retry a few times on a (tenant_id, ref) collision -- same pattern as quotes/route.ts.
  let po: { id: string; ref: string } | null = null;
  let poErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !po; attempt++) {
    const ref = await generateNextPoRef(supabase, tenantId);
    const result = await supabase.from("purchase_orders").insert({ ...baseInsert, ref }).select("id, ref").single();
    if (!result.error) {
      po = result.data;
    } else if (result.error.code === "23505") {
      poErr = result.error;
      continue;
    } else {
      poErr = result.error;
      break;
    }
  }

  if (!po) return NextResponse.json({ error: poErr?.message ?? "Failed to create purchase order" }, { status: 500 });

  if (cleanLines.length > 0) {
    const { error: linesErr } = await supabase
      .from("purchase_order_lines")
      .insert(cleanLines.map((l) => ({ ...l, po_id: po!.id })));
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  return NextResponse.json(po, { status: 201 });
}
