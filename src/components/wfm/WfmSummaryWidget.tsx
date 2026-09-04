"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * Attendance summary on the dashboard, for a supervisor.
 *
 * The figures and the Excel file already existed on /wfm/summary; what was
 * missing was seeing them without going and looking. Both views come from
 * ONE fetch of /api/wfm/summary -- the month payload already carries each
 * employee's `days`, so the daily view is a projection of it rather than a
 * second round trip, and switching Today/Month costs nothing.
 *
 * That route is supervisor-gated and scope-aware (resolveWfmScope), so a
 * site supervisor sees their own subtree here exactly as they do on the
 * full page. The export button hands off to the existing endpoint, which
 * applies the same scoping -- nobody exports more than they can read.
 *
 * Collapsed by default: it is a reference, not the reason the dashboard
 * exists, and on a phone an expanded table would bury everything else.
 */

type DayRecord = {
  date: string;
  first_in: string | null;
  last_out: string | null;
  net_minutes: number;
  gross_minutes: number;
  break_minutes: number;
  late: boolean;
  absent: boolean;
  incomplete: boolean;
  on_leave: { name: string } | null;
  holiday: string | null;
};

type Summary = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  site_name: string | null;
  days: DayRecord[];
  totals: {
    days_present: number; absent_days: number; working_minutes: number;
    late_marks: number; ot_minutes: number; ot_amount: number;
    paid_leave_days: number; unpaid_leave_days: number; incomplete_days: number;
  };
};

type DayStatus = "leave" | "holiday" | "absent" | "incomplete" | "late" | "present" | "none";

/** One place decides a day's status, so the Status column and the status
 *  filter can never disagree about what a row is. Order matters: leave and
 *  holiday outrank absence, and "Present" needs a punch behind it (an
 *  employee with no shift is never marked absent, so without that check a
 *  no-punch day read as green Present). */
function dayStatusOf(d: DayRecord): DayStatus {
  if (d.on_leave) return "leave";
  if (d.holiday) return "holiday";
  if (d.absent) return "absent";
  if (d.incomplete) return "incomplete";
  if (d.late) return "late";
  return d.first_in ? "present" : "none";
}

const STATUS_LABEL: Record<DayStatus, string> = {
  leave: "On leave", holiday: "Holiday", absent: "Absent",
  incomplete: "Incomplete", late: "Late", present: "Present", none: "No punch",
};

const OPEN_KEY = "bpm_wfm_summary_widget_open";
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function WfmSummaryWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"day" | "month">("day");
  const [month, setMonth] = useState(thisMonth());
  // The daily view is any date, not just today -- the month payload already
  // carries every employee's days, so picking a date inside the loaded month
  // is a free client-side projection; another month triggers one fetch.
  const [day, setDay] = useState(today());
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The summary route is supervisor-only. Somebody without that role has no
  // business seeing an error card about it on their dashboard -- the widget
  // just isn't for them, so it removes itself.
  const [forbidden, setForbidden] = useState(false);
  const [page, setPage] = useState(1);
  // Filters. Applied client-side on the payload already loaded -- the month
  // fetch carries every employee's days, so narrowing costs no round trip.
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<DayStatus | "">("");
  // Name sort. localeCompare rather than <, so "Aliya" and "aliya" sort
  // together and accented names land where a reader expects them.
  const [nameSort, setNameSort] = useState<"asc" | "desc">("asc");
  const isMobile = useIsMobile();

  useEffect(() => {
    try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { /* private mode */ }
  }, []);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wfm/summary?month=${m}`);
      const json = await res.json();
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) { setError(json.error ?? "Could not load the summary"); return; }
      setRows(json.employees ?? []);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetched only once opened -- a collapsed widget shouldn't cost a query on
  // every dashboard load.
  useEffect(() => { if (open && rows === null) void load(month); }, [open, rows, month, load]);

  function toggle() {
    setOpen((v) => {
      try { localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  }

  function changeMonth(m: string) {
    setMonth(m);
    setRows(null);
    setPage(1);
    void load(m);
  }

  function changeDay(d: string) {
    if (!d) return;
    setDay(d);
    const m = d.slice(0, 7);
    if (m !== month) changeMonth(m);
  }

  const sites = [...new Set((rows ?? []).map((r) => r.site_name).filter(Boolean))] as string[];

  const matchesEmployee = (r: Summary) => {
    if (siteFilter && r.site_name !== siteFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return r.full_name.toLowerCase().includes(q) || (r.employee_code ?? "").toLowerCase().includes(q);
  };

  const byName = (a: string, b: string) =>
    nameSort === "asc" ? a.localeCompare(b) : b.localeCompare(a);

  const dayRows = (rows ?? [])
    .filter(matchesEmployee)
    .map((r) => ({ emp: r, day: r.days.find((d) => d.date === day) }))
    .filter((x): x is { emp: Summary; day: DayRecord } => !!x.day)
    .filter((x) => !statusFilter || dayStatusOf(x.day) === statusFilter)
    .sort((a, b) => byName(a.emp.full_name, b.emp.full_name));

  const monthRows = (rows ?? [])
    .filter(matchesEmployee)
    .slice()
    .sort((a, b) => byName(a.full_name, b.full_name));

  // Which statuses actually occur on this day — a filter offering options
  // that match nothing is just a way to show someone an empty table.
  const presentStatuses = [...new Set(
    (rows ?? [])
      .filter(matchesEmployee)
      .map((r) => r.days.find((d) => d.date === day))
      .filter((d): d is DayRecord => !!d)
      .map(dayStatusOf)
  )];

  const filtersOn = !!(query.trim() || siteFilter || statusFilter);

  const monthTotals = monthRows.reduce(
    (t, r) => ({
      present: t.present + r.totals.days_present,
      minutes: t.minutes + r.totals.working_minutes,
      ot: t.ot + r.totals.ot_minutes,
      late: t.late + r.totals.late_marks,
    }),
    { present: 0, minutes: 0, ot: 0, late: 0 }
  );
  // "Present" requires an actual check-in. Without this, an employee with no
  // shift assigned (whom the summary never marks absent -- lateness/absence
  // are judged against a shift) and zero punches counted as present.
  const dayPresent = dayRows.filter((d) => d.day.first_in && !d.day.on_leave).length;
  const listTotal = view === "day" ? dayRows.length : monthRows.length;
  const cPage = clampPage(page, listTotal, DEFAULT_PAGE_SIZE);
  const pageDayRows = paginate(dayRows, cPage, DEFAULT_PAGE_SIZE);
  const pageMonthRows = paginate(monthRows, cPage, DEFAULT_PAGE_SIZE);
  const dayMinutes = dayRows.reduce((t, d) => t + d.day.net_minutes, 0);

  const th: React.CSSProperties = {
    textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em",
    textTransform: "uppercase", color: c.hint, padding: "6px 8px", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { fontSize: 12, color: c.ink, padding: "7px 8px", whiteSpace: "nowrap" };

  if (forbidden) return null;

  return (
    <section style={cardStyle}>
      <button
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 0,
          background: "none", border: "none", cursor: "pointer", font: "inherit", textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: c.ink }}>Attendance summary</span>
          {!isMobile && (
            <span style={{ display: "block", fontSize: 11.5, color: c.muted, marginTop: 2 }}>
              Any day or month, for everyone you supervise
            </span>
          )}
        </span>
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"
          style={{ flexShrink: 0, transition: "transform .2s", transform: open ? "rotate(180deg)" : undefined }}>
          <path d="M4 6.5 8 10.5l4-4" fill="none" stroke={c.muted} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, border: `1px solid ${c.line}` }}>
              {([["Day", "day"], ["Month", "month"]] as const).map(([label, v]) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setPage(1); }}
                  style={{
                    padding: "6px 13px", borderRadius: 6, cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 650, border: "none",
                    background: view === v ? c.accent : "transparent",
                    color: view === v ? "#fff" : c.muted,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "day" ? (
              <input
                type="date"
                value={day}
                max={today()}
                onChange={(e) => changeDay(e.target.value)}
                style={{
                  padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`,
                  background: c.panel, color: c.ink, fontSize: 12.5, font: "inherit",
                }}
              />
            ) : (
              <input
                type="month"
                value={month}
                onChange={(e) => changeMonth(e.target.value)}
                style={{
                  padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`,
                  background: c.panel, color: c.ink, fontSize: 12.5, font: "inherit",
                }}
              />
            )}

            <a
              href={`/api/wfm/summary/export?month=${month}`}
              style={{
                marginLeft: "auto", padding: "7px 13px", borderRadius: 8, textDecoration: "none",
                fontSize: 12.5, fontWeight: 650, color: c.ink, border: `1px solid ${c.line}`, whiteSpace: "nowrap",
              }}
            >
              {isMobile ? "↓ Excel" : "↓ Export to Excel"}
            </a>
          </div>

          {/* Filters. Deliberately below the view/date row rather than beside
              it: on a phone the first row already wraps, and burying the date
              picker behind a search box would be the wrong trade. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search name or code…"
              style={{
                padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`,
                background: c.panel, color: c.ink, fontSize: 12.5, font: "inherit",
                minWidth: 0, flex: isMobile ? "1 1 100%" : "0 1 190px",
              }}
            />

            {sites.length > 1 && (
              <select
                value={siteFilter}
                onChange={(e) => { setSiteFilter(e.target.value); setPage(1); }}
                style={{
                  padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`,
                  background: c.panel, color: c.ink, fontSize: 12.5, font: "inherit",
                }}
              >
                <option value="">All sites</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            {/* Status describes a single day, so it only exists in the day
                view -- a month has many statuses at once. */}
            {view === "day" && presentStatuses.length > 1 && (
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as DayStatus | ""); setPage(1); }}
                style={{
                  padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`,
                  background: c.panel, color: c.ink, fontSize: 12.5, font: "inherit",
                }}
              >
                <option value="">All statuses</option>
                {(Object.keys(STATUS_LABEL) as DayStatus[])
                  .filter((s) => presentStatuses.includes(s))
                  .map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            )}

            {filtersOn && (
              <button
                onClick={() => { setQuery(""); setSiteFilter(""); setStatusFilter(""); setPage(1); }}
                style={{
                  padding: "7px 11px", borderRadius: 8, cursor: "pointer", font: "inherit",
                  fontSize: 12.5, fontWeight: 650, color: c.muted,
                  background: "transparent", border: `1px solid ${c.line}`,
                }}
              >
                Clear
              </button>
            )}

            {filtersOn && (
              <span style={{ fontSize: 11.5, color: c.hint }}>
                {listTotal} of {view === "day"
                  ? (rows ?? []).filter((r) => r.days.some((d) => d.date === day)).length
                  : (rows ?? []).length} shown
              </span>
            )}
          </div>

          {loading && <p style={{ fontSize: 12.5, color: c.muted, margin: 0 }}>Loading…</p>}
          {error && <p style={{ fontSize: 12.5, color: "#e5484d", margin: 0 }}>{error}</p>}

          {!loading && !error && rows && (
            <>
              {(() => {
                const stats: [string, string][] = view === "day"
                  ? [["Present", String(dayPresent)], ["Hours", hm(dayMinutes)], ["Records", String(dayRows.length)]]
                  : [["Days present", String(monthTotals.present)], ["Hours", hm(monthTotals.minutes)], ["Overtime", hm(monthTotals.ot)], ["Late marks", String(monthTotals.late)]];
                // Phone: one quiet inline line instead of a stat-tile row --
                // the header block was pushing the actual table below the fold.
                return isMobile ? (
                  <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>
                    {stats.map(([label, value], i) => (
                      <span key={label}>
                        {i > 0 && <span style={{ opacity: 0.5 }}> · </span>}
                        {label} <strong style={{ color: c.ink }}>{value}</strong>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
                    {stats.map(([label, value]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: c.hint }}>{label}</div>
                        <div style={{ fontSize: 17, fontWeight: 750, color: c.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                      <th style={th}>
                        <button
                          onClick={() => { setNameSort((d) => (d === "asc" ? "desc" : "asc")); setPage(1); }}
                          title={nameSort === "asc" ? "Sorted A–Z — click for Z–A" : "Sorted Z–A — click for A–Z"}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4, padding: 0,
                            background: "none", border: "none", cursor: "pointer",
                            font: "inherit", color: "inherit", letterSpacing: "inherit",
                            textTransform: "inherit",
                          }}
                        >
                          Employee
                          <span aria-hidden style={{ fontSize: 9, color: c.muted }}>
                            {nameSort === "asc" ? "▲" : "▼"}
                          </span>
                        </button>
                      </th>
                      {view === "day" ? (
                        <>
                          <th style={th}>In</th><th style={th}>Out</th><th style={th}>Breaks</th><th style={th}>Hours</th><th style={th}>Status</th>
                        </>
                      ) : (
                        <>
                          <th style={th}>Present</th><th style={th}>Hours</th><th style={th}>OT</th><th style={th}>Late</th><th style={th}>Leave</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {view === "day" && dayRows.length === 0 && (
                      <tr><td style={{ ...td, color: c.hint }} colSpan={6}>
                        {filtersOn ? "Nobody matches these filters on this day." : "Nothing recorded on this day."}
                      </td></tr>
                    )}
                    {view === "day" && pageDayRows.map(({ emp, day }) => (
                      <tr key={emp.employee_id} style={{ borderBottom: `1px solid ${c.line}` }}>
                        <td style={td}>{emp.full_name}{emp.site_name ? <span style={{ color: c.hint }}> · {emp.site_name}</span> : null}</td>
                        <td style={td}>{fmtTime(day.first_in)}</td>
                        <td style={td}>{fmtTime(day.last_out)}</td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: c.muted }}>{day.break_minutes > 0 ? hm(day.break_minutes) : "—"}</td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{day.net_minutes > 0 ? hm(day.net_minutes) : "—"}</td>
                        <td style={td}>
                          {(() => {
                            // Rendered from the same helper the filter uses, so
                            // filtering by "Late" can never return a row whose
                            // Status column reads something else.
                            const s = dayStatusOf(day);
                            const tone = s === "absent" ? "#e5484d"
                              : s === "late" || s === "incomplete" ? "#d97706"
                              : s === "present" ? "#12a150"
                              : s === "none" ? c.hint : c.muted;
                            const label = s === "leave" ? day.on_leave!.name
                              : s === "holiday" ? day.holiday!
                              : STATUS_LABEL[s];
                            return <span style={{ color: tone }}>{label}</span>;
                          })()}
                        </td>
                      </tr>
                    ))}

                    {view === "month" && (monthRows.length === 0
                      ? <tr><td style={{ ...td, color: c.hint }} colSpan={6}>
                          {filtersOn ? "Nobody matches these filters." : "No employees in this month."}
                        </td></tr>
                      : pageMonthRows.map((r) => (
                        <tr key={r.employee_id} style={{ borderBottom: `1px solid ${c.line}` }}>
                          <td style={td}>{r.full_name}{r.site_name ? <span style={{ color: c.hint }}> · {r.site_name}</span> : null}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.totals.days_present}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{hm(r.totals.working_minutes)}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.totals.ot_minutes > 0 ? hm(r.totals.ot_minutes) : "—"}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.totals.late_marks > 0 ? "#d97706" : c.ink }}>{r.totals.late_marks}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.totals.paid_leave_days + r.totals.unpaid_leave_days || "—"}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
                <Pager page={cPage} total={listTotal} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
