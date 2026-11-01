import { authorizeApi } from "../../../_auth";
import { enrichedList } from "../../../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { TENDER_BOQ_LINE_FIELDS, loadBoqRowsForApi } from "@/lib/tender/boq/apiRows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One row per line of the tender's Bill of quantities: what the screen shows, minus everything internal (cost, markup, who or what
// gave the price). The query layer pages, filters and searches it like any list. No BOQ yet is an empty list, not an error.
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
  const { data: tender } = await admin.from("opportunity_tenders").select("opportunity_id").eq("opportunity_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!tender) return Response.json({ error: "Not found" }, { status: 404 });

  const { source, rows } = await loadBoqRowsForApi(admin, tenantId, id);
  return enrichedList(req, rows, TENDER_BOQ_LINE_FIELDS, { self: `/api/v1/tenders/${id}/boq`, extraMeta: { source } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
