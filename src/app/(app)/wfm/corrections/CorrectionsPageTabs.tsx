"use client";

import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import CorrectionsQueueClient from "./CorrectionsQueueClient";
import RecheckQueueClient from "./RecheckQueueClient";
import OtQueueClient from "./OtQueueClient";

/** `otEnabled` mirrors the tenant's WfmConfig.punch_types.ot -- the tab is
 * pointless (and confusing) for a tenant that doesn't record overtime. */
export default function CorrectionsPageTabs({ otEnabled = false }: { otEnabled?: boolean }) {
  const tabs = [
    { id: "corrections", label: "Corrections" },
    { id: "recheck", label: "Flagged for review" },
    ...(otEnabled ? [{ id: "ot", label: "Overtime" }] : []),
  ];
  const [tab, setTab] = useUrlTab(tabs.map((t) => t.id));

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Correction queues" />
      </div>
      {tab === "corrections" && <CorrectionsQueueClient />}
      {tab === "recheck" && <RecheckQueueClient />}
      {tab === "ot" && otEnabled && <OtQueueClient />}
    </>
  );
}
