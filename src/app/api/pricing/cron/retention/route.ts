import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { pricingRetentionDays, retentionCutoff } from "@/lib/pricing/documents";
import type { TenantConfig } from "@/lib/constants";

// GET /api/pricing/cron/retention — daily purge of stored pricing contexts
// past each tenant's config.pricing.retention_days (default 180). Triggered
// by .github/workflows/pricing-retention.yml, NOT a Vercel cron: the Hobby
// plan's two cron slots are taken (see wfm-hours-alert.yml for the history).
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
