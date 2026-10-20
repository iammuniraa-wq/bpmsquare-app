import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// ABM target accounts. Reachable only with a key explicitly scoped to "abm_targets"
// (EXPLICIT_SCOPE_ONLY): a buying group names people and their role, so a pre-existing "*" key
// does not widen to it.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "abm_targets");
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.abm_targets;
  let rows = await src.load(auth.tenantId);
  for (const key of ["progress", "tier", "program_id"] as const) {
    const v = searchParams.get(key);
    if (v) rows = rows.filter((r) => r[key] === v);
  }
  return enrichedList(req, rows, src.fields, { self: "/api/v1/abm-targets" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
