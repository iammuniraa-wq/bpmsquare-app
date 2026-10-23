import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange, diffForLog } from "@/lib/changeLog";
import { opportunityStages, initialStage, probabilityFor } from "@/lib/sales/opportunity";
import { isSchemaPending } from "@/lib/marketing/pending";
import { emitOpportunityCreated } from "@/lib/events/emitters";

// Lead -> deal (§4.3). Creates the opportunity from the lead (title,
// account, source) and marks the lead "converted" -- a lead is optional
// before a deal (decision 5), so this is the one place the two meet.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline"))) {
    return NextResponse.json({ error: "Pipeline isn't enabled for your workspace" }, { status: 403 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  type LeadRow = { id: string; title: string; account_id: string; source: string | null; source_campaign_id: string | null; status: string; contact_id?: string | null };
  // contact_id is migration 0140; a database that has not had it yet still converts, just without the contact.
  let { data: lead, error: leadErr } = await admin.from("leads").select("id, title, account_id, source, source_campaign_id, status, contact_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle<LeadRow>();
  if (leadErr && isSchemaPending(leadErr)) {
    ({ data: lead } = await admin.from("leads").select("id, title, account_id, source, source_campaign_id, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle<LeadRow>());
  }
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // The lead's contact becomes the deal's contact, but only when that contact is this tenant's and belongs to the lead's own account.
  let contactId: string | null = null;
  if (lead.contact_id) {
    const { data: contact } = await admin.from("contacts").select("id").eq("id", lead.contact_id).eq("tenant_id", tenantId).eq("account_id", lead.account_id).maybeSingle();
    contactId = contact?.id ?? null;
  }

  const { data: existing } = await admin.from("opportunities").select("id, ref").eq("lead_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id, ref: existing.ref, already: true });

  const tenant = await getTenant();
  const stages = opportunityStages(tenant?.config);
  const stage = initialStage(stages).value;
  const record = {
    tenant_id: tenantId, account_id: lead.account_id, contact_id: contactId, lead_id: lead.id,
    source: lead.source === "campaign" ? "campaign" : "lead", source_campaign_id: lead.source_campaign_id ?? null,
    title: lead.title, description: null, stage, outcome: "open", expected_close: null, amount: 0,
    probability: probabilityFor(stages, stage, null), owner_id: userId, team: [], created_by: userId,
  };
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(admin, "opportunities", tenantId, record, "id, ref");
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  await admin.from("leads").update({ status: "converted" }).eq("id", id).eq("tenant_id", tenantId);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: data.id, objectLabel: `${data.ref ?? ""} ${lead.title}`.trim(),
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Created from lead", from: null, to: lead.title }, ...diffForLog("opportunities", {}, { stage, ...(contactId ? { contact_id: contactId } : {}) })],
  });
  await emitOpportunityCreated(tenantId, {
    opportunityId: data.id, ref: data.ref, stage, source: record.source, accountId: lead.account_id, contactId, leadId: lead.id, actorId: user?.id,
  });
  return NextResponse.json({ id: data.id, ref: data.ref }, { status: 201 });
}
