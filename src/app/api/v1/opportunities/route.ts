import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "opportunities");
  if ("error" in auth) return auth.error;

  // A tenant without the module gets 404, not data (§3b).
  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "pipeline"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.opportunities;
  let rows = await src.load(auth.tenantId);
  for (const key of ["stage", "outcome", "account_id", "owner_id"] as const) {
    const v = searchParams.get(key);
    if (v) rows = rows.filter((r) => r[key] === v);
  }
  return enrichedList(req, rows, src.fields, { self: "/api/v1/opportunities" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
