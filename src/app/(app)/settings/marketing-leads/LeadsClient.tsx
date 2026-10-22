"use client";

import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import HandoverTab from "./HandoverTab";
import ScoringTab from "./ScoringTab";

export const LEADS_TABS = [{ id: "scoring", label: "Scoring" }, { id: "handover", label: "Hand-over" }] as const;

/** One page for a lead's journey: how it earns points, then how it reaches a salesperson. */
export default function LeadsClient() {
  const [tab, setTab] = useUrlTab(LEADS_TABS.map((t) => t.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs tabs={[...LEADS_TABS]} value={tab} onChange={setTab} label="Leads" />
      {tab === "handover" ? <HandoverTab /> : <ScoringTab />}
    </div>
  );
}
