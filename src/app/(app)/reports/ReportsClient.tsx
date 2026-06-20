"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { QUOTE_STATUS_LABEL } from "@/lib/data";
import type { QuoteSummary } from "@/lib/data";
import type { Quote } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr    = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const statusTone: Record<Quote["status"], PillarKey> = {
  draft: "blue", sent: "purple", approved: "teal", rejected: "red",
};
const STATUSES: Array<Quote["status"]> = ["draft", "sent", "approved", "rejected"];

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "8px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 11.5, whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(rows: QuoteSummary[]) {
  const headers = ["Ref", "Account", "Status", "Total (INR)", "Lines", "Created", "Valid Until"];
  const body = rows.map((r) => [
    r.quote.ref,
    r.account.name,
    QUOTE_STATUS_LABEL[r.quote.status],
    r.quote.total,
    r.lineCount,
    r.quote.created_at,
    r.quote.valid_until ?? "",
  ]);
  const csv = [headers, ...body].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `quotations_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsClient({ rows }: { rows: QuoteSummary[] }) {
  const [filterStatus,  setFilterStatus]  = useState<Quote["status"] | "">("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo,   setFilterDateTo]   = useState("");
  const [filterAmtMin,  setFilterAmtMin]  = useState("");
  const [filterAmtMax,  setFilterAmtMax]  = useState("");
  const [filtersOpen,   setFiltersOpen]   = useState(false);
  const [sortKey, setSortKey] = useState<"date" | "total" | "account">("date");
  const [sortAsc, setSortAsc] = useState(false);

  // ── Filter + sort ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const amtMin = parseFloat(filterAmtMin) || 0;
    const amtMax = parseFloat(filterAmtMax) || Infinity;
    return rows
      .filter((r) => !filterStatus  || r.quote.status === filterStatus)
      .filter((r) => !filterAccount || r.account.name.toLowerCase().includes(filterAccount.toLowerCase()))
      .filter((r) => !filterDateFrom || r.quote.created_at >= filterDateFrom)
      .filter((r) => !filterDateTo   || r.quote.created_at <= filterDateTo)
      .filter((r) => r.quote.total >= amtMin && r.quote.total <= amtMax)
      .sort((a, b) => {
        let diff = 0;
        if (sortKey === "date")    diff = a.quote.created_at.localeCompare(b.quote.created_at);
        if (sortKey === "total")   diff = a.quote.total - b.quote.total;
        if (sortKey === "account") diff = a.account.name.localeCompare(b.account.name);
        return sortAsc ? diff : -diff;
      });
  }, [rows, filterStatus, filterAccount, filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax, sortKey, sortAsc]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(false); }
  };
  const sortIcon = (key: typeof sortKey) =>
    sortKey !== key ? " ↕" : sortAsc ? " ↑" : " ↓";

  // ── KPIs (from full rows, not filtered) ───────────────────────────────────

  const kpis = useMemo(() => {
    const approved  = rows.filter((r) => r.quote.status === "approved");
    const sent      = rows.filter((r) => r.quote.status === "sent");
    const won       = approved.length;
    const resolved  = approved.length + rows.filter((r) => r.quote.status === "rejected").length;
    return {
      total:      rows.length,
      approved:   approved.reduce((s, r) => s + r.quote.total, 0),
      pipeline:   sent.reduce((s, r) => s + r.quote.total, 0),
      avgDeal:    rows.length ? Math.round(rows.reduce((s, r) => s + r.quote.total, 0) / rows.length) : 0,
      winRate:    resolved ? Math.round((won / resolved) * 100) : 0,
    };
  }, [rows]);

  // ── Status breakdown ───────────────────────────────────────────────────────

  const statusBreakdown = useMemo(() =>
    STATUSES.map((s) => ({
      status: s,
      count:  rows.filter((r) => r.quote.status === s).length,
      value:  rows.filter((r) => r.quote.status === s).reduce((sum, r) => sum + r.quote.total, 0),
    })),
    [rows]
  );
  const maxValue = Math.max(...statusBreakdown.map((b) => b.value), 1);

  // ── Top accounts ───────────────────────────────────────────────────────────

  const topAccounts = useMemo(() => {
    const byAccount = new Map<string, { name: string; total: number; count: number }>();
    rows.forEach((r) => {
      const cur = byAccount.get(r.account.id) ?? { name: r.account.name, total: 0, count: 0 };
      cur.total += r.quote.total; cur.count += 1;
      byAccount.set(r.account.id, cur);
    });
    return [...byAccount.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [rows]);
  const maxAccountValue = Math.max(...topAccounts.map((a) => a.total), 1);

  const activeFilters = [filterStatus, filterAccount, filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax].filter(Boolean).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Filter toggle bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 8,
            border: `1px solid ${c.line}`, cursor: "pointer",
            background: filtersOpen ? c.accentbg : c.panel,
            color: filtersOpen ? c.accent : c.muted,
          }}
        >
          ⊞ Filters
          {activeFilters > 0 && (
            <span style={{ background: c.accent, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>
              {activeFilters}
            </span>
          )}
        </button>

        {/* Inline status chips */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setFilterStatus("")} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, background: filterStatus === "" ? c.accent : c.panel2, color: filterStatus === "" ? "#fff" : c.muted }}>All</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setFilterStatus(filterStatus === s ? "" : s)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, background: filterStatus === s ? pillar[statusTone[s]].base : c.panel2, color: filterStatus === s ? "#fff" : c.muted }}>
              {QUOTE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: c.hint }}>{filtered.length} of {rows.length} quotes</span>
          <button
            onClick={() => exportCsv(filtered)}
            style={{ fontSize: 12, fontWeight: 600, padding: "7px 16px", borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Expanded filter panel */}
      {filtersOpen && (
        <div style={{ ...cardStyle, marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Account</label>
            <input value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} placeholder="Search account…" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>From date</label>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>To date</label>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Min amount (₹)</label>
            <input type="number" value={filterAmtMin} onChange={(e) => setFilterAmtMin(e.target.value)} placeholder="0" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Max amount (₹)</label>
            <input type="number" value={filterAmtMax} onChange={(e) => setFilterAmtMax(e.target.value)} placeholder="No limit" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={() => { setFilterStatus(""); setFilterAccount(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterAmtMin(""); setFilterAmtMax(""); }}
              style={{ fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel2, color: c.muted, cursor: "pointer" }}
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Total quotes",  value: kpis.total,             suffix: "",   color: c.ink,          bg: c.panel },
          { label: "Approved",      value: inr(kpis.approved),     suffix: "",   color: pillar.teal.fg, bg: pillar.teal.bg },
          { label: "Pipeline",      value: inr(kpis.pipeline),     suffix: "",   color: pillar.blue.fg, bg: pillar.blue.bg },
          { label: "Avg deal size", value: inr(kpis.avgDeal),      suffix: "",   color: c.muted,        bg: c.panel },
          { label: "Win rate",      value: kpis.winRate,           suffix: "%",  color: pillar.green.fg, bg: pillar.green.bg },
        ].map((k) => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: c.muted, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.value}{k.suffix}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

        {/* Status bar chart */}
        <section style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
            Pipeline by status
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {statusBreakdown.map((b) => (
              <div key={b.status}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Pill label={QUOTE_STATUS_LABEL[b.status]} tone={statusTone[b.status]} />
                    <span style={{ fontSize: 12, color: c.muted }}>{b.count} quote{b.count !== 1 ? "s" : ""}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>{inr(b.value)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: c.panel2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${Math.max(2, Math.round((b.value / maxValue) * 100))}%`,
                    background: pillar[statusTone[b.status]].base,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Top accounts */}
        <section style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
            Top accounts by quote value
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {topAccounts.map((a, i) => (
              <div key={a.name}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, width: 16 }}>#{i + 1}</span>
                    <span style={{ fontSize: 12.5, color: c.ink, fontWeight: 500 }}>{a.name}</span>
                    <span style={{ fontSize: 11, color: c.hint }}>{a.count} quote{a.count !== 1 ? "s" : ""}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>{inr(a.total)}</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: c.panel2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${Math.max(2, Math.round((a.total / maxAccountValue) * 100))}%`,
                    background: c.accent,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Full data table */}
      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${c.line}` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            All quotes — {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
          <button onClick={() => exportCsv(filtered)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.muted, cursor: "pointer" }}>
            ↓ Export CSV
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Ref</th>
              <th style={{ ...th, cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("account")}>
                Account{sortIcon("account")}
              </th>
              <th style={th}>Status</th>
              <th style={th}>Lines</th>
              <th style={{ ...th, textAlign: "right", cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("total")}>
                Total{sortIcon("total")}
              </th>
              <th style={{ ...th, cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("date")}>
                Date{sortIcon("date")}
              </th>
              <th style={th}>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: "center", padding: "32px 0", color: c.hint }}>
                  No quotes match the current filters
                </td>
              </tr>
            ) : (
              filtered.map(({ quote, account, lineCount }) => (
                <tr key={quote.id} style={{ cursor: "default" }}>
                  <td style={td}>
                    <Link href={ROUTES.quotation(quote.id)} style={{ fontWeight: 600, color: c.accent, fontFamily: "monospace", fontSize: 12 }}>
                      {quote.ref}
                    </Link>
                  </td>
                  <td style={td}>
                    <Link href={ROUTES.account(account.id)} style={{ color: c.ink }}>
                      {account.name}
                    </Link>
                  </td>
                  <td style={td}>
                    <Pill label={QUOTE_STATUS_LABEL[quote.status]} tone={statusTone[quote.status]} />
                  </td>
                  <td style={{ ...td, color: c.muted }}>{lineCount} items</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{inr(quote.total)}</td>
                  <td style={{ ...td, color: c.muted }}>{fmtDate(quote.created_at)}</td>
                  <td style={{ ...td, color: c.muted }}>{quote.valid_until ? fmtDate(quote.valid_until) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
