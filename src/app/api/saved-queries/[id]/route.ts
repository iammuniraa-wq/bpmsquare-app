import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  // Keyed by real id + tenant + owner -- a foreign or cross-tenant id matches
  // zero rows and fails cleanly (RLS backstops the same).
  const { error } = await supabase
    .from("saved_queries")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
