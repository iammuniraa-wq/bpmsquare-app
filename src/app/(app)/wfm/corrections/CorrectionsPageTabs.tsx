"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import CorrectionsQueueClient from "./CorrectionsQueueClient";
import RecheckQueueClient from "./RecheckQueueClient";

type Tab = "corrections" | "recheck";

export default function CorrectionsPageTabs() {
  const [tab, setTab] = useState<Tab>("corrections");

  const tabBtn = (key: Tab, label: string): React.CSSProperties => ({
    padding: "9px 16px", fontSize: 13, fontWeight: tab === key ? 700 : 500,
    color: tab === key ? c.accent : c.muted, background: "none", border: "none",
    borderBottom: tab === key ? `2px solid ${c.accent}` : "2px solid transparent",
    cursor: "pointer", marginBottom: -1,
  });

  return (
    <>
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 16 }}>
        <button style={tabBtn("corrections", "Corrections")} onClick={() => setTab("corrections")}>Corrections</button>
        <button style={tabBtn("recheck", "Recheck requests")} onClick={() => setTab("recheck")}>Recheck requests</button>
      </div>
      {tab === "corrections" ? <CorrectionsQueueClient /> : <RecheckQueueClient />}
    </>
  );
}
