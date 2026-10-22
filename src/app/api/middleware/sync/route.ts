import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { syncOverview } from "@/lib/middleware/ops";
import { sapSyncOverview } from "@/lib/connectors/sap_s4/server";

// GET -- the Resync tab: one row per entity.
// { connected, product, pending_migration, entities: [{ key, label, direction: "pull"|"push", enabled, entity_set,
//     schedule: "off"|"hourly"|"daily", schedule_source: "entity"|"connector", running, linked,
//     last_run: { status, trigger, started_at, finished_at, counts, error } | null }] }
// `running` is true while a run of that entity holds its lock. Run history: GET /api/middleware/messages?channel=connector.
// ?connector=sap_s4 answers the same shape for SAP S/4HANA: customers, suppliers, products.
export async function GET(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  if (wantsSap(req)) return NextResponse.json(await sapSyncOverview(g.ctx.admin, g.ctx.tenantId));
  return NextResponse.json(await syncOverview(g.ctx.admin, g.ctx.tenantId));
}
