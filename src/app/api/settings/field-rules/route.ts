import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { isValidConditionNode } from "@/lib/fieldRegistry";

const VALID_OBJECTS = ["account", "contact", "case", "quote", "work_order", "asset", "supplier", "inventory", "purchase_order", "invoice"] as const;
const VALID_EFFECTS = ["hide", "show", "require", "optional"] as const;

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

  let query = supabase.from("field_rules").select("*").eq("tenant_id", tenantId).order("position");
  if (objectType) query = query.eq("object_type", objectType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
  const { object_type, target_field_key, effect, conditions, is_active } = body;

  if (!object_type || !target_field_key || !effect || !conditions) {
    return NextResponse.json({ error: "object_type, target_field_key, effect and conditions are required" }, { status: 400 });
  }
  if (!VALID_OBJECTS.includes(object_type)) {
    return NextResponse.json({ error: `object_type must be one of: ${VALID_OBJECTS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_EFFECTS.includes(effect)) {
    return NextResponse.json({ error: `effect must be one of: ${VALID_EFFECTS.join(", ")}` }, { status: 400 });
  }
  if (!isValidConditionNode(conditions)) {
    return NextResponse.json({ error: "conditions must be a valid condition/group tree" }, { status: 400 });
  }

  const { count } = await supabase
    .from("field_rules")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("object_type", object_type);

  const { data, error } = await supabase
    .from("field_rules")
    .insert({
      tenant_id: tenantId,
      object_type,
      target_field_key,
      effect,
      conditions,
      is_active: is_active ?? true,
      position: count ?? 0,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
