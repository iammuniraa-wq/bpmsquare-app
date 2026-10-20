"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ABM_PROGRESS, ABM_TIERS, PROGRESS_LABEL, TIER_LABEL, type AbmProgress, type AbmTier } from "@/lib/abm/types";
import ProgressWhy from "./ProgressWhy";

export type TargetListRow = {
  id: string;
  href: string;
  accountName: string;
  place: string;
  tier: AbmTier;
  /** Buying stage label from Signals, or null (shown as a dash). */
  stage: string | null;
  progress: AbmProgress;
  nextStep: string | null;
  nextStepDue: string | null;
  overdue: boolean;
  groupText: string;
  hasGap: boolean;
  owner: string | null;
};

const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 600, padding: "9px 12px", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2 };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, verticalAlign: "top" };

const chipStyle = (on: boolean): React.CSSProperties => ({
  font: "inherit", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
  border: `1px solid ${on ? c.accent : "var(--line)"}`, background: on ? c.accentbg : "transparent", color: on ? c.accent : c.ink,
});

function Stage({ label }: { label: string | null }) {
  return label
    ? <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 7, background: pillar.purple.bg, color: pillar.purple.fg, whiteSpace: "nowrap" }}>{label}</span>
    : <span style={{ color: c.hint }} title="Turn on Buying signals to see who is in market">—</span>;
}

function NextStep({ r }: { r: TargetListRow }) {
  if (!r.nextStep) return <span style={{ color: c.hint }}>None set</span>;
  return (
    <span>
      {r.nextStep}
      {r.nextStepDue && <span style={{ display: "block", fontSize: 11.5, color: r.overdue ? pillar.red.fg : c.muted, fontWeight: r.overdue ? 700 : 400 }}>{r.overdue ? "Overdue: " : "Due "}{r.nextStepDue}</span>}
    </span>
  );
}

/**
 * The program's target accounts. Buying stage, Progress and Next step sit side
 * by side on purpose (owner decision): prioritising means reading all three at
 * once. Under 780px every row becomes a card that still shows the three together.
 */
export default function TargetsTable({ rows }: { rows: TargetListRow[] }) {
  const [progress, setProgress] = useState<AbmProgress | "all">("all");
  const [tier, setTier] = useState<AbmTier | "all">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.progress] = (m[r.progress] ?? 0) + 1;
    return m;
  }, [rows]);
  const tierCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.tier] = (m[r.tier] ?? 0) + 1;
    return m;
  }, [rows]);

  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (progress === "all" || r.progress === progress) && (tier === "all" || r.tier === tier) &&
    (!term || `${r.accountName} ${r.place} ${r.owner ?? ""} ${r.nextStep ?? ""}`.toLowerCase().includes(term)));

  if (rows.length === 0) {
    return <Card padding={0}><EmptyState title="No target accounts yet" text="Add the companies this program is for: pick them by name, or copy a marketing target group or a Coverage segment." /></Card>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Filter by progress">
        <button type="button" style={chipStyle(progress === "all")} onClick={() => setProgress("all")} aria-pressed={progress === "all"}>All ({rows.length})</button>
        {ABM_PROGRESS.filter((p) => counts[p]).map((p) => (
          <button key={p} type="button" style={chipStyle(progress === p)} onClick={() => setProgress(p)} aria-pressed={progress === p}>{PROGRESS_LABEL[p]} ({counts[p]})</button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Filter by tier">
          {ABM_TIERS.filter((t) => tierCounts[t]).map((t) => (
            <button key={t} type="button" style={chipStyle(tier === t)} onClick={() => setTier(tier === t ? "all" : t)} aria-pressed={tier === t}>{TIER_LABEL[t]} ({tierCounts[t]})</button>
          ))}
        </div>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, owner, next step…" aria-label="Search target accounts" style={{ maxWidth: 280 }} />
      </div>

      {shown.length === 0 ? (
        <Card padding={0}><EmptyState title="No target accounts match these filters" /></Card>
      ) : (
        <>
          <div className="bpm-list-table">
            <Card padding={0} style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                      <th style={th}>Account</th><th style={th}>Tier</th>
                      <th style={th}>Buying stage</th><th style={th}>Progress</th><th style={th}>Next step</th>
                      <th style={th}>Buying group</th><th style={th}>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                        <td style={td}>
                          <Link href={r.href} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.accountName}</Link>
                          {r.place && <div style={{ fontSize: 11.5, color: c.hint }}>{r.place}</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{TIER_LABEL[r.tier]}</td>
                        <td style={td}><Stage label={r.stage} /></td>
                        <td style={td}><ProgressWhy targetId={r.id} progress={r.progress} /></td>
                        <td style={{ ...td, minWidth: 170 }}><NextStep r={r} /></td>
                        <td style={{ ...td, color: r.hasGap ? pillar.amber.fg : c.muted, fontWeight: r.hasGap ? 600 : 400 }}>{r.groupText}</td>
                        <td style={{ ...td, color: c.muted }}>{r.owner ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <div className="bpm-list-cards">
            {shown.map((r) => (
              <div key={r.id} className="bpm-list-card">
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>
                  <Link href={r.href} style={{ color: c.ink, textDecoration: "none" }}>{r.accountName}</Link>
                  <span style={{ marginLeft: 8, fontSize: 11.5, color: c.hint, fontWeight: 400 }}>{TIER_LABEL[r.tier]}{r.place ? ` · ${r.place}` : ""}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
                  <Stage label={r.stage} />
                  <ProgressWhy targetId={r.id} progress={r.progress} />
                </div>
                <div style={{ fontSize: 12.5, marginTop: 8 }}><span style={{ color: c.hint }}>Next step: </span><NextStep r={r} /></div>
                <div style={{ fontSize: 12.5, marginTop: 4, color: r.hasGap ? pillar.amber.fg : c.muted }}>{r.groupText}{r.owner ? ` · ${r.owner}` : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
