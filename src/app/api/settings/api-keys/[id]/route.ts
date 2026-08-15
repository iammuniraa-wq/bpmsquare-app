import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// Revoke a scoped API key. Soft-delete (sets revoked_at) so the key stays
// visible in the list as "revoked" and its last_used_at remains auditable,
// rather than vanishing. A revoked key is rejected by resolveApiAuth
// immediately (the active-hash index filters revoked_at is null).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  // id + tenant_id pairing: a cross-tenant id matches zero rows and fails
  // cleanly, exactly like every other [id] mutation in the product.
  const { data, error } = await createAdminSupabase()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
  return NextResponse.json({ id: data.id, revoked: true });
}
