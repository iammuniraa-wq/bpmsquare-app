"use client";

import { useCallback, useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { CorrectionIssue, CorrectionStatus, WfmCorrectionRequest } from "@/lib/wfm/types";

type Row = WfmCorrectionRequest & {
  employees: { first_name: string; last_name: string; employee_code: string | null } | null;
};

const ISSUE_LABEL: Record<CorrectionIssue, string> = {
  missing_check_in: "Missing check-in",
  missing_check_out: "Missing check-out",
  wrong_time: "Wrong time",
  other: "Other",
};
const STATUS_TONE: Record<CorrectionStatus, "amber" | "green" | "red"> = {
  pending: "amber", approved: "green", rejected: "red",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "top",
};
const btn: React.CSSProperties = {
  padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnGreen: React.CSSProperties = { ...btn, background: "#10b981", borderColor: "transparent", color: "#fff" };
const btnRed: React.CSSProperties = { ...btn, background: "#ef4444", borderColor: "transparent", color: "#fff" };

const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const inp: React.CSSProperties = {
  padding: "7px 11px", fontSize: 12.5, border: `1px solid ${c.line}`,
  borderRadius: 8, background: c.panel, color: c.ink, outline: "none",
};

export default function CorrectionsQueueClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [query, setQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [remark, setRemark] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(filter === "pending" ? "/api/wfm/corrections?status=pending" : "/api/wfm/corrections");
    const json = await res.json();
    if (res.ok) setRows(json);
    else setError(json.error ?? "Failed to load");
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string, action: "approve" | "reject", supervisor_remark?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/corrections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, supervisor_remark }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setRejecting(null);
      setRemark("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (issueFilter && r.requested_change.issue !== issueFilter) return false;
    if (!q) return true;
    const name = r.employees ? [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ") : "";
    return (
      name.toLowerCase().includes(q) ||
      (r.employees?.employee_code ?? "").toLowerCase().includes(q) ||
      r.reason_text.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button style={filter === "pending" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setFilter("pending")}>Pending</button>
        <button style={filter === "all" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setFilter("all")}>All</button>
        <input
          style={{ ...inp, flex: "1 1 200px", maxWidth: 300 }}
          placeholder="Search employee, code or reason…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={inp} value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
          <option value="">All issue types</option>
          {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: c.hint }}>{visible.length} of {rows.length}</span>
      </div>

      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Employee</th>
              <th style={th}>Date</th>
              <th style={th}>Issue</th>
              <th style={th}>Reason</th>
              <th style={th}>Proposed time</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>
                  {r.employees ? [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ") : "—"}
                  {r.employees?.employee_code && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>{r.employees.employee_code}</span>}
                </td>
                <td style={td}>{fmtDate(r.target_date)}</td>
                <td style={td}>{ISSUE_LABEL[r.requested_change.issue]}</td>
                <td style={{ ...td, maxWidth: 220 }}>{r.reason_text}</td>
                <td style={td}>{fmtTs(r.requested_change.proposed_ts)}</td>
                <td style={td}>
                  <Pill label={r.status} tone={STATUS_TONE[r.status]} />
                  {r.supervisor_remark && <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>{r.supervisor_remark}</div>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.status === "pending" && (
                    rejecting === r.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={remark}
                          onChange={(e) => setRemark(e.target.value)}
                          placeholder="Reason (required)"
                          style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, width: 140 }}
                        />
                        <button style={btnRed} disabled={busy || !remark.trim()} onClick={() => resolve(r.id, "reject", remark)}>Confirm</button>
                        <button style={btn} disabled={busy} onClick={() => { setRejecting(null); setRemark(""); }}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button style={btnGreen} disabled={busy} onClick={() => resolve(r.id, "approve")}>Approve</button>{" "}
                        <button style={btnRed} disabled={busy} onClick={() => setRejecting(r.id)}>Reject</button>
                      </>
                    )
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={7}>No {filter === "pending" ? "pending" : ""} requests{rows.length > 0 ? " match these filters" : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
