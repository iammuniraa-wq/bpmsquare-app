import { authorizeApi } from "../../../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../../../_list";

// The companies of one program. Needs a key scoped to "abm_targets" (explicit scope only).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "abm_targets");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const src = LIST_SOURCES.abm_targets;
  const rows = (await src.load(auth.tenantId)).filter((r) => r.program_id === id);
  return enrichedList(req, rows, src.fields, { self: `/api/v1/abm-programs/${id}/targets` });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
