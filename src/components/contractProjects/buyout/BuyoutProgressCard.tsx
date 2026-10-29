"use client";

import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import Card from "@/components/ui/Card";
import { ROUTES } from "@/lib/constants";
import { money } from "@/lib/contractProjects/format";
import { overBudget } from "./rules";
import { BUYOUT_TIPS } from "./tips";
import type { BuyoutData } from "./types";
import { useBuyoutSummary } from "./useBuyoutSummary";

// "Buy-out progress" on the project Overview: how many packages, how many awarded, and the committed price against the budget, with a link to
// the tab. It reads the summary itself and leaves out of the page when the summary is not there (pending migration, no access), so the
// Overview never shows a half-card.

export default function BuyoutProgressCard({ projectId, currency, initial }: { projectId: string; currency: string | null; initial?: BuyoutData | null }) {
  const data = useBuyoutSummary(projectId, true, initial);
  if (!data) return null;
  const { tiles, packages } = data;
  const awarded = packages.filter((p) => p.status === "awarded" || p.status === "handed_over").length;
  const handed = packages.filter((p) => p.status === "handed_over").length;
  const over = overBudget(tiles.committed, tiles.budget);
  const pct = tiles.budget > 0 ? Math.min(100, (tiles.committed / tiles.budget) * 100) : 0;
  const href = `${ROUTES.contractProject(projectId)}?tab=buyout`;

  return (
    <Card title="Buy-out progress" info={BUYOUT_TIPS.progress} padding={16} style={{ minWidth: 0 }}>
      <div data-guide="cp.buyout.progress" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {packages.length === 0 ? (
          <div style={{ fontSize: 13, color: c.hint }}>No packages yet.</div>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: c.ink }}>
              <b>{awarded}</b> of {packages.length} package{packages.length === 1 ? "" : "s"} awarded{handed > 0 ? `, ${handed} handed over` : ""}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: c.muted }}>
              <span>Ordered</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: c.ink }}>{money(tiles.committed, currency)} of {money(tiles.budget, currency)}</span>
            </div>
            <div role="img" aria-label={`Ordered ${money(tiles.committed, currency)} of ${money(tiles.budget, currency)}`} style={{ height: 12, borderRadius: 6, background: c.panel2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: over > 0 ? pillar.amber.base : pillar.teal.base }} />
            </div>
            {over > 0 && <div role="status" data-guide="cp.buyout.over" style={{ fontSize: 12.5, color: "var(--amberink)" }}>Over the budget by {money(over, currency)}.</div>}
          </>
        )}
        <Link href={href} data-guide="cp.buyout.open" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent, fontSize: 13, textDecoration: "none" }}>Open Buy-out →</Link>
      </div>
    </Card>
  );
}
