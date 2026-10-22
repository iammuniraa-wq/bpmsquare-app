import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { getScope, isScopeEntity, saveScope, SCOPE_ENTITIES } from "@/lib/middleware/scopeServer";

// The saved Scope of one pulled entity: which records of the connected system every run reads (Sync now, the
// automatic schedule and Full resync). Admin only, tenant from the session.
//
// GET ?entity=customers|contacts|vendors|products|projects
//   -> { entity, label, conditions: [{ attribute, kind, values, labels, attribute_label, enum_type?, via? }],
//        summary, needs_full, source: "system"|"presets",
//        attributes: [{ id, name, label, kind: option|lookup|text|number|boolean, common, enum_type?, via? }] }
//   `attributes` is the connected system's own field list (common ones first); "presets" when it could not be read.
// PUT { entity, conditions: [{ attribute, values, labels?, via? }] }  -- at most 5 conditions, 50 values each.
//   An empty list clears the scope. The attribute must be one `GET` lists; its kind and option list come from the
//   system, not from the request. Changing a scope that already narrowed sets needs_full until a Full resync finishes.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const entity = req.nextUrl.searchParams.get("entity");
  if (!isScopeEntity(entity)) return fail(422, `entity must be one of: ${SCOPE_ENTITIES.join(", ")}.`);
  const r = await getScope(g.ctx.admin, g.ctx.tenantId, entity);
  return "error" in r ? fail(r.status, r.error) : NextResponse.json(r);
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: unknown; conditions?: unknown }>(req);
  if (!isScopeEntity(body.entity)) return fail(422, `entity must be one of: ${SCOPE_ENTITIES.join(", ")}.`);
  const r = await saveScope(g.ctx.admin, g.ctx.tenantId, body.entity, { conditions: body.conditions });
  return "error" in r ? fail(r.status, r.error) : NextResponse.json(r);
}
