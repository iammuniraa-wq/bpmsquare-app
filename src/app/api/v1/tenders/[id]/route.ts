import { authorizeApi, jsonOk } from "../../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { loadBoqRowsForApi, summariseBoqRows } from "@/lib/tender/boq/apiRows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "tenders");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "pipeline"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const row = (await LIST_SOURCES.tenders.load(tenantId)).find((r) => r.id === id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const { source, rows } = await loadBoqRowsForApi(admin, tenantId, id, { tender: { ref: (row.ref as string | null) ?? null, tender_no: (row.tender_no as string | null) ?? null } });
  const links = { self: `/api/v1/tenders/${id}`, deal: `/api/v1/opportunities/${id}`, boq: `/api/v1/tenders/${id}/boq`, wbs: `/api/v1/tenders/${id}/wbs` };
  return jsonOk({
    data: { ...row, boq: source ? summariseBoqRows(rows, source) : null, _links: links },
    _links: { self: links.self },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
