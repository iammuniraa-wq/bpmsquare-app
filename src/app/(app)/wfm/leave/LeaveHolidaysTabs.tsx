"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import LeaveClient from "./LeaveClient";
import HolidaysClient from "./HolidaysClient";

type Tab = "leave" | "holidays";

export default function LeaveHolidaysTabs({ initial }: {
  initial: React.ComponentProps<typeof LeaveClient>["initial"];
}) {
  const [tab, setTab] = useState<Tab>("leave");

  const tabBtn = (key: Tab): React.CSSProperties => ({
    padding: "9px 16px", fontSize: 13, fontWeight: tab === key ? 700 : 500,
    color: tab === key ? c.accent : c.muted, background: "none", border: "none",
    borderBottom: tab === key ? `2px solid ${c.accent}` : "2px solid transparent",
    cursor: "pointer", marginBottom: -1,
  });

  return (
    <>
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 16 }}>
        <button style={tabBtn("leave")} onClick={() => setTab("leave")}>Leave</button>
        <button style={tabBtn("holidays")} onClick={() => setTab("holidays")}>Holidays</button>
      </div>
      {/* Both mount once and just hide -- switching back to Leave after
          approving something on a first visit shouldn't refetch the whole
          queue, and Holidays keeps its own edits if you flip back. */}
      <div style={{ display: tab === "leave" ? "block" : "none" }}><LeaveClient initial={initial} /></div>
      <div style={{ display: tab === "holidays" ? "block" : "none" }}><HolidaysClient /></div>
    </>
  );
}
