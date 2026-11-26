"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import { ratingText } from "@/lib/suppliers/check/rating";
import { VERDICT_LABEL, VERDICT_TONE, type CheckSummary, type Verdict } from "@/lib/suppliers/check/types";

// Small pieces shared by the supplier card, the dock card and the chips on the RFQ screens.

const STAR = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z";

/** Five SVG stars filled to `value` (0 to 5), with an accessible text label. */
export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  const v = value === null ? 0 : Math.min(5, Math.max(0, value));
  const id = `st${Math.round(v * 100)}${size}`;
  return (
    <svg role="img" aria-label={value === null ? "No rating yet" : `${ratingText(value)} out of 5`} width={size * 5 + 4} height={size} viewBox={`0 0 ${24 * 5} 24`} style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={id}><rect x="0" y="0" width={(v / 5) * 24 * 5} height="24" /></clipPath>
      </defs>
      <g fill="none" stroke="var(--hint)" strokeWidth="1.4" strokeLinejoin="round">
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={STAR} transform={`translate(${i * 24} 0)`} />)}
      </g>
      <g fill="var(--amberink)" clipPath={`url(#${id})`}>
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={STAR} transform={`translate(${i * 24} 0)`} />)}
      </g>
    </svg>
  );
}

export const VerdictPill = ({ verdict }: { verdict: Verdict }) => <StatusPill label={VERDICT_LABEL[verdict]} tone={VERDICT_TONE[verdict]} />;

/** The small read-only chip beside a supplier's name: verdict and rating. Nothing is drawn for a supplier that has not been checked. */
export function SupplierCheckChip({ summary }: { summary: CheckSummary | null | undefined }) {
  if (!summary) return null;
  const title = `${VERDICT_LABEL[summary.verdict]}${summary.rating === null ? "; no rating yet" : `; rating ${ratingText(summary.rating)} of 5 from ${summary.rfqs} RFQs`}. A risk indicator, not a legal finding.`;
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-guide="supplier.check.chip">
      <VerdictPill verdict={summary.verdict} />
      {summary.rating !== null && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>
          <Stars value={summary.rating} size={11} />{ratingText(summary.rating)}
        </span>
      )}
    </span>
  );
}

/** The newest saved check of each supplier, by supplier id. Empty while loading, and for suppliers never checked. One request per set of ids. */
export function useSupplierChecks(ids: readonly (string | null | undefined)[]): Record<string, CheckSummary> {
  const key = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].sort().slice(0, 200).join(",");
  const [data, setData] = useState<Record<string, CheckSummary>>({});
  useEffect(() => {
    if (!key) { setData({}); return; }
    let live = true;
    fetch(`/api/suppliers/check-summary?ids=${key}`).then((r) => (r.ok ? r.json() : { summaries: [] })).then((j: { summaries?: CheckSummary[] }) => {
      if (!live) return;
      const next: Record<string, CheckSummary> = {};
      for (const s of j.summaries ?? []) next[s.supplierId] = s;
      setData(next);
    }).catch(() => { if (live) setData({}); });
    return () => { live = false; };
  }, [key]);
  return data;
}
