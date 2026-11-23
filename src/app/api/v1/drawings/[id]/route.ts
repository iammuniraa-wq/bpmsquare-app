import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadDrawingsForApi } from "@/lib/drawings/apiRows";

// One drawing with its released revision. The same shape as the list; 404 when it is not in this key's workspace. See ../route.ts.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "drawings");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const [row] = await loadDrawingsForApi(createAdminSupabase(), auth.tenantId, id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return jsonOk({ data: row, _links: { self: `/api/v1/drawings/${id}` } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
