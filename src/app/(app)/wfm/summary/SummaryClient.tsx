"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Donut from "@/components/Donut";

type BreakSegment = { start: string; end: string | null; minutes: number };
type WorkSession = { in: string; out: string | null; gross_minutes: number; break_minutes: number; net_minutes: number; breaks: BreakSegment[] };
type DayRecord = {
  date: string;
  first_in: string | null;
  last_out: string | null;
  sessions: WorkSession[];
  breaks: BreakSegment[];
  gross_minutes: number;
  break_minutes: number;
  net_minutes: number;
  late: boolean;
  absent: boolean;
  incomplete: boolean;
  on_leave: { name: string; category: string } | null;
  holiday: string | null;
  is_week_off: boolean;
  punches: number;
};

type EmployeeSummary = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: "full_time" | "contractor";
  site_id: string | null;
  site_name: string | null;
  days: DayRecord[];
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
};

const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 11, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12, verticalAlign: "middle", whiteSpace: "nowrap" };
const inp: React.CSSProperties = { padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none" };
const btn: React.CSSProperties = { padding: "9px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnActive: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer", textDecoration: "none", display: "inline-block" };

const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.abs(Math.round(mins)) % 60).padStart(2, "0")}m`;
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" });

function dayStatus(d: DayRecord) {
  if (d.holiday) return { label: d.holiday, color: c.muted };
  if (d.on_leave) return { label: d.on_leave.name, color: c.muted };
  if (d.is_week_off) return { label: "Week off", color: c.hint };
  if (d.incomplete) return { label: "Incomplete", color: statusInk.bad };
  if (d.absent) return { label: "Absent", color: statusInk.bad };
  if (d.late) return { label: "Late", color: statusInk.warn };
  if (d.punches > 0) return { label: "Present", color: statusInk.good };
  return { label: "—", color: c.hint };
}

// ── Monthly view: one row per employee (the CA-facing roll-up) ─────────────

function MonthlySection({ title, rows }: { title: string; rows: EmployeeSummary[] }) {
  return (
    <section style={{ ...cardStyle, padding: 0, marginBottom: 18, overflowX: "auto" }}>
      <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
        {title} <span style={{ color: c.hint, fontWeight: 400 }}>({rows.length})</span>
      </div>
      <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Site</th>
            <th style={th}>Days present</th><th style={th}>Hours</th><th style={th}>Late marks</th>
            <th style={th}>Half-day ded.</th><th style={th}>Paid leave</th><th style={th}>Unpaid leave</th>
            <th style={th}>Holidays</th><th style={th}>Night shifts</th><th style={th}>Night allowance</th>
            <th style={th}>Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id}>
              <td style={{ ...td, fontFamily: "monospace" }}>{r.employee_code ?? "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: c.ink }}>{r.full_name}</td>
              <td style={td}>{r.site_name ?? "—"}</td>
              <td style={td}>{r.totals.days_present}</td>
              <td style={td}>{fmtHM(r.totals.working_minutes)}</td>
              <td style={{ ...td, color: r.totals.late_marks > 0 ? statusInk.warn : undefined }}>{r.totals.late_marks}</td>
              <td style={td}>{r.totals.half_day_deductions}</td>
              <td style={td}>{r.totals.paid_leave_days}</td>
              <td style={td}>{r.totals.unpaid_leave_days}</td>
              <td style={td}>{r.totals.holiday_days}</td>
              <td style={td}>{r.totals.night_shifts}</td>
              <td style={td}>{r.totals.night_allowance_total ? `₹${r.totals.night_allowance_total.toLocaleString("en-IN")}` : "—"}</td>
              <td style={{ ...td, color: r.totals.incomplete_days > 0 ? statusInk.bad : undefined }}>{r.totals.incomplete_days || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={13}>No employees in this section.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

// ── Daily view: one row per employee per day, every punch as booked ────────

function DailyEmployee({ emp, deductBreaks }: { emp: EmployeeSummary; deductBreaks: boolean }) {
  const [open, setOpen] = useState(false);
  // Only days the employee actually did something on -- a month of empty
  // future/week-off rows per employee would bury the real data.
  const rows = emp.days.filter((d) => d.punches > 0 || d.on_leave || d.holiday || d.absent);

  return (
    <section style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", borderBottom: open ? `1px solid ${c.line}` : "none" }}
      >
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{emp.full_name}</span>
          {emp.employee_code && <span style={{ fontFamily: "monospace", fontSize: 11.5, color: c.hint, marginLeft: 8 }}>{emp.employee_code}</span>}
          {emp.site_name && <span style={{ fontSize: 11.5, color: c.hint, marginLeft: 8 }}>· {emp.site_name}</span>}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12, color: c.muted, whiteSpace: "nowrap" }}>
          <span>{emp.totals.days_present} days</span>
          <span style={{ color: c.ink, fontWeight: 700 }}>{fmtHM(emp.totals.working_minutes)}</span>
          <span style={{ fontSize: 10, color: c.hint, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
        </div>
      </div>

      {open && (
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Date</th><th style={th}>In</th><th style={th}>Out</th>
              <th style={th}>Breaks taken</th><th style={th}>Break total</th>
              <th style={th}>Gross</th><th style={th}>Total worked</th><th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const st = dayStatus(d);
              return (
                <tr key={d.date}>
                  <td style={{ ...td, color: c.ink, fontWeight: 600, verticalAlign: "top" }}>{fmtDay(d.date)}</td>
                  <td style={{ ...td, verticalAlign: "top" }}>
                    {d.sessions.length === 0 ? "—" : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {d.sessions.map((s, i) => (
                          <span key={s.in}>{d.sessions.length > 1 && <span style={{ color: c.hint }}>{i + 1}. </span>}{fmtTime(s.in)}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, verticalAlign: "top" }}>
                    {d.sessions.length === 0 ? "—" : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {d.sessions.map((s) => (
                          <span key={s.in}>{s.out ? fmtTime(s.out) : <span style={{ color: statusInk.bad }}>missing</span>}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "normal", verticalAlign: "top" }}>
                    {d.breaks.length === 0 ? <span style={{ color: c.hint }}>—</span> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {d.breaks.map((b, i) => (
                          <span key={b.start} style={{ whiteSpace: "nowrap" }}>
                            <span style={{ color: c.hint }}>{i + 1}.</span>{" "}
                            {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : <span style={{ color: statusInk.warn }}>running</span>}
                            <span style={{ color: c.hint }}> ({b.minutes}m)</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, verticalAlign: "top" }}>{d.break_minutes > 0 ? fmtHM(d.break_minutes) : "—"}</td>
                  <td style={{ ...td, color: c.muted, verticalAlign: "top" }}>{d.punches > 0 ? fmtHM(d.gross_minutes) : "—"}</td>
                  <td style={{ ...td, fontWeight: 700, color: c.ink, verticalAlign: "top" }}>{d.punches > 0 ? fmtHM(deductBreaks ? d.net_minutes : d.gross_minutes) : "—"}</td>
                  <td style={{ ...td, color: st.color, verticalAlign: "top" }}>{st.label}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={8}>No activity this month.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700, color: c.ink }} colSpan={4}>Month total</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtHM(emp.days.reduce((s, d) => s + d.break_minutes, 0))}</td>
              <td style={{ ...td, fontWeight: 700, color: c.muted }}>{fmtHM(emp.days.reduce((s, d) => s + d.gross_minutes, 0))}</td>
              <td style={{ ...td, fontWeight: 700, color: c.ink }}>{fmtHM(emp.totals.working_minutes)}</td>
              <td style={td}></td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

export default function SummaryClient() {
  const [view, setView] = useState<"daily" | "monthly">("monthly");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<EmployeeSummary[]>([]);
  const [deductBreaks, setDeductBreaks] = useState(true);
  const [siteFilter, setSiteFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [attentionFilter, setAttentionFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/summary?month=${m}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setRows(json.employees);
      setDeductBreaks(json.deduct_breaks !== false);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const sites = useMemo(() => [...new Set(rows.map((r) => r.site_name).filter(Boolean))] as string[], [rows]);

  // Where the month's days actually went, across everyone in view -- the
  // proportional read a per-employee totals table can't give at a glance.
  const dayMix = useMemo(() => {
    const counts = { Present: 0, Late: 0, Absent: 0, Leave: 0, Holiday: 0, "Week off": 0, Incomplete: 0 };
    for (const emp of rows) {
      for (const d of emp.days) {
        if (d.holiday) counts.Holiday++;
        else if (d.on_leave) counts.Leave++;
        else if (d.is_week_off) counts["Week off"]++;
        else if (d.incomplete) counts.Incomplete++;
        else if (d.absent) counts.Absent++;
        else if (d.late) counts.Late++;
        else if (d.punches > 0) counts.Present++;
      }
    }
    return [
      { label: "Present", value: counts.Present, color: pillar.green.base },
      { label: "Late", value: counts.Late, color: pillar.amber.base },
      { label: "Absent", value: counts.Absent, color: pillar.red.base },
      { label: "Leave", value: counts.Leave, color: pillar.purple.base },
      { label: "Holiday", value: counts.Holiday, color: pillar.blue.base },
      { label: "Week off", value: counts["Week off"], color: pillar.teal.base },
      { label: "Incomplete", value: counts.Incomplete, color: pillar.red.base },
    ];
  }, [rows]);

  // Headcount split, so a supervisor can see the shape of the workforce the
  // numbers above are drawn from.
  const headcountMix = useMemo(() => {
    const bySite = new Map<string, number>();
    for (const r of rows) bySite.set(r.site_name ?? "No site", (bySite.get(r.site_name ?? "No site") ?? 0) + 1);
    const palette = [pillar.blue.base, pillar.teal.base, pillar.purple.base, pillar.amber.base, pillar.green.base, pillar.red.base];
    return [...bySite.entries()].map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
  }, [rows]);

  // "Needs attention" buckets double as filters -- clicking a slice narrows
  // the tables to just those employees.
  const ATTENTION: Record<string, (r: EmployeeSummary) => boolean> = {
    "Late marks": (r) => r.totals.late_marks > 0,
    "Incomplete days": (r) => r.totals.incomplete_days > 0,
    "Unpaid leave": (r) => r.totals.unpaid_leave_days > 0,
    "Clean": (r) => r.totals.late_marks === 0 && r.totals.incomplete_days === 0 && r.totals.unpaid_leave_days === 0,
  };
  const attentionMix = [
    { label: "Late marks", value: rows.filter(ATTENTION["Late marks"]).length, color: pillar.amber.base },
    { label: "Incomplete days", value: rows.filter(ATTENTION["Incomplete days"]).length, color: pillar.red.base },
    { label: "Unpaid leave", value: rows.filter(ATTENTION["Unpaid leave"]).length, color: pillar.purple.base },
    { label: "Clean", value: rows.filter(ATTENTION["Clean"]).length, color: pillar.green.base },
  ];

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (siteFilter && r.site_name !== siteFilter) return false;
    if (typeFilter && r.employment_type !== typeFilter) return false;
    if (attentionFilter && !ATTENTION[attentionFilter]?.(r)) return false;
    if (!q) return true;
    return r.full_name.toLowerCase().includes(q) || (r.employee_code ?? "").toLowerCase().includes(q);
  });

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button style={view === "daily" ? btnActive : btn} onClick={() => setView("daily")}>Daily — detailed</button>
        <button style={view === "monthly" ? btnActive : btn} onClick={() => setView("monthly")}>Monthly summary</button>
        <input style={inp} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <a style={btnPrimary} href={`/api/wfm/summary/export?month=${month}`}>Export to Excel</a>
        {loading && <span style={{ fontSize: 12, color: c.hint }}>Loading…</span>}
      </div>

      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginBottom: 14 }}>
        <section style={cardStyle}><Donut slices={dayMix} title="How the month went" centerLabel="days" /></section>
        <section style={cardStyle}>
          <Donut
            slices={attentionMix}
            title="Needs attention"
            centerLabel="employees"
            selected={attentionFilter}
            onSelect={setAttentionFilter}
          />
        </section>
        <section style={cardStyle}><Donut slices={headcountMix} title="Headcount by site" centerLabel="employees" /></section>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          style={{ ...inp, flex: "1 1 220px", maxWidth: 320 }}
          placeholder="Search employee name or code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={inp} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={inp} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All employment types</option>
          <option value="full_time">Full-time</option>
          <option value="contractor">Contractor</option>
        </select>
        <select style={inp} value={attentionFilter ?? ""} onChange={(e) => setAttentionFilter(e.target.value || null)}>
          <option value="">Everyone</option>
          {Object.keys(ATTENTION).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: c.hint }}>{filtered.length} of {rows.length}</span>
      </div>

      {view === "monthly" ? (
        <>
          <MonthlySection title="Full-Time" rows={filtered.filter((r) => r.employment_type === "full_time")} />
          <MonthlySection title="Contractors" rows={filtered.filter((r) => r.employment_type === "contractor")} />
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: c.hint, marginBottom: 12 }}>
            Click an employee to see every punch they booked. Total worked ={" "}
            {deductBreaks ? "check-out − check-in − breaks" : "check-out − check-in (breaks not deducted)"}.
          </div>
          {filtered.map((emp) => <DailyEmployee key={emp.employee_id} emp={emp} deductBreaks={deductBreaks} />)}
          {filtered.length === 0 && <div style={{ ...cardStyle, color: c.hint, fontSize: 12.5 }}>No employees.</div>}
        </>
      )}
    </>
  );
}
