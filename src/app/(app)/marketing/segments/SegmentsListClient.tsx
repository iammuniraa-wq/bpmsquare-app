"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { MarketingTargetGroup } from "@/lib/types";

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function describeGroup(g: MarketingTargetGroup): string {
  const parts: string[] = [];
  if (g.filters?.length) parts.push(`${g.filters.length} condition${g.filters.length === 1 ? "" : "s"} (${g.match === "any" ? "any" : "all"})`);
  if (g.account_types?.length) parts.push(`${g.account_types.length} account type${g.account_types.length === 1 ? "" : "s"}`);
  if (g.include_account_ids?.length) parts.push(`+${g.include_account_ids.length} added`);
  if (g.exclude_account_ids?.length) parts.push(`−${g.exclude_account_ids.length} excluded`);
  if (g.manual_emails?.length) parts.push(`${g.manual_emails.length} external email${g.manual_emails.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "No conditions yet";
}

export default function SegmentsListClient({ groups }: { groups: MarketingTargetGroup[] }) {
  const router = useRouter();
  const [items, setItems] = useState(groups);

  async function remove(id: string) {
    if (!window.confirm("Delete this target group? Campaigns already built from it are unaffected.")) return;
    setItems((current) => current.filter((g) => g.id !== id));
    await fetch(`/api/marketing/target-groups/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
        No target groups yet. Build one with the Segmentation designer, then reuse it across campaigns.
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Conditions</th>
            <th style={th}>Created</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((g) => (
            <tr key={g.id}>
              <td style={{ ...td, fontWeight: 600 }}>
                <Link href={ROUTES.marketingSegment(g.id)} style={{ color: c.ink, textDecoration: "none" }}>{g.name}</Link>
              </td>
              <td style={{ ...td, color: c.muted }}>{describeGroup(g)}</td>
              <td style={{ ...td, color: c.muted }}>{fmtDate(g.created_at)}</td>
              <td style={{ ...td, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <Link href={`${ROUTES.marketingNew}?group=${g.id}`} style={{ fontSize: 12, color: c.accent, fontWeight: 600, textDecoration: "none" }}>Use in campaign</Link>
                  <button onClick={() => remove(g.id)} style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
