import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { FIELD_REGISTRY, isPilotObjectType } from "@/lib/fieldRegistry";

const VALID_OBJECTS = ["account", "contact", "case", "quote", "work_order", "asset", "supplier", "inventory", "purchase_order", "invoice"] as const;

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

  let query = supabase.from("field_overrides").select("*").eq("tenant_id", tenantId);
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
  const { object_type, field_key, label, is_hidden, section, position } = body;

  if (!object_type || !field_key) {
    return NextResponse.json({ error: "object_type and field_key are required" }, { status: 400 });
  }
  if (!VALID_OBJECTS.includes(object_type)) {
    return NextResponse.json({ error: `object_type must be one of: ${VALID_OBJECTS.join(", ")}` }, { status: 400 });
  }

  // Defense in depth: a locked standard field (e.g. "name") can never be hidden,
  // regardless of what the client sends — re-check against the registry here,
  // not just in the UI.
  let effectiveHidden = is_hidden;
  if (isPilotObjectType(object_type) && is_hidden === true) {
    const fieldDef = FIELD_REGISTRY[object_type].fields.find((f) => f.key === field_key);
    if (fieldDef?.locked) effectiveHidden = false;
  }

  const patch: Record<string, unknown> = { tenant_id: tenantId, object_type, field_key, updated_at: new Date().toISOString() };
  if ("label" in body) patch.label = label;
  if ("is_hidden" in body) patch.is_hidden = effectiveHidden;
  if ("section" in body) patch.section = section;
  if ("position" in body) patch.position = position;

  const { data, error } = await supabase
    .from("field_overrides")
    .upsert(patch, { onConflict: "tenant_id,object_type,field_key" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
