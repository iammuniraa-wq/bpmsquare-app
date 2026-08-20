"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Donut from "@/components/Donut";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { useIsMobile } from "@/lib/useIsMobile";

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
    absent_days: number;
    working_minutes: number;
    late_marks: number;
    half_day_deductions: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    holiday_days: number;
    night_shifts: number;
    night_allowance_total: number;
    incomplete_days: number;
    ot_minutes: number;
    ot_amount: number;
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

/** Mobile: one collapsible card per employee instead of the 16-column
 * table — sideways-scrolling a payroll table on a phone hides all but two
 * columns, which is what the BIM screenshot showed. Collapsed carries the
 * two figures a supervisor scans for (hours, days present); expanding
 * lays out every column the desktop table has, as label/value pairs. */
function MonthlyEmployeeCard({ r }: { r: EmployeeSummary }) {
  const [open, setOpen] = useState(false);
  const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const items: [string, React.ReactNode][] = [
    ["Site", r.site_name ?? "—"],
    ["Days present", r.totals.days_present],
    ["Absent", <span key="a" style={{ color: r.totals.absent_days > 0 ? statusInk.bad : undefined }}>{r.totals.absent_days || "—"}</span>],
    ["Late marks", <span key="l" style={{ color: r.totals.late_marks > 0 ? statusInk.warn : undefined }}>{r.totals.late_marks || "—"}</span>],
    ["Half-day ded.", r.totals.half_day_deductions || "—"],
    ["Paid leave", r.totals.paid_leave_days || "—"],
    ["Unpaid leave", r.totals.unpaid_leave_days || "—"],
    ["Holidays", r.totals.holiday_days || "—"],
    ["Night shifts", r.totals.night_shifts || "—"],
    ["Night allowance", r.totals.night_allowance_total ? rupees(r.totals.night_allowance_total) : "—"],
    ["OT hours", r.totals.ot_minutes ? fmtHM(r.totals.ot_minutes) : "—"],
    ["OT amount", r.totals.ot_amount ? rupees(r.totals.ot_amount) : "—"],
    ["Incomplete days", <span key="i" style={{ color: r.totals.incomplete_days > 0 ? statusInk.bad : undefined }}>{r.totals.incomplete_days || "—"}</span>],
  ];
  return (
    <div style={{ borderBottom: `1px solid ${c.line}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 12px",
          background: "none", border: "none", cursor: "pointer", font: "inherit", textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.full_name}</span>
          {r.employee_code && <span style={{ fontSize: 11, color: c.hint, fontFamily: "monospace" }}>{r.employee_code}</span>}
        </span>
        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{fmtHM(r.totals.working_minutes)}</span>
          <span style={{ fontSize: 11, color: c.muted }}>{r.totals.days_present} days</span>
        </span>
        <span style={{ fontSize: 10, color: c.hint, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
      </button>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", padding: "0 12px 12px" }}>
          {items.map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: c.hint }}>{label}</div>
              <div style={{ fontSize: 12.5, color: c.ink, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mobile shell for the three donuts: collapsed by default, so the numbers
 * a supervisor came for aren't below three screens of charts. */
function CollapsibleCharts({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ ...cardStyle, marginBottom: 14, padding: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%",
          padding: "12px", background: "none", border: "none", cursor: "pointer", font: "inherit", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Charts — how the month went</span>
        <span style={{ fontSize: 10, color: c.hint, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
      </button>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 12px 12px" }}>{children}</div>}
    </section>
  );
}

// ── Monthly view: one row per employee (the CA-facing roll-up) ─────────────

function MonthlySection({ title, rows }: { title: string; rows: EmployeeSummary[] }) {
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();
  useEffect(() => { setPage((p) => clampPage(p, rows.length, DEFAULT_PAGE_SIZE)); }, [rows.length]);
  const pageRows = paginate(rows, page, DEFAULT_PAGE_SIZE);
  if (isMobile) {
    return (
      <section style={{ ...cardStyle, padding: 0, marginBottom: 18 }}>
        <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
          {title} <span style={{ color: c.hint, fontWeight: 400 }}>({rows.length})</span>
        </div>
        {pageRows.map((r) => <MonthlyEmployeeCard key={r.employee_id} r={r} />)}
        {rows.length === 0 && <div style={{ padding: "14px 12px", fontSize: 12, color: c.hint }}>No employees in this section.</div>}
        <div style={{ padding: "0 12px 10px" }}>
          <Pager page={page} total={rows.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
        </div>
      </section>
    );
  }
  return (
    <section style={{ ...cardStyle, padding: 0, marginBottom: 18, overflowX: "auto" }}>
      <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
        {title} <span style={{ color: c.hint, fontWeight: 400 }}>({rows.length})</span>
      </div>
      <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Site</th>
            <th style={th}>Days present</th><th style={th}>Absent</th><th style={th}>Hours</th><th style={th}>Late marks</th>
            <th style={th}>Half-day ded.</th><th style={th}>Paid leave</th><th style={th}>Unpaid leave</th>
            <th style={th}>Holidays</th><th style={th}>Night shifts</th><th style={th}>Night allowance</th>
            <th style={th}>OT hrs</th><th style={th}>OT amt</th><th style={th}>Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.employee_id}>
              <td style={{ ...td, fontFamily: "monospace" }}>{r.employee_code ?? "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: c.ink }}>{r.full_name}</td>
              <td style={td}>{r.site_name ?? "—"}</td>
              <td style={td}>{r.totals.days_present}</td>
              <td style={{ ...td, color: r.totals.absent_days > 0 ? statusInk.bad : undefined }}>{r.totals.absent_days || "—"}</td>
              <td style={td}>{fmtHM(r.totals.working_minutes)}</td>
              <td style={{ ...td, color: r.totals.late_marks > 0 ? statusInk.warn : undefined }}>{r.totals.late_marks}</td>
              <td style={td}>{r.totals.half_day_deductions}</td>
              <td style={td}>{r.totals.paid_leave_days}</td>
              <td style={td}>{r.totals.unpaid_leave_days}</td>
              <td style={td}>{r.totals.holiday_days}</td>
              <td style={td}>{r.totals.night_shifts}</td>
              <td style={td}>{r.totals.night_allowance_total ? `₹${r.totals.night_allowance_total.toLocaleString("en-IN")}` : "—"}</td>
              <td style={td}>{r.totals.ot_minutes ? fmtHM(r.totals.ot_minutes) : "—"}</td>
              <td style={td}>{r.totals.ot_amount ? `₹${Math.round(r.totals.ot_amount).toLocaleString("en-IN")}` : "—"}</td>
              <td style={{ ...td, color: r.totals.incomplete_days > 0 ? statusInk.bad : undefined }}>{r.totals.incomplete_days || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={16}>No employees in this section.</td></tr>}
        </tbody>
      </table>
      <div style={{ padding: "0 12px 10px" }}>
        <Pager page={page} total={rows.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
      </div>
    </section>
  );
}

// ── Daily view: one row per employee per day, every punch as booked ────────

function DailyEmployee({ emp, deductBreaks, dayFilter }: { emp: EmployeeSummary; deductBreaks: boolean; dayFilter?: string }) {
  const [open, setOpen] = useState(false);
  // Only days the employee actually did something on -- a month of empty
  // future/week-off rows per employee would bury the real data. A date
  // filter overrides that: the chosen day is shown even when nothing was
  // booked on it (an empty row IS the answer for that day).
  const rows = emp.days.filter((d) =>
    dayFilter ? d.date === dayFilter : d.punches > 0 || d.on_leave || d.holiday || d.absent
  );
  // One chosen day auto-expands everyone -- collapsed cards would make the
  // supervisor click through the whole team to see a single date.
  const expanded = open || !!dayFilter;

  return (
    <section style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", borderBottom: expanded ? `1px solid ${c.line}` : "none" }}
      >
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{emp.full_name}</span>
          {emp.employee_code && <span style={{ fontFamily: "monospace", fontSize: 11.5, color: c.hint, marginLeft: 8 }}>{emp.employee_code}</span>}
          {emp.site_name && <span style={{ fontSize: 11.5, color: c.hint, marginLeft: 8 }}>· {emp.site_name}</span>}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12, color: c.muted, whiteSpace: "nowrap" }}>
          <span>{emp.totals.days_present} days</span>
          <span style={{ color: c.ink, fontWeight: 700 }}>{fmtHM(emp.totals.working_minutes)}</span>
          <span style={{ fontSize: 10, color: c.hint, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
        </div>
      </div>

      {expanded && (
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
            {rows.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={8}>{dayFilter ? "Not on the roster this day." : "No activity this month."}</td></tr>}
          </tbody>
          {!dayFilter && <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700, color: c.ink }} colSpan={4}>Month total</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtHM(emp.days.reduce((s, d) => s + d.break_minutes, 0))}</td>
              <td style={{ ...td, fontWeight: 700, color: c.muted }}>{fmtHM(emp.days.reduce((s, d) => s + d.gross_minutes, 0))}</td>
              <td style={{ ...td, fontWeight: 700, color: c.ink }}>{fmtHM(emp.totals.working_minutes)}</td>
              <td style={td}></td>
            </tr>
          </tfoot>}
        </table>
      )}
    </section>
  );
}

export default function SummaryClient({ initial = null }: {
  initial?: { month: string; employees: EmployeeSummary[]; deduct_breaks: boolean } | null;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"daily" | "monthly">("monthly");
  // Daily view's optional single-date focus ("" = the whole month).
  const [dayFilter, setDayFilter] = useState("");
  const [dailyPage, setDailyPage] = useState(1);
  const [month, setMonth] = useState(initial?.month ?? new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<EmployeeSummary[]>(initial?.employees ?? []);
  const [deductBreaks, setDeductBreaks] = useState(initial?.deduct_breaks ?? true);
  const [siteFilter, setSiteFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [attentionFilter, setAttentionFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // When the page server-prefetched the current month, skip the redundant
  // mount fetch -- the table paints from `initial` immediately. Any month
  // change still refetches through the effect below.
  const serverSeeded = useRef(initial != null);

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

  useEffect(() => {
    if (serverSeeded.current) { serverSeeded.current = false; return; }
    load(month);
  }, [month, load]);

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
        <input style={inp} type="month" value={month} onChange={(e) => { const m = e.target.value; setMonth(m); if (dayFilter && !dayFilter.startsWith(m)) setDayFilter(""); }} />
        {view === "daily" && (
          <input
            style={inp}
            type="date"
            value={dayFilter}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              const d = e.target.value;
              setDayFilter(d);
              if (d && d.slice(0, 7) !== month) setMonth(d.slice(0, 7));
            }}
            title="Show one date only — clear to see the whole month"
          />
        )}
        {view === "daily" && dayFilter && (
          <button style={btn} onClick={() => setDayFilter("")}>All days</button>
        )}
        <a style={btnPrimary} href={`/api/wfm/summary/export?month=${month}`}>Export to Excel</a>
        {loading && <span style={{ fontSize: 12, color: c.hint }}>Loading…</span>}
      </div>

      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      {isMobile ? (
        <CollapsibleCharts>
          <Donut slices={dayMix} title="How the month went" centerLabel="days" />
          <Donut
            slices={attentionMix}
            title="Needs attention"
            centerLabel="employees"
            selected={attentionFilter}
            onSelect={setAttentionFilter}
          />
          <Donut slices={headcountMix} title="Headcount by site" centerLabel="employees" />
        </CollapsibleCharts>
      ) : (
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
      )}

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
          {paginate(filtered, clampPage(dailyPage, filtered.length, DEFAULT_PAGE_SIZE), DEFAULT_PAGE_SIZE).map((emp) => (
            <DailyEmployee key={emp.employee_id} emp={emp} deductBreaks={deductBreaks} dayFilter={dayFilter || undefined} />
          ))}
          {filtered.length === 0 && <div style={{ ...cardStyle, color: c.hint, fontSize: 12.5 }}>No employees.</div>}
          <Pager page={clampPage(dailyPage, filtered.length, DEFAULT_PAGE_SIZE)} total={filtered.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setDailyPage} />
        </>
      )}
    </>
  );
}
