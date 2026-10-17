"use client";

import { usePathname } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { ROUTES } from "@/lib/constants";

// The Analytics workcenter's two pages: the metric dashboard ("what we
// have") and the full-page Talk to data experience. The Talk tab only
// renders when the tenant owns the ai_reports module -- the page behind it
// is server-gated too, this is just so the tab never dangles.
export default function ReportsTabs({ showTalk }: { showTalk: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { id: ROUTES.reports, label: "Analytics" },
    ...(showTalk ? [{ id: ROUTES.reportsTalk, label: "Talk to data" }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <Tabs tabs={tabs} value={pathname} hrefFor={(id) => id} label="Analytics sections" />
    </div>
  );
}
