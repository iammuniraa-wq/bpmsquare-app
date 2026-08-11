"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { LeaveRequestStatus, WfmLeaveRequest } from "@/lib/wfm/types";

type LeaveType = { id: string; name: string; category: "paid" | "unpaid" | "half_day"; active: boolean; annual_quota: number };
type LeaveRecord = {
  id: string; employee_id: string; leave_type_id: string; date_from: string; date_to: string;
  half_day: boolean; remarks: string | null;
  employees: { first_name: string; last_name: string; employee_code: string | null } | null;
  wfm_leave_types: { name: string; category: string } | null;
};
type EmployeeOpt = { id: string; first_name: string; last_name: string; employee_code: string | null };
type LeaveRequestRow = WfmLeaveRequest & {
  employees: { first_name: string; last_name: string; employee_code: string | null } | null;
  wfm_leave_types: { name: string; category: string } | null;
};

const REQUEST_STATUS_TONE: Record<LeaveRequestStatus, "amber" | "green" | "red"> = {
  pending: "amber", approved: "green", rejected: "red",
};

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const btn: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const btnGreen: React.CSSProperties = { ...btn, background: "#10b981", borderColor: "transparent", color: "#fff" };
const btnRed: React.CSSProperties = { ...btn, background: "#ef4444", borderColor: "transparent", color: "#fff" };
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function LeaveClient({ initial = null }: {
  initial?: { types: LeaveType[]; records: LeaveRecord[]; employees: EmployeeOpt[]; requests: LeaveRequestRow[] } | null;
}) {
  const [types, setTypes] = useState<LeaveType[]>(initial?.types ?? []);
  const [records, setRecords] = useState<LeaveRecord[]>(initial?.records ?? []);
  const [employees, setEmployees] = useState<EmployeeOpt[]>(initial?.employees ?? []);
  const [requests, setRequests] = useState<LeaveRequestRow[]>(initial?.requests ?? []);
  const serverSeeded = useRef(initial != null);
  const [requestFilter, setRequestFilter] = useState<"pending" | "all">("pending");
  const [requestQuery, setRequestQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [remark, setRemark] = useState("");

  const [recordForm, setRecordForm] = useState({ employee_id: "", leave_type_id: "", date_from: "", date_to: "", half_day: false, remarks: "" });

  const load = useCallback(async () => {
    const [t, r, e, q] = await Promise.all([
      fetch("/api/wfm/leave-types"), fetch("/api/wfm/leave-records"), fetch("/api/wfm/employees"),
      fetch(requestFilter === "pending" ? "/api/wfm/leave-requests?status=pending" : "/api/wfm/leave-requests"),
    ]);
    if (t.ok) setTypes(await t.json()); else setError((await t.json()).error ?? "Failed to load");
    if (r.ok) setRecords(await r.json());
    if (e.ok) setEmployees(await e.json());
    if (q.ok) setRequests(await q.json());
  }, [requestFilter]);

  useEffect(() => {
    if (serverSeeded.current) { serverSeeded.current = false; return; } // server-rendered bootstrap
    load();
  }, [load]);

  async function resolveRequest(id: string, action: "approve" | "reject", supervisor_remark?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/leave-requests/${id}`, {
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

  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return false; }
      await load();
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function del(url: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) setError((await res.json()).error ?? "Delete failed");
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function addRecord() {
    if (!recordForm.employee_id || !recordForm.leave_type_id || !recordForm.date_from || !recordForm.date_to) {
      setError("Employee, leave type and dates are required");
      return;
    }
    const ok = await post("/api/wfm/leave-records", recordForm);
    if (ok) setRecordForm({ employee_id: "", leave_type_id: "", date_from: "", date_to: "", half_day: false, remarks: "" });
  }

  const empName = (e: { first_name: string; last_name: string } | null) =>
    e ? [e.first_name, e.last_name].filter(Boolean).join(" ") : "";

  const rq = requestQuery.trim().toLowerCase();
  const visibleRequests = requests.filter((r) =>
    !rq ||
    empName(r.employees).toLowerCase().includes(rq) ||
    (r.employees?.employee_code ?? "").toLowerCase().includes(rq) ||
    r.reason_text.toLowerCase().includes(rq) ||
    (r.wfm_leave_types?.name ?? "").toLowerCase().includes(rq)
  );

  const dq = recordQuery.trim().toLowerCase();
  const visibleRecords = records.filter((r) =>
    !dq ||
    empName(r.employees).toLowerCase().includes(dq) ||
    (r.employees?.employee_code ?? "").toLowerCase().includes(dq) ||
    (r.wfm_leave_types?.name ?? "").toLowerCase().includes(dq)
  );

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, padding: 0, marginBottom: 18, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Leave requests</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...inp, width: 220 }} placeholder="Search employee, type or reason…" value={requestQuery} onChange={(e) => setRequestQuery(e.target.value)} />
            <button style={requestFilter === "pending" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setRequestFilter("pending")}>Pending</button>
            <button style={requestFilter === "all" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setRequestFilter("all")}>All</button>
          </div>
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Employee</th><th style={th}>Type</th><th style={th}>From</th><th style={th}>To</th>
              <th style={th}>Reason</th><th style={th}>Status</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {visibleRequests.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600 }}>
                  <Link href={ROUTES.wfmEmployee(r.employee_id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {r.employees ? [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ") : "—"}
                  </Link>
                  {r.employees?.employee_code && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>{r.employees.employee_code}</span>}
                </td>
                <td style={td}>{r.wfm_leave_types?.name ?? "—"}{r.half_day && <span style={{ color: c.hint }}> (half-day)</span>}</td>
                <td style={td}>{fmtDate(r.date_from)}</td>
                <td style={td}>{fmtDate(r.date_to)}</td>
                <td style={{ ...td, maxWidth: 220, color: c.muted }}>{r.reason_text}</td>
                <td style={td}>
                  <Pill label={r.status} tone={REQUEST_STATUS_TONE[r.status]} />
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
                          style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, width: 130 }}
                        />
                        <button style={btnRed} disabled={busy || !remark.trim()} onClick={() => resolveRequest(r.id, "reject", remark)}>Confirm</button>
                        <button style={btn} disabled={busy} onClick={() => { setRejecting(null); setRemark(""); }}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button style={btnGreen} disabled={busy} onClick={() => resolveRequest(r.id, "approve")}>Approve</button>{" "}
                        <button style={btnRed} disabled={busy} onClick={() => setRejecting(r.id)}>Reject</button>
                      </>
                    )
                  )}
                </td>
              </tr>
            ))}
            {visibleRequests.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={7}>No {requestFilter === "pending" ? "pending" : ""} requests.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Leave records</span>
          <input style={{ ...inp, width: 220 }} placeholder="Search employee or leave type…" value={recordQuery} onChange={(e) => setRecordQuery(e.target.value)} />
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Employee</th><th style={th}>Type</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Half-day</th><th style={th}>Remarks</th><th style={th}></th></tr></thead>
          <tbody>
            {visibleRecords.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600 }}>
                  <Link href={ROUTES.wfmEmployee(r.employee_id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {r.employees ? [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ") : "—"}
                  </Link>
                </td>
                <td style={td}>{r.wfm_leave_types?.name ?? "—"}</td>
                <td style={td}>{fmtDate(r.date_from)}</td>
                <td style={td}>{fmtDate(r.date_to)}</td>
                <td style={td}>{r.half_day ? "Yes" : "No"}</td>
                <td style={{ ...td, color: c.muted }}>{r.remarks ?? "—"}</td>
                <td style={td}><button style={btn} disabled={busy} onClick={() => del(`/api/wfm/leave-records/${r.id}`)}>Delete</button></td>
              </tr>
            ))}
            {visibleRecords.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={7}>No leave records yet.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={lbl}>Employee</label>
            <select style={inp} value={recordForm.employee_id} onChange={(e) => setRecordForm({ ...recordForm, employee_id: e.target.value })}>
              <option value="">— select —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{[e.first_name, e.last_name].filter(Boolean).join(" ")} {e.employee_code ? `(${e.employee_code})` : ""}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={lbl}>Leave type</label>
            <select style={inp} value={recordForm.leave_type_id} onChange={(e) => setRecordForm({ ...recordForm, leave_type_id: e.target.value })}>
              <option value="">— select —</option>
              {types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ flex: "0 1 140px" }}><label style={lbl}>From</label><input style={inp} type="date" value={recordForm.date_from} onChange={(e) => setRecordForm({ ...recordForm, date_from: e.target.value })} /></div>
          <div style={{ flex: "0 1 140px" }}><label style={lbl}>To</label><input style={inp} type="date" value={recordForm.date_to} onChange={(e) => setRecordForm({ ...recordForm, date_to: e.target.value })} /></div>
          <div style={{ flex: "0 1 100px" }}>
            <label style={lbl}>Half-day</label>
            <select style={inp} value={recordForm.half_day ? "yes" : "no"} onChange={(e) => setRecordForm({ ...recordForm, half_day: e.target.value === "yes" })}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </div>
          <div style={{ flex: "1 1 160px" }}><label style={lbl}>Remarks</label><input style={inp} value={recordForm.remarks} onChange={(e) => setRecordForm({ ...recordForm, remarks: e.target.value })} /></div>
          <button style={btnPrimary} disabled={busy} onClick={addRecord}>Add leave</button>
        </div>
      </section>
    </>
  );
}
