import { authorizeApi } from "../../../_auth";
import { enrichedList } from "../../../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { ELEMENTS_API_SCOPE, PROJECT_ELEMENT_FIELDS, loadProjectElementsForApi } from "@/lib/elements/apiRows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The elements of a contract project, one row per budget line of its current revision (the open draft, else the approved one) that is an element or
// sits in a building: building code, element type, element code, the client's quantity (the contract's), the model's quantity, the quantity the budget
// carries and which of the two it uses. Meant for the connector's round trip (a model reads the codes, posts quantities back through a comparison).
// Cost, unit cost, the allocated amount, cost codes and margin are not on any of it: the loader (elements/apiRows.ts) is the one place that reads the
// lines, and a test holds it to that. A key reaches this only by naming the Contract projects scope (the wildcard never does), and a workspace without
// the Buildings add-on gets a 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, ELEMENTS_API_SCOPE);
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "contract_buildings"))) return Response.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const rows = await loadProjectElementsForApi(admin, tenantId, id);
  if (!rows) return Response.json({ error: "Not found" }, { status: 404 });
  return enrichedList(req, rows as unknown as Record<string, unknown>[], PROJECT_ELEMENT_FIELDS, { self: `/api/v1/contract-projects/${id}/elements` });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
