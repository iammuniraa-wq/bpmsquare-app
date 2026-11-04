import { authorizeApi } from "../../../_auth";
import { enrichedList } from "../../../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { loadWbsForApi } from "@/lib/tender/wbs/api";
import { TENDER_WBS_FIELDS } from "@/lib/tender/wbs/apiShape";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The tender's WBS, one row per item in tree order: code, name, parent, the owner's name, the roll-up of its lines and sub-items (client
// amounts only) and its own parts (a BOQ line's share of it, with the quantity and client amount of that share). Cost, markup and margin are
// not on any of it. No WBS yet, or migration 0243 pending, is an empty list, not an error.
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

  const wbs = await loadWbsForApi(admin, tenantId, id);
  return enrichedList(req, wbs.items as unknown as Record<string, unknown>[], TENDER_WBS_FIELDS, {
    self: `/api/v1/tenders/${id}/wbs`,
    extraMeta: { wbs_pending: wbs.pending, wbs_total: wbs.total, unassigned: wbs.unassigned },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
