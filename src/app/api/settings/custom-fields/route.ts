import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const VALID_OBJECTS = ["account", "contact", "case", "quote", "work_order", "asset"] as const;
const VALID_TYPES = ["text", "number", "date", "select", "checkbox", "textarea"] as const;

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get("object");

  let query = supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position")
    .order("created_at");

  if (objectType) query = query.eq("object_type", objectType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { object_type, field_label, field_type, options, is_required } = body;

  if (!object_type || !field_label || !field_type) {
    return NextResponse.json({ error: "object_type, field_label and field_type are required" }, { status: 400 });
  }
  if (!VALID_OBJECTS.includes(object_type)) {
    return NextResponse.json({ error: `object_type must be one of: ${VALID_OBJECTS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_TYPES.includes(field_type)) {
    return NextResponse.json({ error: `field_type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  // Generate cf_ key from label
  const raw = field_label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const field_key = `cf_${raw}`;

  // Get next position
  const { count } = await supabase
    .from("custom_fields")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("object_type", object_type);

  const { data, error } = await supabase
    .from("custom_fields")
    .insert({
      tenant_id: tenantId,
      object_type,
      field_key,
      field_label,
      field_type,
      options: options ?? null,
      is_required: is_required ?? false,
      position: count ?? 0,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
