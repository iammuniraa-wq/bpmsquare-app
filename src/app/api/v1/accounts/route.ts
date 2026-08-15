import { listAccountsForTenant } from "@/lib/data";
import { authorizeApi } from "../_auth";
import { enrichedList } from "../_list";
import type { QueryableField } from "@/lib/api/query";

const ACCOUNT_QUERYABLE: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "name", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "city", type: "string", searchable: true },
  { path: "phone", type: "string" },
  { path: "email", type: "string", searchable: true },
  { path: "created_at", type: "date" },
  { path: "referred_by.name", type: "string" },
];

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounts");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const accounts = await listAccountsForTenant(tenantId);
  const rows = accounts.map(({ account, referredBy, counts }) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    city: account.city ?? null,
    phone: account.phone ?? null,
    email: account.email ?? null,
    referred_by: referredBy ? { id: referredBy.id, name: referredBy.name } : null,
    created_at: account.created_at,
    counts,
    _links: { self: `/api/v1/accounts/${account.id}` },
  }));

  return enrichedList(req, rows, ACCOUNT_QUERYABLE, {
    self: "/api/v1/accounts",
    legacyFilters: [{ path: "type", value: new URL(req.url).searchParams.get("type") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
