import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { CONNECTOR_ID, runPull, runPushFenceProjects } from "@/lib/connectors/d365/server";
import { entityConfig } from "@/lib/connectors/d365/catalog";
import { D365_ENTITY_KEYS, type D365Config } from "@/lib/connectors/d365/types";

// GET /api/connectors/cron/dynamics365 -- hourly (vercel.json). Runs every
// tenant whose Dynamics 365 connector is scheduled: "hourly" on every run,
// "daily" on the 02:00 UTC run. Customers go first so contacts and projects
// can link to them. A time budget stops starting new work late in the run;
// whatever is left continues next hour from its watermark.

export const maxDuration = 300;
const BUDGET_MS = 250_000;
// A run stops starting new rows here, leaving the rest of the 300 s for the
// page in flight and its closing writes.
const RUN_DEADLINE_MS = 265_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminSupabase();
  const { data: rows, error } = await admin.from("tenant_connectors").select("tenant_id, config, status").eq("connector_id", CONNECTOR_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const hour = new Date().getUTCHours();
  const results: { tenant: string; entity: string; error?: string | null; counts?: unknown }[] = [];
  for (const r of rows ?? []) {
    const cfg = r.config as unknown as D365Config;
    if (!cfg?.product || cfg.schedule === "off" || (cfg.schedule === "daily" && hour !== 2)) continue;
    for (const entity of D365_ENTITY_KEYS) {
      if (Date.now() - started > BUDGET_MS) break;
      if (!entityConfig(cfg, entity)?.enabled) continue;
      const res = entity === "fence_projects"
        ? await runPushFenceProjects(admin, r.tenant_id as string, { trigger: "schedule", userId: null, deadline: started + RUN_DEADLINE_MS })
        : await runPull(admin, r.tenant_id as string, entity, { trigger: "schedule", userId: null, deadline: started + RUN_DEADLINE_MS });
      results.push({ tenant: r.tenant_id as string, entity, error: res.error, counts: res.counts });
    }
  }
  return NextResponse.json({ ok: true, results });
}
