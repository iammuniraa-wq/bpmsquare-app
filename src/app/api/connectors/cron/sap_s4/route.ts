import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { rotateStart } from "@/lib/connectors/d365/mapping";
import { entityConfig, scheduleOf } from "@/lib/connectors/sap_s4/catalog";
import { runSapPull } from "@/lib/connectors/sap_s4/server";
import { SAP_CONNECTOR_ID, SAP_ENTITY_KEYS, type SapConfig } from "@/lib/connectors/sap_s4/types";

// GET /api/connectors/cron/sap_s4 -- hourly (vercel.json). Runs every workspace whose SAP S/4HANA connection is
// scheduled: "hourly" on every run, "daily" on the 02:00 UTC run. The workspace order rotates hourly so a slow one
// cannot starve the rest. A time budget stops starting new work late in the run; the rest continues next hour from
// its position.

export const maxDuration = 300;
const BUDGET_MS = 250_000;
const RUN_DEADLINE_MS = 265_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminSupabase();
  const { data: rows, error } = await admin.from("tenant_connectors").select("tenant_id, config, status").eq("connector_id", SAP_CONNECTOR_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const hour = new Date().getUTCHours();
  const results: { tenant: string; entity: string; error?: string | null; counts?: unknown }[] = [];
  const ordered = rotateStart([...(rows ?? [])].sort((a, b) => String(a.tenant_id).localeCompare(String(b.tenant_id))), Math.floor(Date.now() / 3_600_000));
  for (const r of ordered) {
    const cfg = r.config as unknown as SapConfig;
    if (!cfg?.auth_mode) continue;
    for (const entity of SAP_ENTITY_KEYS) {
      if (Date.now() - started > BUDGET_MS) break;
      if (!entityConfig(cfg, entity).enabled) continue;
      const schedule = scheduleOf(cfg, entity);
      if (schedule === "off" || (schedule === "daily" && hour !== 2)) continue;
      const res = await runSapPull(admin, r.tenant_id as string, entity, { trigger: "schedule", userId: null, deadline: started + RUN_DEADLINE_MS });
      results.push({ tenant: r.tenant_id as string, entity, error: res.error, counts: res.counts });
    }
  }
  return NextResponse.json({ ok: true, results });
}
