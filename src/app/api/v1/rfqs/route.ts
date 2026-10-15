import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// RFQs (0128). Reachable only with a key explicitly scoped to "rfqs"
// (EXPLICIT_SCOPE_ONLY): supplier prices are commercially sensitive, so a
// pre-existing "*" key does not widen to them.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "rfqs");
  if ("error" in auth) return auth.error;
  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "rfq"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.rfqs;
  let rows = await src.load(auth.tenantId);
  for (const key of ["status", "origin_type", "origin_id"] as const) {
    const v = searchParams.get(key);
    if (v) rows = rows.filter((r) => r[key] === v);
  }
  return enrichedList(req, rows, src.fields, { self: "/api/v1/rfqs" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
