import { listQuotesForTenant } from "@/lib/data";
import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../_auth";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const accountId = url.searchParams.get("account_id");

  let quotes = await listQuotesForTenant(tenantId);

  if (status)    quotes = quotes.filter((q) => q.quote.status === status);
  if (accountId) quotes = quotes.filter((q) => q.quote.account_id === accountId);

  return jsonOk({
    data: quotes.map(({ quote: q, account, lineCount }) => ({
      id: q.id,
      ref: q.ref,
      status: q.status,
      total: q.total,
      revision: q.revision,
      created_at: q.created_at,
      valid_until: q.valid_until,
      account: account ? { id: account.id, name: account.name } : null,
      line_count: lineCount,
      _links: {
        self: `/api/v1/quotations/${q.id}`,
        pdf: `/quotations/${q.id}/print`,
        account: `/api/v1/accounts/${q.account_id}`,
      },
    })),
    meta: {
      count: quotes.length,
      total_value: quotes.reduce((s, { quote: q }) => s + q.total, 0),
      filters: { status: status ?? null, account_id: accountId ?? null },
      generated_at: new Date().toISOString(),
    },
    _links: { self: "/api/v1/quotations" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
