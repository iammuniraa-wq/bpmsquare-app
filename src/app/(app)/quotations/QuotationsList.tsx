"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import type { QuoteSummary } from "@/lib/data/labels";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusPill({ status, statuses }: { status: string; statuses: QuoteStatusDef[] }) {
  const def = statuses.find((s) => s.value === status);
  const color = def?.color ?? "#94a3b8";
  const label = def?.label ?? status;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 12,
      fontSize: 11.5, fontWeight: 600,
      background: `${color}22`, color, border: `1px solid ${color}55`,
    }}>
      {label}
    </span>
  );
}

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuotationsList({ initialRows, quoteStatuses = DEFAULT_QUOTE_STATUSES }: { initialRows: QuoteSummary[]; quoteStatuses?: QuoteStatusDef[] }) {
  const router = useRouter();

  const [rows, setRows]               = useState<QuoteSummary[]>(initialRows);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterTerritory, setFilterTerritory] = useState("");
  const [toast, setToast]             = useState<string | null>(null);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() =>
    rows
      .filter((r) => !filterStatus || r.quote.status === filterStatus)
      .filter((r) => !filterAccount || r.account.name.toLowerCase().includes(filterAccount.toLowerCase()))
      .filter((r) => !filterTerritory || (r.quote.territory ?? "").toLowerCase().includes(filterTerritory.toLowerCase())),
    [rows, filterStatus, filterAccount, filterTerritory]
  );

  // Summary strip values — use first terminal status as "approved", first non-initial non-terminal as "pipeline"
  const terminalStatus  = quoteStatuses.find((s) => s.is_terminal && !s.value.includes("reject"))?.value ?? "approved";
  const pipelineStatus  = quoteStatuses.find((s) => !s.is_initial && !s.is_terminal)?.value ?? "sent";
  const totalApproved   = rows.filter((r) => r.quote.status === terminalStatus).reduce((s, r) => s + r.quote.total, 0);
  const totalPipeline   = rows.filter((r) => r.quote.status === pipelineStatus).reduce((s, r) => s + r.quote.total, 0);

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

  const deleteSelected = async () => {
    const ids = [...selected];
    const results = await Promise.all(
      ids.map((id) => fetch(`/api/quotes/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => !r.ok).length;
    const deleted = ids.length - failed;
    if (deleted > 0) {
      setRows((r) => r.filter((row) => !selected.has(row.quote.id)));
      setSelected(new Set());
    }
    showToast(failed > 0
      ? `${deleted} deleted, ${failed} failed`
      : `${deleted} quote${deleted > 1 ? "s" : ""} deleted`
    );
  };

  const copyQuote = () => {
    const [firstId] = selected;
    const row = rows.find((r) => r.quote.id === firstId);
    if (!row) return;
    sessionStorage.setItem("vvcrm_copy_quote", JSON.stringify({
      accountId:   row.quote.account_id,
      contactId:   row.quote.contact_id ?? "",
      quoteName:   `Copy of ${row.quote.name || row.quote.ref}`,
      notes:       row.quote.notes ?? "",
      terms:       row.quote.terms ?? "",
      scopeOfWork: row.quote.scope_of_work ?? "",
      rows: row.lines.map((l, i) => ({
        kind:        "line",
        id:          String(Date.now() + i),
        description: l.description,
        uom:         l.uom ?? "",
        qty:         String(l.qty),
        rate:        String(l.rate),
        discount:    String(l.discount_pct ?? 0),
        group_id:    l.group_id ?? null,
        group_label: l.group_label ?? null,
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
          {quoteStatuses.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilterStatus(filterStatus === s.value ? "" : s.value)}
              style={{
                fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600,
                background: filterStatus === s.value ? s.color : c.panel2,
                color:      filterStatus === s.value ? "#fff" : c.muted,
              }}
            >
              {s.label}
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

        {/* Territory search */}
        <input
          value={filterTerritory}
          onChange={(e) => setFilterTerritory(e.target.value)}
          placeholder="Territory…"
          style={{
            border: `1px solid ${c.line}`, borderRadius: 8, padding: "6px 12px",
            fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit",
            outline: "none", width: 160,
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
              <th style={th}>Type</th>
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
                <td colSpan={9} style={{ ...td, textAlign: "center", padding: "32px 0", color: c.hint }}>
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
                    <td style={{ ...td, color: c.muted, fontSize: 12 }}>
                      {OFFER_TYPE_LABEL[quote.type] ?? quote.type}
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
                      <StatusPill status={quote.status} statuses={quoteStatuses} />
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
