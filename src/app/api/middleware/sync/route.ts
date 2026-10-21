import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { syncOverview } from "@/lib/middleware/ops";

// GET -- the Resync tab: one row per entity.
// { connected, product, pending_migration, entities: [{ key, label, direction: "pull"|"push", enabled, entity_set,
//     schedule: "off"|"hourly"|"daily", schedule_source: "entity"|"connector", running, linked,
//     last_run: { status, trigger, started_at, finished_at, counts, error } | null }] }
// `running` is true while a run of that entity holds its lock. Run history: GET /api/middleware/messages?channel=connector.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json(await syncOverview(g.ctx.admin, g.ctx.tenantId));
}
