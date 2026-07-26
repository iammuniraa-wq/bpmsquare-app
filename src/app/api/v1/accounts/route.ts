import { listAccountsForTenant } from "@/lib/data";
import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../_auth";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const accounts = await listAccountsForTenant(tenantId);

  return jsonOk({
    data: accounts.map(({ account, referredBy, counts }) => ({
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
    })),
    meta: { count: accounts.length, generated_at: new Date().toISOString() },
    _links: { self: "/api/v1/accounts" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
