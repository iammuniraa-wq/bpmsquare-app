import { authorizeApi, jsonError } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

/**
 * Staff master data. Two guards beyond the usual bearer check, because this
 * is the first v1 endpoint over personal data about the tenant's own people:
 *  - "employees" is an EXPLICIT_SCOPE_ONLY object (see _auth.ts) -- a
 *    wildcard key does not reach it; the scope must name it.
 *  - the tenant must actually have the module (business_roles) enabled.
 */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "employees");
  if ("error" in auth) return auth.error;

  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "business_roles"))) {
    return jsonError(404, "Not found", { message: "The employees module isn't enabled for this workspace." });
  }

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.employees;
  const rows = await src.load(auth.tenantId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/employees",
    legacyFilters: [
      { path: "status", value: searchParams.get("status") },
      { path: "department", value: searchParams.get("department") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
