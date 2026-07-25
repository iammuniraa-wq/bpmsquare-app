import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

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
  const reqBody = await request.json();

  // Verify the row belongs to this tenant before touching anything else.
  const { data: existing } = await supabase
    .from("email_templates")
    .select("id, category")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const allowed = ["name", "subject", "body", "is_default"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in reqBody) patch[key] = reqBody[key];

  // Only one default per category -- unset any other default first.
  if (patch.is_default === true) {
    await supabase.from("email_templates").update({ is_default: false })
      .eq("tenant_id", tenantId).eq("category", existing.category).eq("is_default", true).neq("id", id);
  }

  const { data, error } = await supabase
    .from("email_templates")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const { error } = await supabase
    .from("email_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
