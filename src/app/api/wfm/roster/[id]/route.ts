import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

// DELETE /api/wfm/roster/[id] — clear an explicit roster override for one
// date, reverting that employee back to their standing shift (employees.shift_id)
// for that date.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;
  const { id } = await params;

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("wfm_roster_assignments")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
