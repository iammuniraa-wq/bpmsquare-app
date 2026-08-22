import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm } from "@/lib/wfm/server";

// POST /api/wfm/broadcasts/[id] — mark read for the CALLER (any member).
// DELETE — deactivate (supervisor/admin); rows are kept, not destroyed, so
// read history and the change trail survive.

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;
  const admin = createAdminSupabase();

  // The broadcast must belong to THIS tenant before a read row is written.
  const { data: b } = await admin
    .from("wfm_broadcasts")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin.from("wfm_broadcast_reads").upsert(
    { tenant_id: ctx.tenantId, broadcast_id: id, user_id: ctx.userId },
    { onConflict: "broadcast_id,user_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!ctx.isSupervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { error } = await createAdminSupabase()
    .from("wfm_broadcasts")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
