"use client";

import { useCallback, useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { OtSessionStatus } from "@/lib/wfm/types";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";

type EmployeeRef = { first_name: string; last_name: string; employee_code: string | null } | null;

type OtRow = {
  id: string;
  employee_id: string;
  ot_date: string;
  started_at: string;
  ended_at: string;
  minutes: number;
  status: OtSessionStatus;
  supervisor_remark: string | null;
  employees?: EmployeeRef | EmployeeRef[];
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600, padding: "9px 12px",
  fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 12px", fontSize: 13, verticalAlign: "middle" };
const btn: React.CSSProperties = {
  padding: "6px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 7,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};

const one = (e: OtRow["employees"]): EmployeeRef => (Array.isArray(e) ? e[0] ?? null : e ?? null);
const fmtHM = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Overtime approval queue. Overtime only counts toward payable hours and OT
 * cost once approved here (the monthly summary reads approved sessions
 * only), so this is the pay gate -- same approve/reject-with-remark shape as
 * the corrections and leave queues.
 */
export default function OtQueueClient() {
  const [rows, setRows] = useState<OtRow[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await fetch(filter === "pending" ? "/api/wfm/ot-sessions?status=pending" : "/api/wfm/ot-sessions");
    if (res.ok) setRows(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string, action: "approve" | "reject", supervisor_remark?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/ot-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, supervisor_remark }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not update"); return; }
      setRejecting(null);
      setRemark("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const pendingTotal = rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.minutes, 0);

  const cPage = clampPage(page, rows.length, DEFAULT_PAGE_SIZE);
  const pageRows = paginate(rows, cPage, DEFAULT_PAGE_SIZE);

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...btn,
              fontWeight: filter === f ? 700 : 500,
              color: filter === f ? c.accent : c.muted,
              borderColor: filter === f ? `${c.accent}60` : c.line,
              background: filter === f ? c.accentbg : c.panel,
            }}
          >
            {f === "pending" ? "Pending" : "All"}
          </button>
        ))}
        {pendingTotal > 0 && (
          <span style={{ fontSize: 12, color: c.hint, marginLeft: "auto" }}>
            {fmtHM(pendingTotal)} awaiting approval
          </span>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                <th style={th}>Date</th>
                <th style={th}>From</th>
                <th style={th}>To</th>
                <th style={th}>Duration</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td style={{ ...td, color: c.hint, textAlign: "center", padding: "32px 0" }} colSpan={7}>
                    {filter === "pending" ? "No overtime awaiting approval." : "No overtime recorded yet."}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const emp = one(r.employees);
                const crossesMidnight = r.ended_at.slice(0, 10) !== r.started_at.slice(0, 10);
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ ...td, fontWeight: 600, color: c.ink }}>
                      {emp ? [emp.first_name, emp.last_name].filter(Boolean).join(" ") : "—"}
                      {emp?.employee_code && (
                        <span style={{ fontSize: 11, color: c.hint, fontFamily: "monospace", marginLeft: 6 }}>{emp.employee_code}</span>
                      )}
                    </td>
                    <td style={td}>{fmtDate(r.ot_date)}</td>
                    <td style={td}>{fmtTime(r.started_at)}</td>
                    <td style={td}>
                      {fmtTime(r.ended_at)}
                      {crossesMidnight && (
                        <span style={{ fontSize: 10.5, color: pillar.purple.fg, marginLeft: 5 }} title="Ran past midnight — counted on the start date">
                          +1d
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtHM(r.minutes)}</td>
                    <td style={td}>
                      <Pill
                        label={r.status === "pending" ? "Pending" : r.status === "approved" ? "Approved" : "Rejected"}
                        tone={r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "red"}
                      />
                      {r.supervisor_remark && (
                        <div style={{ fontSize: 11, color: c.hint, marginTop: 3, fontStyle: "italic" }}>{r.supervisor_remark}</div>
                      )}
                    </td>
                    <td style={td}>
                      {r.status === "pending" && (
                        rejecting === r.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input
                              autoFocus
                              value={remark}
                              onChange={(e) => setRemark(e.target.value)}
                              placeholder="Reason for rejecting…"
                              style={{
                                border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 9px",
                                fontSize: 12, background: c.panel, color: c.ink, outline: "none", width: 180,
                              }}
                            />
                            <button
                              style={{ ...btn, color: "#ef4444" }}
                              disabled={busy || !remark.trim()}
                              onClick={() => resolve(r.id, "reject", remark.trim())}
                            >Confirm</button>
                            <button style={btn} disabled={busy} onClick={() => { setRejecting(null); setRemark(""); }}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={{ ...btn, color: "#10b981", borderColor: "#10b98155" }}
                              disabled={busy}
                              onClick={() => resolve(r.id, "approve")}
                            >Approve</button>
                            <button style={btn} disabled={busy} onClick={() => setRejecting(r.id)}>Reject</button>
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "0 12px 10px" }}>
          <Pager page={cPage} total={rows.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
        </div>
      </div>
    </>
  );
}
