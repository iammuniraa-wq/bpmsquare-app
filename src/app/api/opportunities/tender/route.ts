import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { OPPORTUNITY_SOURCES, initialStage, probabilityFor, stageDef } from "@/lib/sales/opportunity";
import { emitOpportunityCreated } from "@/lib/events/emitters";
import { ownerTeamProblem } from "@/lib/sales/opportunityMembers";
import { tenantTimezone } from "@/lib/tenantClock";
import { closingDateKey, derivedTenderTitle, parseTenderFields, tenderStages } from "@/lib/tender/rules";
import { accountInTenant, emailInTenant, ensureTenderDealType, tenderTableReady } from "@/lib/tender/server";

// POST /api/opportunities/tender -- GCC tender deals, slice 1 (docs/design/gcc-tender-deals.md section 3).
// Creates a deal AND its tender row in one call. This is a separate route on purpose: the standard POST /api/opportunities
// is not touched, so with the platform-admin flag `gcc_tender` off (404 here) nothing about creating a deal can differ.
//
// Body: { account_id, title?, contact_id?, owner_id?, source?, description?, tender_source_email?,
//         tender: { tender_no, issuer_name, issuer_account_id?, portal, closing_at, bid_bond_*? } }
// Every foreign id (account, contact, owner, issuer account, source e-mail) is verified against THIS workspace before
// use (MULTI_TENANT_GUARDRAILS.md). The tenant comes from the session, never from the body.

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) {
    throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  }
  return ctx;
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try { ({ supabase, tenantId, userId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!body.account_id || typeof body.account_id !== "string") return NextResponse.json({ error: "account_id is required" }, { status: 400 });

  const block = body.tender && typeof body.tender === "object" ? (body.tender as Record<string, unknown>) : {};
  const parsed = parseTenderFields(block);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const t = parsed.values;

  const admin = createAdminSupabase();
  if (!(await tenderTableReady(admin, tenantId))) {
    return NextResponse.json({ error: "Tender deals need a database update (migration 0220). Ask your administrator." }, { status: 503 });
  }

  const { data: account } = await admin.from("accounts").select("id, name").eq("id", body.account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (typeof body.contact_id === "string" && body.contact_id) {
    const { data: contact } = await admin.from("contacts").select("id").eq("id", body.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (t.issuer_account_id && !(await accountInTenant(admin, tenantId, t.issuer_account_id))) {
    return NextResponse.json({ error: "Issuer account not found" }, { status: 404 });
  }
  const sourceEmail = typeof body.tender_source_email === "string" && body.tender_source_email ? body.tender_source_email : null;
  if (sourceEmail && !(await emailInTenant(admin, tenantId, sourceEmail))) {
    return NextResponse.json({ error: "Source email not found" }, { status: 404 });
  }
  const requestedOwner = typeof body.owner_id === "string" && body.owner_id ? body.owner_id : null;
  if (requestedOwner && requestedOwner !== userId) {
    const problem = await ownerTeamProblem(admin, tenantId, { owner: requestedOwner });
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  }
  if (t.tender_no) {
    const { data: dup } = await admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).eq("tender_no", t.tender_no).maybeSingle();
    if (dup) return NextResponse.json({ error: `Tender number ${t.tender_no} already exists` }, { status: 409 });
  }

  const stages = tenderStages();
  const asked = typeof body.stage === "string" ? stageDef(stages, body.stage) : undefined;
  const stage = asked && !asked.is_closed ? asked.value : initialStage(stages).value;
  const tz = await tenantTimezone(tenantId);
  const expectedClose = closingDateKey(t.closing_at, tz);
  const source = (OPPORTUNITY_SOURCES as readonly string[]).includes(String(body.source)) ? String(body.source) : "direct";
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 200)
    : derivedTenderTitle({ tenderNo: t.tender_no ?? null, issuer: t.issuer_name ?? null, accountName: account.name as string });

  const record = {
    tenant_id: tenantId,
    account_id: account.id,
    contact_id: typeof body.contact_id === "string" && body.contact_id ? body.contact_id : null,
    lead_id: null,
    source,
    source_campaign_id: null,
    title,
    description: typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 4000) : null,
    stage,
    outcome: "open",
    expected_close: expectedClose,
    amount: 0,
    probability: probabilityFor(stages, stage, null),
    owner_id: requestedOwner ?? userId,
    team: [],
    competitor: null,
    created_by: userId,
  };
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(admin, "opportunities", tenantId, record, "id, ref");
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const dealTypeId = await ensureTenderDealType(admin, tenantId);
  const tenderRow = {
    opportunity_id: data.id,
    tenant_id: tenantId,
    deal_type_id: dealTypeId,
    tender_no: t.tender_no ?? null,
    issuer_name: t.issuer_name ?? null,
    issuer_account_id: t.issuer_account_id ?? null,
    portal: t.portal ?? null,
    closing_at: t.closing_at ?? null,
    bid_bond_amount: t.bid_bond_amount ?? null,
    bid_bond_currency: t.bid_bond_currency ?? null,
    bid_bond_expiry: t.bid_bond_expiry ?? null,
    addenda_count: t.addenda_count ?? 0,
    source_email_id: sourceEmail,
    reminders_sent: [],
  };
  const made = await admin.from("opportunity_tenders").insert(tenderRow);
  if (made.error) {
    // The deal and its tender row are one thing: take the half-made deal back out rather than leave a standard-looking deal behind.
    await admin.from("opportunities").delete().eq("id", data.id).eq("tenant_id", tenantId);
    if (made.error.code === "23505") return NextResponse.json({ error: `Tender number ${t.tender_no ?? ""} already exists`.trim() }, { status: 409 });
    return NextResponse.json({ error: made.error.message }, { status: 500 });
  }

  const user = await getAuthUser();
  const label = `${data.ref ?? ""} ${title}`.trim();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: data.id, objectLabel: label,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("opportunities", {}, { title, account: account.name, stage, expected_close: expectedClose }),
  });
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: data.id, objectLabel: label,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("opportunity_tenders", {}, {
      tender_no: tenderRow.tender_no, issuer_name: tenderRow.issuer_name, portal: tenderRow.portal, closing_at: tenderRow.closing_at,
    }),
  });
  await emitOpportunityCreated(tenantId, {
    opportunityId: data.id, ref: data.ref, stage, source, accountId: account.id as string,
    contactId: record.contact_id, leadId: null, actorId: user?.id,
  });
  return NextResponse.json({ id: data.id, ref: data.ref }, { status: 201 });
}
