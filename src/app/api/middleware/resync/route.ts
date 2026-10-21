import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { resync } from "@/lib/middleware/ops";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";

// POST { entity, full?: boolean, ids?: string[] } -- start a sync now, with the same engine, lock and
// history the connector screen uses.
//   customers | contacts | vendors | products | projects  -> pull (incremental; full:true reads everything again)
//   fence_projects                                         -> the older push of fence projects (ids optional)
// -> { runId, counts: { read, created, updated, unchanged, skipped, failed }, issues: string[], error: string|null }
// 400 carries the same body with `error` set (e.g. a run of this entity is already running).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: string; full?: boolean; ids?: unknown }>(req);
  if (!D365_ENTITY_KEYS.includes(body.entity as D365EntityKey)) return fail(422, "Unknown entity.");
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
  const res = await resync(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, body.entity as D365EntityKey, { full: body.full === true, ids });
  return NextResponse.json(res, { status: res.error ? 400 : 200 });
}
