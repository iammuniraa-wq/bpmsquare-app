import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { getRules, saveRules } from "@/lib/middleware/ops";
import { mergeRules, parseRules, validateRulesInput } from "@/lib/middleware/rules";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";

// GET -- what goes out and how: the rules, the fence and estimate selections,
//        payload capture, and `contract` (per option: allowed + a plain hint),
//        so the screen can grey what the connected product cannot take.
// PUT -- { rules?, fence?, estimate?, payload_capture? } a partial change over what is stored.
//        Unknown keys and wrong types are 422 with the field named.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json(await getRules(g.ctx.admin, g.ctx.tenantId));
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody(req);
  const checked = validateRulesInput(body);
  if (!checked.ok) return fail(422, checked.errors[0].message, { errors: checked.errors });
  const current = await getRules(g.ctx.admin, g.ctx.tenantId);
  const next = mergeRules(parseRules(current), body);
  const view = await saveRules(g.ctx.admin, g.ctx.tenantId, next);
  const u = await getAuthUser();
  await logChange(g.ctx.supabase, {
    tenantId: g.ctx.tenantId, objectType: "tenants", objectId: g.ctx.tenantId, objectLabel: "Integration middleware rules", action: "update",
    actorId: u?.id, actorEmail: u?.email, changes: [{ field: "integration middleware rules", from: null, to: "changed" }],
  });
  return NextResponse.json(view);
}
