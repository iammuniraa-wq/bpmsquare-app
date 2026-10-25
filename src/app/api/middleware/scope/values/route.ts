import { NextResponse, type NextRequest } from "next/server";
import { guard, fail } from "../../_guard";
import { getScopeValues, isScopeEntity, SCOPE_ENTITIES } from "@/lib/middleware/scopeServer";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { getSapScopeValues } from "@/lib/connectors/sap_s4/server";
import { isSapBpEntity } from "@/lib/connectors/sap_s4/types";

// GET ?entity=customers&attribute=territoryid[&q=north]
//   -> { kind, typed, values: [{ value, label }], more }
// What a condition can pick, read from the connected system: the allowed options of a pick-list or status, the records
// a lookup (territory, sales area, owner) points at, or yes/no. Capped at 50; `q` narrows by name and `more` says the
// cap was hit. `typed: true` (text, number) means the person types the values. `attribute` is the id the scope
// route lists ("customer:territoryid" for a contact's customer). Admin only, tenant from the session.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const p = req.nextUrl.searchParams;
  const entity = p.get("entity");
  if (wantsSap(req)) {
    if (!isSapBpEntity(entity)) return fail(422, "entity must be one of: customers, vendors, products.");
    const attr = p.get("attribute") ?? "";
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(attr)) return fail(422, "Choose an attribute.");
    const v = await getSapScopeValues(g.ctx.admin, g.ctx.tenantId, entity, attr);
    return "error" in v ? fail(v.status, v.error) : NextResponse.json(v);
  }
  if (!isScopeEntity(entity)) return fail(422, `entity must be one of: ${SCOPE_ENTITIES.join(", ")}.`);
  const attribute = p.get("attribute") ?? "";
  if (!/^(customer:)?[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(attribute)) return fail(422, "Choose an attribute.");
  const r = await getScopeValues(g.ctx.admin, g.ctx.tenantId, entity, attribute, p.get("q") ?? "");
  return "error" in r ? fail(r.status, r.error) : NextResponse.json(r);
}
