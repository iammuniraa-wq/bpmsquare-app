import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// Sales Orders (0212). Scope "sales_orders". Deliberately NOT in EXPLICIT_SCOPE_ONLY: like quotations and standard quotes
// (the same class of data, a customer-facing document) the shape holds no personal data -- the contact is only an id and a
// bill-to / ship-to carries a name and address, no person's phone or e-mail. authorizeApi also answers 404 for a workspace
// that does not own the module. Header only on the list -- lines, notes and terms are on /:id. What is never returned is
// listed in src/lib/api/salesOrderRows.ts.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales_orders");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.sales_orders;
  let rows = await src.load(auth.tenantId);
  const accountId = searchParams.get("account_id");
  if (accountId) rows = rows.filter((r) => (r.account as { id?: string } | null)?.id === accountId);
  const sourceId = searchParams.get("source_id");
  if (sourceId) rows = rows.filter((r) => r.source_id === sourceId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/sales-orders",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
