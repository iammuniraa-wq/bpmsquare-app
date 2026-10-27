"use client";

import Button from "@/components/ui/Button";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Tabs from "@/components/ui/Tabs";
import InfoTip from "@/components/ui/InfoTip";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { ROUTES, type OpportunityStageDef } from "@/lib/constants";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderBoardRow } from "@/lib/tender/views";
import type { OpportunityRow } from "@/lib/sales/opportunityServer";
import PipelineBoard from "./PipelineBoard";
import TendersPanel from "./TendersPanel";

type Member = { user_id: string; name: string | null; email: string | null };

const TABS = ["deals", "tenders"] as const;

/**
 * The Pipeline of a workspace that has the GCC tender edition (platform-admin flag `gcc_tender`): two tabs, Deals and Tenders,
 * in `?tab=`. A workspace without the flag never renders this; its page is the board exactly as before. The Deals tab is the
 * same board with the tender deals taken out, so the two never mix.
 */
export default function PipelineTabs({ deals, dealStages, tenders, tenderStages, tendersPending, members, accounts, todayKey, currentUserId, nowIso, timezone }: {
  deals: OpportunityRow[];
  dealStages: OpportunityStageDef[];
  tenders: TenderBoardRow[];
  tenderStages: OpportunityStageDef[];
  tendersPending: boolean;
  members: Member[];
  accounts: { id: string; name: string }[];
  todayKey: string;
  currentUserId: string;
  nowIso: string;
  timezone: string;
}) {
  const [tab, setTab] = useUrlTab(TABS, "tab", "deals");
  const openDeals = deals.filter((r) => r.outcome === "open").length;
  const openTenders = tenders.filter((r) => r.outcome === "open").length;

  return (
    <>
      <TabTitle title="Pipeline" />
      <PageHeader
        title="Pipeline"
        subtitle={tab === "tenders" ? `Tenders · ${openTenders} open` : `Sales · ${openDeals} open deals`}
        action={tab === "tenders"
          ? <Button href={ROUTES.pipelineNewTender} variant="primary" data-guide="tender.new">+ New tender</Button>
          : <Button href={ROUTES.pipelineNew} variant="primary">+ New Deal</Button>}
      />
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <Tabs tabs={[{ id: "deals", label: "Deals" }, { id: "tenders", label: "Tenders", count: openTenders }]} value={tab} onChange={setTab} label="Pipeline" />
        {tab === "tenders" && <InfoTip label="Tenders">{TENDER_TIPS.tab}</InfoTip>}
      </div>
      {tab === "tenders" ? (
        <TendersPanel
          rows={tenders} stages={tenderStages} pending={tendersPending} members={members} accounts={accounts}
          todayKey={todayKey} currentUserId={currentUserId} nowIso={nowIso} timezone={timezone}
        />
      ) : (
        <PipelineBoard rows={deals} stages={dealStages} members={members} accounts={accounts} todayKey={todayKey} currentUserId={currentUserId} />
      )}
    </>
  );
}
