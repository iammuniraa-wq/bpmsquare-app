import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

// One site receipt with its items (0259). Scope "site_receipts" (explicit scope only). The photos, the signature, the receiver and the phone's
// capture id are deliberately not selected.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "site_receipts");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("site_receipts")
    .select("id, ref, project_id, package_id, status, outcome, received_at, delivery_note_ref, handed_by, vehicle, note, erp_ref, erp_state, custom_data, created_at, updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: lines } = await admin
    .from("site_receipt_lines")
    .select("id, line_no, line_key, element_code, building, description, uom, qty_expected, qty_received, qty_accepted, qty_rejected, condition, reason_code, note")
    .eq("tenant_id", tenantId)
    .eq("receipt_id", id)
    .order("line_no", { ascending: true });
  return jsonOk({ data: { ...data, lines: lines ?? [], _links: { self: `/api/v1/site-receipts/${data.id}` } }, _links: { self: `/api/v1/site-receipts/${id}` } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
