"use client";

import { useCallback, useEffect, useState } from "react";

type DayRecord = {
  date: string;
  first_in: string | null;
  last_out: string | null;
  net_minutes: number;
  break_minutes: number;
  late: boolean;
  absent: boolean;
  incomplete: boolean;
  on_leave: { name: string; category: string; half_day: boolean } | null;
  holiday: string | null;
  is_week_off: boolean;
  punches: number;
};

type Summary = {
  full_name: string;
  employee_code: string | null;
  totals: {
    days_present: number;
    working_minutes: number;
    late_marks: number;
    half_day_deductions: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    holiday_days: number;
    night_shifts: number;
    night_allowance_total: number;
    incomplete_days: number;
  };
  days: DayRecord[];
};

type LeaveBalance = { name: string; category: string; quota: number; used: number; balance: number };

function fmtHM(mins: number) {
  return `${Math.floor(mins / 60)}h ${String(Math.abs(mins) % 60).padStart(2, "0")}m`;
}
function fmtTime(s: string | null) {
  return s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
}
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function TimesheetClient({ accentColor }: { accentColor: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (m: string) => {
    setError("");
    try {
      const res = await fetch(`/api/wfm/me/timesheet?month=${m}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not load"); return; }
      setSummary(json.summary);
      setLeaveBalance(json.leave_balance ?? []);
    } catch {
      setError("Network error");
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const S: Record<string, React.CSSProperties> = {
    page: { minHeight: "100dvh", background: "#0e1a28", color: "#e8eef4", fontFamily: "system-ui, -apple-system, sans-serif", padding: "18px 16px 24px", maxWidth: 480, margin: "0 auto" },
    card: { background: "#152233", borderRadius: 14, padding: 16, marginTop: 14 },
    row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e2f44", fontSize: 13 },
    statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 },
    stat: { textAlign: "center" as const },
  };

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <button style={{ background: "none", border: "none", color: accentColor, fontSize: 18, cursor: "pointer" }} onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{monthLabel(month)}</div>
        <button style={{ background: "none", border: "none", color: accentColor, fontSize: 18, cursor: "pointer" }} onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
      </div>

      {error && <div style={{ color: "#ff6b6b", fontSize: 12.5, marginTop: 10 }}>{error}</div>}

      {summary && (
        <>
          <div style={S.card}>
            <div style={S.statGrid}>
              <div style={S.stat}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtHM(summary.totals.working_minutes)}</div>
                <div style={{ fontSize: 10.5, color: "#8fa1b3" }}>working hours</div>
              </div>
              <div style={S.stat}>
                <div style={{ fontSize: 20, fontWeight: 700, color: summary.totals.late_marks > 0 ? "#f6b23c" : undefined }}>{summary.totals.late_marks}</div>
                <div style={{ fontSize: 10.5, color: "#8fa1b3" }}>late marks</div>
              </div>
              <div style={S.stat}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.totals.days_present}</div>
                <div style={{ fontSize: 10.5, color: "#8fa1b3" }}>days present</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11.5, color: "#8fa1b3", flexWrap: "wrap" }}>
              <span>Paid leave: {summary.totals.paid_leave_days}</span>
              <span>Unpaid leave: {summary.totals.unpaid_leave_days}</span>
              <span>Holidays: {summary.totals.holiday_days}</span>
              {summary.totals.night_shifts > 0 && <span>Night shifts: {summary.totals.night_shifts}</span>}
              {summary.totals.half_day_deductions > 0 && (
                <span style={{ color: "#f6b23c" }}>Half-day deductions: {summary.totals.half_day_deductions}</span>
              )}
              {summary.totals.incomplete_days > 0 && (
                <span style={{ color: "#ff6b6b" }}>Incomplete days: {summary.totals.incomplete_days}</span>
              )}
            </div>
          </div>

          {leaveBalance.length > 0 && (
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#c6d2dd" }}>Leave balance ({month.slice(0, 4)})</div>
              {leaveBalance.map((lb) => (
                <div key={lb.name} style={S.row}>
                  <span>{lb.name}</span>
                  <span style={{ color: lb.balance <= 0 ? "#ff6b6b" : "#8fa1b3" }}>{lb.balance} / {lb.quota} left</span>
                </div>
              ))}
            </div>
          )}

          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#c6d2dd" }}>Days</div>
            {summary.days.map((d) => {
              const label = d.on_leave ? `Leave — ${d.on_leave.name}` : d.holiday ? `Holiday — ${d.holiday}`
                : d.is_week_off ? "Week off" : d.absent ? "Absent" : d.punches === 0 ? "—" : null;
              return (
                <div key={d.date} style={S.row}>
                  <span style={{ color: "#8fa1b3", width: 70, flexShrink: 0 }}>
                    {new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                  {label ? (
                    <span style={{ flex: 1, color: d.absent ? "#ff6b6b" : "#8fa1b3" }}>{label}</span>
                  ) : (
                    <>
                      <span style={{ flex: 1 }}>
                        {fmtTime(d.first_in)} – {fmtTime(d.last_out)}
                        {d.incomplete && <span style={{ color: "#ff6b6b", marginLeft: 6, fontSize: 11 }}>incomplete</span>}
                        {d.late && <span style={{ color: "#f6b23c", marginLeft: 6, fontSize: 11 }}>late</span>}
                      </span>
                      <span style={{ fontWeight: 600 }}>{fmtHM(d.net_minutes)}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
