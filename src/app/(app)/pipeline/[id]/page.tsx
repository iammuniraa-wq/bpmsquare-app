import { notFound } from "next/navigation";
import { requireFeature, getTenant, getUserRole } from "@/lib/tenant";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter, canViewWorkcenter } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantToday } from "@/lib/tenantClock";
import { opportunityStages } from "@/lib/sales/opportunity";
import { tenderStages } from "@/lib/tender/rules";
import { tenderForDeal } from "@/lib/tender/server";
import { buildApprovalView } from "@/lib/tender/approvalServer";
import { roomSummary } from "@/lib/tender/roomServer";
import type { TenderView } from "@/lib/tender/views";
import type { BidsData } from "@/lib/tender/bids/rules";
import type { CallsData } from "@/lib/tender/calls";
import { tenantTimezone } from "@/lib/tenantClock";
import { loadActorNames } from "@/lib/actorNames";
import { loadOpportunity, loadOpportunityLines, loadLinkedQuotes, stageSinceMap, listMembersForPicker } from "@/lib/sales/opportunityServer";
import { standardQuoteProducts, pricingOnStandardQuotes } from "../../standard-quotes/formData";
import OpportunityDetailClient, { type TenderTabData } from "./OpportunityDetailClient";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordRfqsCard from "@/components/rfq/RecordRfqsCard";
import RecordActivity from "@/components/page/RecordActivity";
import SourceEmailSlot from "@/components/inbox/SourceEmailSlot";
import { rfqPrefill } from "@/components/rfq/prefill";
import { tenderRfqLines } from "@/lib/tender/rfqLines";
import { boqOrderedLines } from "@/lib/tender/boq/lineSync";
import { listBidVersions } from "@/lib/tender/bids/server";
import { priceValidityDays } from "@/lib/tender/boq/price";
import { listCalls } from "@/lib/tender/callsServer";
import { isOutcomeStage, type OutcomeData } from "@/lib/tender/outcome";
import { linesVersion } from "@/lib/sales/dealLines";
import { rfqLineStatuses } from "@/lib/rfq/server";
import { loadProjectBySource } from "@/lib/contractProjects/server";

export default async function OpportunityDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> }) {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { id } = await params;
  const wantedTab = (await searchParams)?.tab;
  const { supabase, tenantId, userId } = await requireTenantUser();
  const tenant = await getTenant();
  const role = await getUserRole();
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) notFound();

  const [savedLines, quotes, since, members, products, todayKey, { data: account }, { data: contacts }] = await Promise.all([
    loadOpportunityLines(admin, tenantId, id),
    loadLinkedQuotes(admin, tenantId, id),
    stageSinceMap(admin, tenantId, [opp]),
    listMembersForPicker(admin, tenantId),
    standardQuoteProducts(supabase, tenantId, tenant),
    tenantToday(tenantId),
    admin.from("accounts").select("id, name").eq("id", opp.account_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("contacts").select("id, name").eq("account_id", opp.account_id).eq("tenant_id", tenantId).order("name"),
  ]);

  // GCC tender deals: a deal that has a tender row (and only with the flag on; off, tenderForDeal answers null without a query).
  const tender = await tenderForDeal(admin, tenantId, tenant?.features, id);
  // A tender deal shows its lines in the order of the client's file (the BOQ row numbers); a standard deal is untouched.
  const lines = tender ? await boqOrderedLines(admin, tenantId, id, savedLines) : savedLines;
  let tenderTab: TenderTabData | null = null;
  if (tender) {
    const roomOn = tenant?.features?.deal_room === true;
    const [names, timezone, { data: allAccounts }, approval, room, bidList, callList] = await Promise.all([
      loadActorNames(admin, tenantId, [tender.decided_by, tender.bond_released_by]),
      tenantTimezone(tenantId),
      admin.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
      buildApprovalView(admin, { tenantId, userId, config: tenant?.config, deal: opp, tender, opportunityId: id }),
      roomOn ? roomSummary(admin, tenantId, userId, id) : Promise.resolve(null),
      listBidVersions(admin, tenantId, id),
      listCalls(admin, tenantId, id, { userId, isAdmin: role === "admin" }),
    ]);
    const view: TenderView = {
      tender_no: tender.tender_no, issuer_name: tender.issuer_name, issuer_account_id: tender.issuer_account_id, portal: tender.portal,
      closing_at: tender.closing_at, bid_bond_amount: tender.bid_bond_amount, bid_bond_currency: tender.bid_bond_currency,
      bid_bond_expiry: tender.bid_bond_expiry, addenda_count: tender.addenda_count, decision: tender.decision,
      decision_reason: tender.decision_reason, decided_by_name: tender.decided_by ? names.get(tender.decided_by) ?? null : null,
      decided_at: tender.decided_at, source_email_id: tender.source_email_id,
      bond_status: tender.bond_status, bond_released_at: tender.bond_released_at,
      bond_released_by_name: tender.bond_released_by ? names.get(tender.bond_released_by) ?? null : null,
    };
    const dealPerms = await resolvePermissions(supabase, tenantId, userId, role === "admin" ? "admin" : "member");
    const boqEdit = canEditWorkcenter(dealPerms, "pipeline");
    // Slice 3c-1: the Estimates tab, only in a workspace with the estimator and for someone who may view Estimates.
    const estimatesTab = tenant?.features?.estimator === true && canViewWorkcenter(dealPerms, "estimates") ? { canEdit: boqEdit } : null;
    // Slice 4 (migration 0225): bid versions, logged calls and, once the tender has ended, the outcome facts.
    const latestBid = bidList.versions[0] ?? null;
    const bids: BidsData = { versions: bidList.versions, pending: bidList.pending, working_total: 0, canEdit: boqEdit };
    const calls: CallsData = { calls: callList.calls, pending: callList.pending, canEdit: boqEdit };
    const outcome: OutcomeData | null = isOutcomeStage(opp.stage) ? {
      stage: opp.stage, award_value: tender.award_value, winning_bidder: tender.winning_bidder, award_date: tender.award_date, outcome_note: tender.outcome_note,
      competitor: opp.competitor, loss_reason: opp.loss_reason, our_total: latestBid ? latestBid.total : null, our_version: latestBid ? latestBid.version_no : null,
      currency: opp.currency, canEdit: boqEdit, pending: bidList.pending,
    } : null;
    tenderTab = { view, approval, boqEdit, bids, calls, outcome, estimates: estimatesTab, room: room ? { pending: room.pending, unread: room.unread, openQuestions: room.openQuestions, isAdmin: role === "admin" } : null, accounts: (allAccounts ?? []) as { id: string; name: string }[], nowIso: new Date().toISOString(), timezone };
  }

  // Contract projects (slice 5a): only for a tender, and only in a workspace with the module (otherwise no query at all).
  let contractProject: { existing: { id: string; ref: string | null } | null; canCreate: boolean } | null = null;
  if (tender && tenant?.features?.contract_projects === true) {
    const perms = await resolvePermissions(supabase, tenantId, userId, role === "admin" ? "admin" : "member");
    contractProject = {
      existing: await loadProjectBySource(admin, tenantId, id),
      canCreate: opp.stage === "awarded" && opp.outcome === "won" && canViewWorkcenter(perms, "contract_projects") && canEditWorkcenter(perms, "contract_projects"),
    };
  }

  // RFQ (0128): ask suppliers about this deal's lines; only with the module.
  const rfqOn = tenant?.features?.rfq === true;
  const rfqStatus = rfqOn
    ? await rfqLineStatuses(admin, tenantId, lines.map((l) => (l as { rfq_line_id?: string | null }).rfq_line_id ?? "").filter(Boolean))
    : {};

  return (
    <OpportunityDetailClient
      opp={{ ...opp, stage_since: since.get(opp.id) ?? opp.created_at }}
      accountName={account?.name ?? "—"}
      contacts={(contacts ?? []) as { id: string; name: string }[]}
      initialLines={lines}
      linesVersion={linesVersion(savedLines)}
      quotes={quotes}
      stages={tender ? tenderStages() : opportunityStages(tenant?.config)}
      members={members}
      products={products}
      pricingEnabled={pricingOnStandardQuotes(tenant)}
      standardQuotesEnabled={tenant?.features?.standard_quotes === true}
      todayKey={todayKey}
      currentUserId={userId}
      externalLine={<ExternalRecordSlot objectType="opportunities" objectId={id} />}
      related={rfqOn ? (
        <RecordRfqsCard
          origin={{ type: "opportunity", id }}
          originLabel={`Deal ${opp.ref ?? opp.title}${account?.name ? ` for ${account.name}` : ""}`}
          title={`Prices for ${opp.title}`}
          lines={rfqPrefill(lines as unknown as Parameters<typeof rfqPrefill>[0], (rl) => rfqStatus[rl]?.ref ?? null)}
          compactTop
        />
      ) : undefined}
      activity={<RecordActivity objectType="opportunities" objectId={id} extraChangeLogTypes={tender ? ["opportunity_tenders", "opportunity_competitors"] : undefined} isAdmin={role === "admin"} />}
      tender={tenderTab}
      initialTab={tenderTab && (wantedTab === "boq" || (wantedTab === "estimates" && tenderTab.estimates)) ? wantedTab : undefined}
      contractProject={contractProject}
      tenderRfq={tender && rfqOn ? { originLabel: `Deal ${opp.ref ?? opp.title}${account?.name ? ` for ${account.name}` : ""}`, lines: tenderRfqLines(lines as unknown as Parameters<typeof rfqPrefill>[0], (rl) => rfqStatus[rl]?.ref ?? null) } : null}
      sourceEmail={tender ? <SourceEmailSlot objectType="opportunities" objectId={id} bare /> : undefined}
      priceValidityDays={priceValidityDays(tenant?.config ?? null)}
    />
  );
}
