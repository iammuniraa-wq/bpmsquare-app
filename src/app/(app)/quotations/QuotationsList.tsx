"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { QUOTE_STATUS_LABEL } from "@/lib/data";
import type { QuoteSummary } from "@/lib/data";
import type { Quote } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const statusTone: Record<Quote["status"], PillarKey> = {
  draft: "blue", sent: "purple", approved: "teal", rejected: "red",
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12, whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = {
  padding: "11px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const STATUSES: Array<Quote["status"]> = ["draft", "sent", "approved", "rejected"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuotationsList({ initialRows }: { initialRows: QuoteSummary[] }) {
  const router = useRouter();

  const [rows, setRows]               = useState<QuoteSummary[]>(initialRows);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Quote["status"] | "">("");
  const [filterAccount, setFilterAccount] = useState("");
  const [toast, setToast]             = useState<string | null>(null);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() =>
    rows
      .filter((r) => !filterStatus || r.quote.status === filterStatus)
      .filter((r) => !filterAccount || r.account.name.toLowerCase().includes(filterAccount.toLowerCase())),
    [rows, filterStatus, filterAccount]
  );

  // Summary strip values
  const totalApproved = rows.filter((r) => r.quote.status === "approved").reduce((s, r) => s + r.quote.total, 0);
  const totalPipeline = rows.filter((r) => r.quote.status === "sent").reduce((s, r) => s + r.quote.total, 0);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.quote.id));
  const someSelected = filtered.some((r) => selected.has(r.quote.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((p) => { const n = new Set(p); filtered.forEach((r) => n.delete(r.quote.id)); return n; });
    } else {
      setSelected((p) => { const n = new Set(p); filtered.forEach((r) => n.add(r.quote.id)); return n; });
    }
  };

  const toggle = (id: string) =>
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Actions ────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const deleteSelected = () => {
    const count = selected.size;
    setRows((r) => r.filter((row) => !selected.has(row.quote.id)));
    setSelected(new Set());
    showToast(`${count} quote${count > 1 ? "s" : ""} removed`);
  };

  const copyQuote = () => {
    const [firstId] = selected;
    const row = rows.find((r) => r.quote.id === firstId);
    if (!row) return;
    sessionStorage.setItem("vvcrm_copy_quote", JSON.stringify({
      accountId: row.quote.account_id,
      quoteName: `Copy of ${row.quote.ref}`,
      notes:     row.quote.notes ?? "",
      lines: row.lines.map((l, i) => ({
        id:          String(Date.now() + i),
        description: l.description,
        qty:         String(l.qty),
        rate:        String(l.rate),
      })),
    }));
    router.push(ROUTES.quotationNew);
  };

  const selectedCount = selected.size;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Total quotes",      value: rows.length,                                                       color: c.ink },
          { label: "Approved value",    value: inr(totalApproved),                                               color: pillar.teal.fg },
          { label: "In pipeline",       value: inr(totalPipeline),                                               color: pillar.blue.fg },
          { label: "Awaiting approval", value: rows.filter((r) => r.quote.status === "sent").length,             color: c.muted },
        ].map((s) => (
          <div key={s.label} style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: c.muted }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {/* Status chips */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setFilterStatus("")}
            style={{
              fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600,
              background: filterStatus === "" ? c.accent : c.panel2,
              color:      filterStatus === "" ? "#fff" : c.muted,
            }}
          >
            All
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? "" : s)}
              style={{
                fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600,
                background: filterStatus === s ? pillar[statusTone[s]].base : c.panel2,
                color:      filterStatus === s ? "#fff" : c.muted,
              }}
            >
              {QUOTE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Account search */}
        <input
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
          placeholder="Search account…"
          style={{
            border: `1px solid ${c.line}`, borderRadius: 8, padding: "6px 12px",
            fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit",
            outline: "none", width: 200,
          }}
        />

        <div style={{ marginLeft: "auto", fontSize: 12, color: c.hint }}>
          {filtered.length} of {rows.length} quotes
        </div>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 36, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer", accentColor: c.accent }}
                />
              </th>
              <th style={th}>Ref</th>
              <th style={th}>Account</th>
              <th style={th}>Status</th>
              <th style={th}>Lines</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={th}>Date</th>
              <th style={th}>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...td, textAlign: "center", padding: "32px 0", color: c.hint }}>
                  No quotes match the current filters
                </td>
              </tr>
            ) : (
              filtered.map(({ quote, account, lineCount }) => {
                const isSelected = selected.has(quote.id);
                return (
                  <tr
                    key={quote.id}
                    style={{ background: isSelected ? c.accentbg : "transparent", cursor: "pointer" }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "INPUT") return;
                      toggle(quote.id);
                    }}
                  >
                    <td style={{ ...td, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(quote.id)}
                        style={{ cursor: "pointer", accentColor: c.accent }}
                      />
                    </td>
                    <td style={td}>
                      <Link
                        href={ROUTES.quotation(quote.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: 600, color: c.accent, fontFamily: "monospace" }}
                      >
                        {quote.ref}
                      </Link>
                    </td>
                    <td style={td}>
                      <Link
                        href={ROUTES.account(account.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: c.ink }}
                      >
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Floating action bar */}
      {selectedCount > 0 && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 10,
          background: c.ink, borderRadius: 12, padding: "10px 16px",
          boxShadow: "0 8px 32px rgba(0,0,0,.35)", zIndex: 500, whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 13, color: "#8fa8c0", fontWeight: 500 }}>
            {selectedCount} selected
          </span>
          <div style={{ width: 1, height: 18, background: "#2e4257" }} />

          {/* Copy — only when exactly 1 selected */}
          <button
            onClick={copyQuote}
            disabled={selectedCount !== 1}
            title={selectedCount !== 1 ? "Select exactly one quote to copy" : "Copy this quote into a new draft"}
            style={{
              fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7, border: "none", cursor: selectedCount === 1 ? "pointer" : "not-allowed",
              background: selectedCount === 1 ? pillar.blue.bg : "#1a2d3e",
              color:      selectedCount === 1 ? pillar.blue.fg : "#4a6070",
            }}
          >
            ⎘ Copy quote
          </button>

          {/* Delete */}
          <button
            onClick={deleteSelected}
            style={{
              fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
              background: pillar.red.bg, color: pillar.red.fg,
            }}
          >
            ✕ Delete
          </button>

          <div style={{ width: 1, height: 18, background: "#2e4257" }} />
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: "none", border: "none", color: "#8fa8c0", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "#1c2733", color: "#fff", fontSize: 13, fontWeight: 500,
          padding: "10px 20px", borderRadius: 9, zIndex: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,.25)",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
