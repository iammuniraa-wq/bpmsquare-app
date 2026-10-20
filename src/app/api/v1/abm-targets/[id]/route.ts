import { authorizeApi, jsonOk } from "../../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { createAdminSupabase } from "@/lib/supabase-server";

// One target account with its buying group. The group is returned by id and ROLE only:
// no name, email, phone or note. The contact id resolves through /api/v1/contacts for a key
// that is scoped to contacts. `notes` (a rep's private note) and `dropped_reason` are never returned.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "abm_targets");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;
  const { id } = await params;

  const row = (await LIST_SOURCES.abm_targets.load(tenantId)).find((r) => r.id === id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const { data } = await createAdminSupabase()
    .from("abm_buying_group_members")
    .select("id, contact_id, role, is_primary")
    .eq("tenant_id", tenantId)
    .eq("target_account_id", id)
    .order("created_at");

  return jsonOk({
    data: { ...row, buying_group: (data ?? []).map((m) => ({ ...m, _links: { contact: `/api/v1/contacts/${m.contact_id}` } })), _links: { self: `/api/v1/abm-targets/${id}` } },
    _links: { self: `/api/v1/abm-targets/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
