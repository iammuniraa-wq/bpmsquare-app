import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["name", "sku", "category", "uom", "description", "list_price", "cost_price", "tax_percent", "status", "custom_data"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];
  patch.updated_at = new Date().toISOString();

  const { data: before } = await supabase
    .from("products")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("products", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: snap } = await supabase.from("products").select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: snap.name,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}
