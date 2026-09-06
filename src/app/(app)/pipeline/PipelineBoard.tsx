"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, LOSS_REASONS, LOSS_REASON_LABEL, type OpportunityStageDef } from "@/lib/constants";
import { daysBetween, weightedValue, isClosedStage, outcomeForStage } from "@/lib/sales/opportunity";
import type { OpportunityRow } from "@/lib/sales/opportunityServer";

// The deals board (§4.5). Drag a card to another column to change its
// stage; dropping on a closed stage asks for the outcome (and a loss
// reason). Board and list are the same rows -- the toggle only changes
// the drawing.

type Member = { user_id: string; name: string | null; email: string | null };

const money = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(2)} Cr`
  : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)} L`
  : `₹${Math.round(n).toLocaleString("en-IN")}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const initials = (m: Member | undefined) => {
  const s = m?.name || m?.email || "?";
  return s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("") || "?";
};
const sel: React.CSSProperties = { padding: "6px 10px", fontSize: 12.5, borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.ink };

export default function PipelineBoard({ rows, stages, members, accounts, todayKey, currentUserId }: {
  rows: OpportunityRow[];
  stages: OpportunityStageDef[];
  members: Member[];
  accounts: { id: string; name: string }[];
  todayKey: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "list">("board");
  const [owner, setOwner] = useState("");
  const [account, setAccount] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState<{ id: string; stage: string; outcome: "won" | "lost" | "dropped"; loss_reason: string; loss_note: string } | null>(null);
  const [local, setLocal] = useState<OpportunityRow[]>(rows);

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const filtered = local.filter((r) => (!owner || r.owner_id === owner) && (!account || r.account_id === account));
  const openRows = filtered.filter((r) => r.outcome === "open");
  const totalOpen = openRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const weighted = openRows.reduce((s, r) => s + weightedValue(Number(r.amount || 0), r.probability ?? 0), 0);
  const columns = stages.filter((s) => showClosed || !s.is_closed);

  async function moveTo(id: string, stage: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    const before = local;
    setLocal((ls) => ls.map((r) => (r.id === id ? { ...r, stage, stage_since: new Date().toISOString(), ...(extra.outcome ? { outcome: extra.outcome as OpportunityRow["outcome"] } : {}) } : r)));
    try {
      const res = await fetch(`/api/opportunities/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, ...extra }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLocal(before); setError(j.error ?? "Could not move the deal"); return; }
      setLocal((ls) => ls.map((r) => (r.id === id ? { ...r, ...j, account_name: r.account_name, stage_since: r.stage_since } : r)));
      router.refresh();
    } catch { setLocal(before); setError("Network error"); } finally { setBusy(false); }
  }

  function onDrop(stage: string) {
    const id = dragId; setDragId(null); setOverStage(null);
    if (!id) return;
    const row = local.find((r) => r.id === id);
    if (!row || row.stage === stage) return;
    if (isClosedStage(stages, stage)) {
      const implied = outcomeForStage(stages, stage);
      setClosing({ id, stage, outcome: implied === "open" ? "won" : implied, loss_reason: "price", loss_note: "" });
      return;
    }
    moveTo(id, stage, { outcome: "open" });
  }

  const card = (r: OpportunityRow) => {
    const m = memberById.get(r.owner_id ?? "");
    const days = daysBetween(r.stage_since, todayKey);
    return (
      <div
        key={r.id} draggable onDragStart={() => setDragId(r.id)} onDragEnd={() => { setDragId(null); setOverStage(null); }}
        style={{ ...cardStyle, padding: "10px 12px", marginBottom: 8, cursor: "grab", opacity: dragId === r.id ? 0.5 : 1, borderLeft: `3px solid ${stages.find((s) => s.value === r.stage)?.color ?? c.line}` }}
      >
        <Link href={ROUTES.pipelineDetail(r.id)} style={{ fontSize: 13, fontWeight: 700, color: c.ink, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title}>{r.title}</Link>
        <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.account_name ?? "—"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(Number(r.amount || 0))}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: c.accentbg, color: c.accent }}>{r.probability ?? 0}%</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: days > 30 ? "var(--amberink)" : c.hint }} title={`${days} day${days === 1 ? "" : "s"} in this stage`}>{days}d</span>
          <span title={m?.name ?? m?.email ?? "Unassigned"} style={{ width: 20, height: 20, borderRadius: 999, background: r.owner_id === currentUserId ? c.accent : c.panel2, color: r.owner_id === currentUserId ? "#fff" : c.muted, fontSize: 9.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(m)}</span>
        </div>
        {r.expected_close && <div style={{ fontSize: 10.5, color: c.hint, marginTop: 4 }}>Close by {fmtDate(r.expected_close)}</div>}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: c.muted }}>
          <span>Open <b style={{ color: c.ink }}>{money(totalOpen)}</b></span>
          <span>Weighted <b style={{ color: c.ink }}>{money(weighted)}</b></span>
        </div>
        <span style={{ marginLeft: "auto" }} />
        <select value={owner} onChange={(e) => setOwner(e.target.value)} style={sel}>
          <option value="">Every owner</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
        </select>
        <select value={account} onChange={(e) => setAccount(e.target.value)} style={sel}>
          <option value="">Every account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label style={{ fontSize: 12, color: c.muted, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        <div style={{ display: "inline-flex", border: `1px solid ${c.line}`, borderRadius: 7, overflow: "hidden" }}>
          {(["board", "list"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} style={{ fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "none", cursor: "pointer", background: view === v ? c.accentbg : "transparent", color: view === v ? c.accent : c.muted }}>{v === "board" ? "Board" : "List"}</button>
          ))}
        </div>
      </div>
      {error && <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}

      {view === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`, gap: 12, overflowX: "auto", alignItems: "start" }}>
          {columns.map((s) => {
            const inStage = filtered.filter((r) => r.stage === s.value);
            const value = inStage.reduce((sum, r) => sum + Number(r.amount || 0), 0);
            return (
              <div
                key={s.value}
                onDragOver={(e) => { e.preventDefault(); if (overStage !== s.value) setOverStage(s.value); }}
                onDragLeave={() => setOverStage((o) => (o === s.value ? null : o))}
                onDrop={() => onDrop(s.value)}
                style={{ background: overStage === s.value ? c.accentbg : c.panel2, borderRadius: 10, padding: 8, minHeight: 200, border: `1px dashed ${overStage === s.value ? c.accent : "transparent"}`, opacity: busy ? 0.7 : 1 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 8px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: c.ink }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: c.hint }}>{inStage.length}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{money(value)}</span>
                </div>
                {inStage.map(card)}
                {inStage.length === 0 && <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center", padding: "18px 0" }}>Nothing here</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...cardStyle, overflow: "hidden", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: c.panel2 }}>
                {["Deal", "Account", "Stage", "Amount", "Prob.", "Weighted", "Owner", "Days", "Close by"].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 3 && i <= 5 || i === 7 ? "right" : "left", padding: "8px 12px", fontSize: 11, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.filter((r) => showClosed || !isClosedStage(stages, r.stage)).map((r) => {
                const s = stages.find((x) => x.value === r.stage);
                const m = memberById.get(r.owner_id ?? "");
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: "9px 12px", fontSize: 13 }}><Link href={ROUTES.pipelineDetail(r.id)} style={{ color: c.ink, fontWeight: 600, textDecoration: "none" }}>{r.title}</Link><div style={{ fontSize: 11, color: c.hint }}>{r.ref}</div></td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, color: c.muted }}>{r.account_name ?? "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s?.color ?? c.line }} />{s?.label ?? r.stage}</span></td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(Number(r.amount || 0))}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right" }}>{r.probability ?? 0}%</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(weightedValue(Number(r.amount || 0), r.probability ?? 0))}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, color: c.muted }}>{m?.name ?? m?.email ?? "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right", color: c.muted }}>{daysBetween(r.stage_since, todayKey)}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12.5, color: c.muted }}>{fmtDate(r.expected_close)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {closing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setClosing(null)}>
          <div style={{ ...cardStyle, width: 380, padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Close this deal as…</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["won", "lost", "dropped"] as const).map((o) => (
                <button key={o} type="button" onClick={() => setClosing({ ...closing, outcome: o })} style={{ flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${closing.outcome === o ? c.accent : c.line}`, background: closing.outcome === o ? c.accentbg : "transparent", color: closing.outcome === o ? c.accent : c.muted, textTransform: "capitalize" }}>{o}</button>
              ))}
            </div>
            {closing.outcome !== "won" && (
              <>
                <select value={closing.loss_reason} onChange={(e) => setClosing({ ...closing, loss_reason: e.target.value })} style={{ ...sel, width: "100%", marginBottom: 8 }}>
                  {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABEL[r]}</option>)}
                </select>
                <input value={closing.loss_note} onChange={(e) => setClosing({ ...closing, loss_note: e.target.value })} placeholder="What happened (optional)" style={{ ...sel, width: "100%", marginBottom: 8, boxSizing: "border-box" }} />
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setClosing(null)} style={{ ...sel, cursor: "pointer" }}>Cancel</button>
              <button type="button" disabled={busy} onClick={async () => { const cl = closing; setClosing(null); await moveTo(cl.id, cl.stage, { outcome: cl.outcome, ...(cl.outcome !== "won" ? { loss_reason: cl.loss_reason, loss_note: cl.loss_note || null } : {}) }); }} style={{ ...sel, cursor: "pointer", background: c.accent, color: "#fff", border: "none", fontWeight: 700 }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
