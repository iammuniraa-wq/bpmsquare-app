import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

// One site expense (0258). Scope "site_expenses" (explicit scope only). The photo, the AI reading, who entered or approved it and the
// phone's capture id are deliberately not selected.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "site_expenses");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;
  const { id } = await params;
  const { data, error } = await createAdminSupabase()
    .from("site_expenses")
    .select("id, ref, project_id, status, expense_date, amount, currency, amount_project_ccy, vat_amount, vendor_text, invoice_ref, paid_by, document_state, erp_ref, erp_state, posted_amount, posted_at, custom_data, created_at, updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return jsonOk({ data: { ...data, _links: { self: `/api/v1/site-expenses/${data.id}` } }, _links: { self: `/api/v1/site-expenses/${id}` } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
