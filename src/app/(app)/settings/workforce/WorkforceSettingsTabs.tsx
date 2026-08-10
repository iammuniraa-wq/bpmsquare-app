"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import type { WfmConfig } from "@/lib/constants";
import WorkforceConfigClient from "./WorkforceConfigClient";
import SitesClient from "./SitesClient";
import ShiftsClient from "./ShiftsClient";
import LeaveTypesClient from "./LeaveTypesClient";
import HolidaysClient from "./HolidaysClient";

type Tab = "general" | "sites" | "shifts" | "leave_types" | "holidays";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "sites", label: "Sites" },
  { key: "shifts", label: "Shifts" },
  { key: "leave_types", label: "Leave Types" },
  { key: "holidays", label: "Holidays" },
];

export default function WorkforceSettingsTabs({ initial }: { initial: WfmConfig }) {
  const [tab, setTab] = useState<Tab>("general");

  const tabBtn = (key: Tab): React.CSSProperties => ({
    padding: "9px 16px", fontSize: 13, fontWeight: tab === key ? 700 : 500,
    color: tab === key ? c.accent : c.muted, background: "none", border: "none",
    borderBottom: tab === key ? `2px solid ${c.accent}` : "2px solid transparent",
    cursor: "pointer", marginBottom: -1,
  });

  return (
    <>
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === "general" && <WorkforceConfigClient initial={initial} />}
      {tab === "sites" && <SitesClient canEdit={true} />}
      {tab === "shifts" && <ShiftsClient canEdit={true} />}
      {tab === "leave_types" && <LeaveTypesClient />}
      {tab === "holidays" && <HolidaysClient />}
    </>
  );
}
