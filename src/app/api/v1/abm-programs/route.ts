import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// ABM programs (0180). Programs alone carry no personal data, so a normal "*" key reaches them;
// the companies inside them are a separate, explicitly scoped object (abm_targets).
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "abm_programs");
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.abm_programs;
  let rows = await src.load(auth.tenantId);
  for (const key of ["status", "kind"] as const) {
    const v = searchParams.get(key);
    if (v) rows = rows.filter((r) => r[key] === v);
  }
  return enrichedList(req, rows, src.fields, { self: "/api/v1/abm-programs" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
