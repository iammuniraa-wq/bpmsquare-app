import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { previewEntityRows } from "@/lib/middleware/ops";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";

// POST { entity } -- the first five rows of an entity as the ERP returns them, so a field map can
// be checked before the first sync. Nothing is written.
// -> { rows: object[] }
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: string }>(req);
  if (!D365_ENTITY_KEYS.includes(body.entity as D365EntityKey)) return fail(422, "Unknown entity.");
  const r = await previewEntityRows(g.ctx.admin, g.ctx.tenantId, body.entity as D365EntityKey);
  if ("error" in r) return fail(r.status, r.error);
  return NextResponse.json(r);
}
