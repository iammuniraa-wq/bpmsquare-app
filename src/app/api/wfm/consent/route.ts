import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee } from "@/lib/wfm/server";

// POST /api/wfm/consent — record the employee's DPDP consent (selfie +
// location capture). Set-once; punching is blocked until this is stamped.
export async function POST() {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  if (employee.consent_recorded_at) {
    return NextResponse.json({ ok: true, consent_recorded_at: employee.consent_recorded_at });
  }

  const now = new Date().toISOString();
  const admin = createAdminSupabase();
  const { error } = await admin
    .from("wfm_employees")
    .update({ consent_recorded_at: now })
    .eq("id", employee.id)
    .eq("tenant_id", tenantId)
    .is("consent_recorded_at", null);

  if (error) {
    console.error("wfm consent update failed:", error.message);
    return NextResponse.json({ error: "Could not record consent" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, consent_recorded_at: now });
}
