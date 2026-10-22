"use client";

import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useTenantFeature } from "@/lib/tenant-context";
import ConsentTab from "./ConsentTab";
import LimitsTab from "./LimitsTab";

/** Consent is the page; Limits is its second tab, shown only when a module that has limits is on. */
export default function ConsentClient() {
  const journeys = useTenantFeature("journeys");
  const whatsapp = useTenantFeature("whatsapp_marketing");
  const tabs = [{ id: "consent", label: "Consent" }, ...(journeys || whatsapp ? [{ id: "limits", label: "Limits" }] : [])];
  const [tab, setTab] = useUrlTab(tabs.map((t) => t.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} label="Consent" />}
      {tab === "limits" ? <LimitsTab /> : <ConsentTab />}
    </div>
  );
}
