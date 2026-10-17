import { authorizeApi, jsonOk } from "../../_auth";
import { loadEstimateForApi } from "@/lib/estimator/apiRows";
import { isUuid } from "@/lib/estimator/requests";

// One estimate, customer-safe fields only (apiRows.ts). The bill of materials, the unit
// costs and the margin are internal and are not part of any API response.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "estimates");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const row = await loadEstimateForApi(auth.tenantId, id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return jsonOk({ data: row, _links: { self: `/api/v1/estimates/${id}` } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
