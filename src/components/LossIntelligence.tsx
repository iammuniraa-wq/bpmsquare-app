"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, LOSS_REASON_LABEL, type LossReason } from "@/lib/constants";

/**
 * Loss Intelligence — engagement layer, 3-layer theme only (parent gates).
 * The last 12 months of lost/dropped quotes, aggregated by their structured
 * loss reason: mix bar, recent losses with notes, and the unfiled count as
 * a gentle prompt. Renders nothing while there are no losses to learn from.
 */

type Mix = { reason: LossReason; count: number; value: number };
type Recent = {
  id: string; ref: string; total: number; outcome: "lost" | "dropped";
  reason: LossReason | null; note: string | null; account_name: string | null; when: string;
};

const REASON_COLOR: Record<LossReason, string> = {
  price: "#d97706", silent: "#64748b", competitor: "#dc2626",
  budget: "#7c5cff", timing: "#0891b2", other: "#94a3b8",
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default function LossIntelligence() {
  const [mix, setMix] = useState<Mix[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [unfiled, setUnfiled] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/engagement/losses");
        if (!res.ok) { setMix([]); return; }
        const json = await res.json();
        setMix(json.mix ?? []);
        setRecent(json.recent ?? []);
        setTotalValue(json.total_value ?? 0);
        setUnfiled(json.unfiled ?? 0);
      } catch { setMix([]); }
    })();
  }, []);

  if (!mix || (mix.length === 0 && recent.length === 0)) return null;
  const mixTotal = mix.reduce((s, m) => s + m.value, 0) || 1;

  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 13.5V6.2a4 4 0 0 1 8 0v7.3M2.4 13.5h11.2" fill="none" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>What the losses are saying</span>
        <span style={{ fontSize: 11, color: c.hint }}>{inr(totalValue)} lost or dropped in 12 months</span>
        {unfiled > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: c.muted }}>
            {unfiled} older loss{unfiled === 1 ? "" : "es"} with no reason filed yet
          </span>
        )}
      </div>

      {mix.length > 0 && (
        <div>
          <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden" }}>
            {mix.map((m) => (
              <span key={m.reason} style={{ width: `${(m.value / mixTotal) * 100}%`, background: REASON_COLOR[m.reason], minWidth: 3 }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 7, fontSize: 11, color: c.muted }}>
            {mix.map((m) => (
              <span key={m.reason} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: REASON_COLOR[m.reason] }} />
                {LOSS_REASON_LABEL[m.reason]} · {Math.round((m.value / mixTotal) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recent.map((q) => (
            <Link key={q.id} href={ROUTES.quotation(q.id)} style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "8px 11px", borderRadius: 9, textDecoration: "none",
              border: "1px solid var(--line)", background: "var(--panel2)",
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{q.account_name ?? q.ref}</span>
              <span style={{ fontSize: 11, color: c.hint }}>{q.ref}</span>
              {q.reason && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  color: REASON_COLOR[q.reason], background: `${REASON_COLOR[q.reason]}1c`,
                }}>
                  {LOSS_REASON_LABEL[q.reason]}
                </span>
              )}
              {q.note && <span style={{ fontSize: 11, color: c.muted, flex: "1 1 160px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>&ldquo;{q.note}&rdquo;</span>}
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 650, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{inr(q.total)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
