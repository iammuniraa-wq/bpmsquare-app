import { authorizeApi, jsonOk, jsonError } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "employees");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "business_roles"))) {
    return jsonError(404, "Not found", { message: "The employees module isn't enabled for this workspace." });
  }

  const { id } = await params;
  const { data: employee, error } = await admin
    .from("employees")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!employee) return Response.json({ error: "Not found" }, { status: 404 });

  return jsonOk({
    data: { ...employee, _links: { self: `/api/v1/employees/${employee.id}` } },
    _links: { self: `/api/v1/employees/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
