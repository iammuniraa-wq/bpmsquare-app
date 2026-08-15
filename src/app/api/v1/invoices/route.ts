import { authorizeApi } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { enrichedList } from "../_list";
import type { QueryableField } from "@/lib/api/query";

const INVOICE_QUERYABLE: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "quote_id", type: "string" },
  { path: "work_order_id", type: "string" },
  { path: "due_date", type: "date" },
  { path: "total", type: "number" },
  { path: "paid_amount", type: "number" },
  { path: "issued_at", type: "date" },
];

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "invoices");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const { searchParams } = new URL(req.url);
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from("invoices").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const accountIds = [...new Set((data ?? []).map((inv) => inv.account_id))];
  const { data: accounts } = accountIds.length
    ? await supabase.from("accounts").select("id, name").in("id", accountIds)
    : { data: [] };
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  const rows = (data ?? []).map((inv) => ({
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
  }));

  return enrichedList(req, rows, INVOICE_QUERYABLE, {
    self: "/api/v1/invoices",
    legacyFilters: [
      { path: "status", value: searchParams.get("status") },
      { path: "account.id", value: searchParams.get("account_id") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
