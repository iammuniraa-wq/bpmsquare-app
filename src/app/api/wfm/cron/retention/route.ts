import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";

// GET /api/wfm/cron/retention — daily Vercel cron (vercel.json).
// Purges punch selfies past the tenant's configured
// selfie_retention_days. Scope is deliberately narrow, per spec §3:
//   - Presence EVENTS are retained indefinitely -- only selfie_path (the
//     file + its reference on the row) is purged; the event itself stays.
//   - Enrollment photos (employees.enrolled_photo_path) are a DIFFERENT
//     retention rule ("kept until employee deactivation + deletion
//     request") and are NOT touched by this job.
// Runs across every tenant with wfm enabled -- a cron is platform-wide, not
// per-tenant.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug")
    .contains("features", { wfm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { tenant: string; purged: number; errors: number }[] = [];

  for (const tenant of tenants ?? []) {
    const config = await getWfmConfig(admin, tenant.id);
    const cutoff = new Date(Date.now() - config.selfie_retention_days * 24 * 60 * 60 * 1000).toISOString();

    const { data: stale } = await admin
      .from("wfm_presence_events")
      .select("id, selfie_path")
      .eq("tenant_id", tenant.id)
      .not("selfie_path", "is", null)
      .lt("ts", cutoff);

    let purged = 0;
    let errors = 0;
    for (const row of stale ?? []) {
      const { error: removeErr } = await admin.storage.from("wfm").remove([row.selfie_path as string]);
      if (removeErr) {
        errors++;
        continue;
      }
      const { error: updateErr } = await admin
        .from("wfm_presence_events")
        .update({ selfie_path: null })
        .eq("id", row.id)
        .eq("tenant_id", tenant.id);
      if (updateErr) errors++;
      else purged++;
    }
    results.push({ tenant: tenant.slug, purged, errors });
  }

  return NextResponse.json({ ok: true, results });
}
