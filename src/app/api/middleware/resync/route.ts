import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { resync } from "@/lib/middleware/ops";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";
import { parseSelection } from "@/lib/connectors/d365/selection";

// POST { entity, full?, ids?, since?, text?, active_only? } -- start a sync now, with the same engine, lock and
// history the connector screen uses.
//   customers | contacts | vendors | products | projects  -> pull. No selection: incremental, `full:true` reads everything again.
//        A selection reads only those records and never moves the incremental position:
//          ids          up to 100 record ids (GUIDs) or readable numbers
//          since        a date (YYYY-MM-DD) or ISO time: changed at or after it
//          text         up to 80 characters, matched against the entity's name and number
//          active_only  true: only active records (Dataverse)
//        A filter this ERP product cannot express is not applied and is listed in `unsupported`; when nothing
//        is left to apply, no run starts and `error` says why.
//   fence_projects                                         -> the older push of fence projects (ids optional, no filters)
// -> { runId, counts, issues: string[], error: string|null, unsupported?: string[] }
// 400 carries the same body with `error` set (e.g. a run of this entity is already running).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: string; full?: boolean; ids?: unknown; since?: unknown; text?: unknown; active_only?: unknown }>(req);
  if (!D365_ENTITY_KEYS.includes(body.entity as D365EntityKey)) return fail(422, "Unknown entity.");
  const entity = body.entity as D365EntityKey;

  if (entity === "fence_projects") {
    if (body.since || body.text || body.active_only) return fail(422, "Fence projects are sent, not read, so filters do not apply.");
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
    const res = await resync(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, entity, { full: body.full === true, ids });
    return NextResponse.json(res, { status: res.error ? 400 : 200 });
  }

  const parsed = parseSelection(body);
  if (!parsed.ok) return fail(422, parsed.error);
  const res = await resync(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, entity, { full: body.full === true, select: parsed.select });
  return NextResponse.json(res, { status: res.error ? 400 : 200 });
}
