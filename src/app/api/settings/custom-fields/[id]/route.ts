import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const OBJECT_TABLE: Record<string, string> = {
  account:    "accounts",
  contact:    "contacts",
  case:       "service_cases",
  quote:      "quotes",
  work_order: "work_orders",
  asset:      "assets",
  supplier:       "suppliers",
  inventory:      "inventory_items",
  purchase_order: "purchase_orders",
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const allowed = ["field_label", "options", "is_required", "position", "field_section"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  const { data, error } = await supabase
    .from("custom_fields")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // Fetch the field definition first so we know its key and object type
  const { data: field, error: fetchErr } = await supabase
    .from("custom_fields")
    .select("field_key, object_type")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (fetchErr || !field) return NextResponse.json({ error: "Field not found" }, { status: 404 });

  const table = OBJECT_TABLE[field.object_type];
  if (table) {
    // Block deletion if any record has a non-null value for this field
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .not(`custom_data->>${field.field_key}`, "is", null);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete: ${count} record${count !== 1 ? "s" : ""} already have data in "${field.field_key}". Clear the field values from those records first.` },
        { status: 409 }
      );
    }
  }

  const { error } = await supabase
    .from("custom_fields")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
