import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange } from "@/lib/changeLog";
import { insertLinesTolerant, resolveLineIdsAndSelection } from "@/lib/pricing/quoteLineFlags";
import { opportunityStages, stageDef, initialStage, probabilityFor } from "@/lib/sales/opportunity";
import { refreshOpportunityDerived } from "@/lib/sales/opportunityServer";

// "Create deal from this quote" (§4.3, decision 5): a standalone Standard
// Quote gets a deal after the fact -- titled from the account and ref,
// lines copied WITHOUT re-pricing (the quote's prices are the deal's), the
// quote linked, the deal at Propose since a quote already exists.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline")) || !(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Pipeline and Standard Quotes must both be enabled" }, { status: 403 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: quote } = await admin.from("standard_quotes").select("id, ref, account_id, contact_id, opportunity_id, accounts(name)").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.opportunity_id) return NextResponse.json({ error: "This quote already belongs to a deal" }, { status: 409 });
  const acc = Array.isArray(quote.accounts) ? quote.accounts[0] : quote.accounts;

  const tenant = await getTenant();
  const stages = opportunityStages(tenant?.config);
  const stage = stageDef(stages, "propose") ? "propose" : initialStage(stages).value;
  const record = {
    tenant_id: tenantId, account_id: quote.account_id, contact_id: quote.contact_id ?? null, lead_id: null, source: "direct",
    title: `${(acc as { name?: string } | null)?.name ?? "Deal"} · ${quote.ref}`, description: null, stage, outcome: "open",
    expected_close: null, amount: 0, probability: probabilityFor(stages, stage, null), owner_id: userId, team: [], created_by: userId,
  };
  const { data: opp, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(admin, "opportunities", tenantId, record, "id, ref");
  if (error || !opp) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const { data: lines } = await admin.from("standard_quote_lines").select("*").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no");
  const rows = ((lines ?? []) as Record<string, unknown>[]).map((l, i) => ({
    local_id: l.id as string, tenant_id: tenantId, opportunity_id: opp.id, sl_no: String(i + 1),
    description: l.description as string, uom: (l.uom as string | null) ?? null, qty: Number(l.qty), rate: Number(l.rate), discount_pct: Number(l.discount_pct ?? 0), amount: Number(l.amount),
    product_id: (l.product_id as string | null) ?? null, pricing_document_id: (l.pricing_document_id as string | null) ?? null, pricing_flags: l.pricing_flags ?? null,
    group_id: (l.group_id as string | null) ?? null, group_label: (l.group_label as string | null) ?? null, group_type: (l.group_type as string | null) ?? null,
    break_of: (l.break_of as string | null) ?? null, break_qty: (l.break_qty as number | null) ?? null, is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false,
  }));
  if (rows.length > 0) {
    const { error: lErr } = await insertLinesTolerant(admin, "opportunity_lines", resolveLineIdsAndSelection(rows));
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  }
  await admin.from("standard_quotes").update({ opportunity_id: opp.id }).eq("id", id).eq("tenant_id", tenantId);
  await refreshOpportunityDerived(admin, tenantId, opp.id, stages);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${record.title}`.trim(),
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Created from quote", from: null, to: quote.ref }],
  });
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: id, objectLabel: quote.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Deal", from: null, to: `${opp.ref ?? ""} ${record.title}`.trim() }],
  });
  return NextResponse.json({ id: opp.id, ref: opp.ref }, { status: 201 });
}
