import { getAccountHubForTenant } from "@/lib/data";
import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../../_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const hub = await getAccountHubForTenant(id, tenantId);
  if (!hub) {
    return Response.json({ error: "Not found", id }, { status: 404 });
  }

  return jsonOk({
    data: {
      ...hub.account,
      referred_by: hub.referredBy ? { id: hub.referredBy.id, name: hub.referredBy.name } : null,
      contacts:    hub.contacts,
      sites:       hub.sites,
      assets:      hub.assets,
      cases:       hub.cases,
      quotes:      hub.quotes.map((q) => ({ id: q.id, ref: q.ref, status: q.status, total: q.total, created_at: q.created_at })),
      contracts:   hub.contracts,
      work_orders: hub.workOrders.map((wo) => ({ id: wo.id, ref: wo.ref, status: wo.status, scheduled_for: wo.scheduled_for, authorized_by: wo.authorized_by })),
      invoices:    hub.invoices,
    },
    meta: { generated_at: new Date().toISOString() },
    _links: { self: `/api/v1/accounts/${id}`, collection: "/api/v1/accounts" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
