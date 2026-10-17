"use client";

import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import LeaveClient from "./LeaveClient";
import HolidaysClient from "./HolidaysClient";

const TABS = [
  { id: "leave", label: "Leave" },
  { id: "holidays", label: "Holidays" },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function LeaveHolidaysTabs({ initial }: {
  initial: React.ComponentProps<typeof LeaveClient>["initial"];
}) {
  const [tab, setTab] = useUrlTab(TAB_IDS);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Leave and holidays" />
      </div>
      {/* Both mount once and just hide -- switching back to Leave after
          approving something on a first visit shouldn't refetch the whole
          queue, and Holidays keeps its own edits if you flip back. */}
      <div style={{ display: tab === "leave" ? "block" : "none" }}><LeaveClient initial={initial} /></div>
      <div style={{ display: tab === "holidays" ? "block" : "none" }}><HolidaysClient /></div>
    </>
  );
}
