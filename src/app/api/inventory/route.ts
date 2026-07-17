import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const supplierId = searchParams.get("supplier_id");
  const lowStock = searchParams.get("low_stock") === "true";

  let query = supabase.from("inventory_items").select("*").eq("tenant_id", tenantId).order("name");
  if (supplierId) query = query.eq("supplier_id", supplierId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter((r) =>
      r.name.toLowerCase().includes(term) ||
      (r.sku ?? "").toLowerCase().includes(term) ||
      (r.category ?? "").toLowerCase().includes(term)
    );
  }
  if (lowStock) {
    rows = rows.filter((r) => r.reorder_level != null && r.qty_on_hand <= r.reorder_level);
  }

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { sku, name, description, category, uom, supplier_id, reorder_level, unit_cost, notes } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (supplier_id) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id")
      .eq("id", supplier_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      tenant_id: tenantId,
      sku: sku || null,
      name: name.trim(),
      description: description || null,
      category: category || null,
      uom: uom || "Nos",
      supplier_id: supplier_id || null,
      reorder_level: reorder_level ? parseFloat(reorder_level) : null,
      unit_cost: unit_cost ? parseFloat(unit_cost) : null,
      notes: notes || null,
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A SKU with that value already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
