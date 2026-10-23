import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// Standard Quotes (0053). Scope "standard_quotes". Deliberately NOT in EXPLICIT_SCOPE_ONLY: like
// quotations (the same class of data, a customer-facing price) it holds no personal data, and the
// contact is only an id. authorizeApi also answers 404 for a workspace that does not own the
// module. Header only on the list -- lines, notes and terms are on /:id. What is never returned
// (line pricing flags with the real margin, the supplier-request link, contact details) is
// listed in src/lib/api/standardQuoteRows.ts.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "standard_quotes");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.standard_quotes;
  let rows = await src.load(auth.tenantId);
  const accountId = searchParams.get("account_id");
  if (accountId) rows = rows.filter((r) => (r.account as { id?: string } | null)?.id === accountId);
  const opportunityId = searchParams.get("opportunity_id");
  if (opportunityId) rows = rows.filter((r) => r.opportunity_id === opportunityId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/standard-quotes",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
