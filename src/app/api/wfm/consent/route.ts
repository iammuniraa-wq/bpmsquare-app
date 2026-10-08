import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee } from "@/lib/wfm/server";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

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
    .from("employees")
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
