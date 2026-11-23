import { authorizeApi } from "../_auth";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { ELEMENTS_API_SCOPE, PROJECT_HEADER_FIELDS, listProjectHeadersForApi } from "@/lib/elements/apiRows";

// The contract projects of a workspace with the Buildings add-on, HEADER ONLY (reference, name, status, source, customer, contract value, end date), each
// with the link to its elements: what a model connector needs to find the project it reads and posts to. The budget, its totals and the margin are
// internal cost and are not here (Talk to data and the app show them to people who may see them). A key reaches this only by naming the Contract
// projects scope; a workspace without the add-on gets a 404.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, ELEMENTS_API_SCOPE);
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "contract_buildings"))) return Response.json({ error: "Not found" }, { status: 404 });
  return enrichedList(req, await listProjectHeadersForApi(admin, tenantId), PROJECT_HEADER_FIELDS, { self: "/api/v1/contract-projects" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
