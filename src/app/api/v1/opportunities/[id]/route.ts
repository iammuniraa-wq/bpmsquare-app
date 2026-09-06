import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { loadOpportunityLines, loadLinkedQuotes } from "@/lib/sales/opportunityServer";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "opportunities");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "pipeline"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  // team and probability_override_reason are internal -- never selected for API consumers.
  const { data: opp, error } = await admin
    .from("opportunities")
    .select("id, ref, title, description, account_id, contact_id, stage, outcome, loss_reason, loss_note, amount, currency, probability, expected_close, owner_id, source, competitor, custom_data, created_at, updated_at, closed_at, accounts(name)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!opp) return Response.json({ error: "Not found" }, { status: 404 });

  const [lines, quotes] = await Promise.all([loadOpportunityLines(admin, tenantId, id), loadLinkedQuotes(admin, tenantId, id)]);
  const acc = Array.isArray(opp.accounts) ? opp.accounts[0] : opp.accounts;
  const { accounts: _a, ...rest } = opp as Record<string, unknown> & { accounts?: unknown };
  return jsonOk({
    data: {
      ...rest, account_name: (acc as { name?: string } | null)?.name ?? null,
      lines: lines.map((l) => ({ id: l.id, sl_no: l.sl_no, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct, amount: l.amount, product_id: l.product_id ?? null, group_id: l.group_id ?? null, group_label: l.group_label ?? null, break_of: l.break_of ?? null, break_qty: l.break_qty ?? null, is_selected: l.is_selected })),
      quotes: quotes.map((q) => ({ object: q.object, id: q.id, ref: q.ref, status: q.status, subtotal: q.subtotal, total: q.total, created_at: q.created_at })),
      _links: { self: `/api/v1/opportunities/${id}`, account: `/api/v1/accounts/${opp.account_id}` },
    },
    _links: { self: `/api/v1/opportunities/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
