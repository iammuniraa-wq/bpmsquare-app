import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { pricingRetentionDays, retentionCutoff } from "@/lib/pricing/documents";
import type { TenantConfig } from "@/lib/constants";

// GET /api/pricing/cron/retention — daily purge of stored pricing contexts
// past each tenant's config.pricing.retention_days (default 180). Vercel
// cron (vercel.json) -- was a GitHub Actions workflow until 2026-09-09,
// back when the Hobby plan's two-cron-per-project cap meant a third native
// cron got the whole deployment rejected. Now on Pro (100 crons/project,
// per-minute precision as of Vercel's Jan-2026 change), no reason not to
// run it natively; that also drops the GitHub Actions repo secret and its
// own "best-effort, can silently stop after 60 days" schedule as failure
// modes. Vercel auto-sends `Authorization: Bearer $CRON_SECRET` on every
// invocation, matching the check below with no code change needed.
//
// Platform-wide by nature; every delete is tenant-scoped. Simulation replays
// of a purged document keep their own row -- replay_of is ON DELETE SET NULL.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, config")
    .contains("features", { pricing_engine: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { tenant: string; days: number; purged: number; error?: string }[] = [];
  for (const tenant of tenants ?? []) {
    const days = pricingRetentionDays(tenant.config as TenantConfig | null);
    const cutoff = retentionCutoff(days);
    const { data, error: delErr } = await admin
      .from("pricing_documents")
      .delete()
      .eq("tenant_id", tenant.id)
      .lt("created_at", cutoff)
      .select("id");
    results.push({ tenant: tenant.slug as string, days, purged: data?.length ?? 0, ...(delErr ? { error: delErr.message } : {}) });
  }

  return NextResponse.json({ ok: true, results });
}
