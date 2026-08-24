"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

// The Analytics workcenter's two pages: the metric dashboard ("what we
// have") and the full-page Talk to data experience. The Talk tab only
// renders when the tenant owns the ai_reports module -- the page behind it
// is server-gated too, this is just so the tab never dangles.
export default function ReportsTabs({ showTalk }: { showTalk: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Analytics", href: ROUTES.reports },
    ...(showTalk ? [{ label: "Talk to data", href: ROUTES.reportsTalk }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${c.line}` }}>
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: active ? 700 : 550,
              color: active ? c.accent : c.muted, textDecoration: "none",
              borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
