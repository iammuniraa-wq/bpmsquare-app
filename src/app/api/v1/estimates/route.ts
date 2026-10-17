import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// Project estimates (0131). Reachable only with a key explicitly scoped to "estimates"
// (EXPLICIT_SCOPE_ONLY); authorizeApi also answers 404 for a workspace that does not own
// the estimator module. CUSTOMER-SAFE FIELDS ONLY: see src/lib/estimator/apiRows.ts for
// what is deliberately never selected (costs, margin, parameters, the model, the lines).
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "estimates");
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.estimates;
  let rows = await src.load(auth.tenantId);
  const status = searchParams.get("status");
  if (status) rows = rows.filter((r) => r.status === status);
  const accountId = searchParams.get("account_id");
  if (accountId) rows = rows.filter((r) => (r.account as { id?: string } | null)?.id === accountId);
  return enrichedList(req, rows, src.fields, { self: "/api/v1/estimates" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
