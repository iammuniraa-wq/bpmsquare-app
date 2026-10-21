import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { setEntitySchedule, SYNC_SCHEDULES, type SyncSchedule } from "@/lib/middleware/ops";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";

// PUT { entity, schedule: "off" | "hourly" | "daily" } -- the automatic sync of one entity,
// stored in the connector's config (the hourly cron reads it; an entity with none follows the
// connector-wide schedule, as before). Daily runs at 02:00 UTC.
// -> { ok, schedule }
export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: string; schedule?: string }>(req);
  if (!D365_ENTITY_KEYS.includes(body.entity as D365EntityKey)) return fail(422, "Unknown entity.");
  if (!(SYNC_SCHEDULES as readonly string[]).includes(String(body.schedule))) return fail(422, "Choose off, hourly or daily.");
  const r = await setEntitySchedule(g.ctx.admin, g.ctx.tenantId, body.entity as D365EntityKey, body.schedule as SyncSchedule);
  if (!r.ok) return fail(r.status, r.error);
  return NextResponse.json(r);
}
