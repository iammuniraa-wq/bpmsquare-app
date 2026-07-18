import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const accountId = searchParams.get("account_id");

  const supabase = createAdminSupabase();
  let query = supabase.from("invoices").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (accountId) query = query.eq("account_id", accountId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const accountIds = [...new Set((data ?? []).map((inv) => inv.account_id))];
  const { data: accounts } = accountIds.length
    ? await supabase.from("accounts").select("id, name").in("id", accountIds)
    : { data: [] };
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  return jsonOk({
    data: (data ?? []).map((inv) => ({
      id: inv.id,
      ref: inv.ref,
      status: inv.status,
      account: { id: inv.account_id, name: accountNameById.get(inv.account_id) ?? null },
      quote_id: inv.quote_id,
      work_order_id: inv.work_order_id,
      due_date: inv.due_date,
      total: inv.total,
      paid_amount: inv.paid_amount,
      issued_at: inv.issued_at,
      _links: { self: `/api/v1/invoices/${inv.id}` },
    })),
    meta: { count: (data ?? []).length, generated_at: new Date().toISOString() },
    _links: { self: "/api/v1/invoices" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
