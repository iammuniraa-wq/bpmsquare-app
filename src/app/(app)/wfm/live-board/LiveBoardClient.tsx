"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import Donut from "@/components/Donut";
import PunchAudit from "@/components/wfm/PunchAudit";
import { ROUTES } from "@/lib/constants";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";

const POLL_MS = 30_000;

// One bucket per employee, mutually exclusive so the donut's slices sum to
// headcount -- "late" and "outside geofence" are flags on top of a state,
// not states of their own, so they stay as separate stat cards.
type Bucket = "In" | "On break" | "On leave" | "Absent" | "Checked out" | "Not in yet";

function bucketOf(r: Row): Bucket {
  if (r.on_leave) return "On leave";
  if (r.state === "in") return "In";
  if (r.state === "break") return "On break";
  if (r.absent) return "Absent";
  if (r.punches > 0) return "Checked out";
  return "Not in yet";
}

const BUCKET_COLOR: Record<Bucket, string> = {
  "In": pillar.green.base,
  "On break": pillar.amber.base,
  "On leave": pillar.purple.base,
  "Absent": pillar.red.base,
  "Checked out": pillar.blue.base,
  "Not in yet": pillar.teal.base,
};

type Row = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: "full_time" | "contractor";
  home_site_id: string | null;
  home_site_name: string | null;
  shift_name: string | null;
  state: "out" | "in" | "break";
  first_in: string | null;
  last_out: string | null;
  late: boolean;
  absent: boolean;
  on_leave: boolean;
  outside_geofence: boolean;
  punches: number;
};

export type Board = {
  date: string;
  timezone: string;
  is_week_off: boolean;
  is_holiday: boolean;
  rows: Row[];
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle",
};

const fmtTime = (s: string | null, tz: string) =>
  s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";

function statusPill(r: Row) {
  if (r.on_leave) return <Pill label="On leave" tone="purple" />;
  if (r.state === "in") return <Pill label="In" tone="green" />;
  if (r.state === "break") return <Pill label="On break" tone="amber" />;
  if (r.absent) return <Pill label="Absent" tone="red" />;
  if (r.punches > 0) return <Pill label="Out" tone="blue" />;
  return <Pill label="Not in yet" tone="teal" />;
}

const inp: React.CSSProperties = {
  padding: "8px 11px", fontSize: 12.5, border: `1px solid ${c.line}`,
  borderRadius: 8, background: c.panel, color: c.ink, outline: "none",
};

export default function LiveBoardClient({ initialBoard = null, initialLanding = null }: {
  initialBoard?: Board | null;
  initialLanding?: "live_board" | "dashboard" | null;
}) {
  const [board, setBoard] = useState<Board | null>(initialBoard);
  const serverSeeded = useRef(initialBoard != null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  // Page per site group -- state lives up here because the groups render
  // inside a map, where a hook per group isn't possible.
  const [sitePages, setSitePages] = useState<Record<string, number>>({});
  // Which employee's punch audit (selfie + location) is expanded.
  const [auditFor, setAuditFor] = useState<string | null>(null);
  // Recheck-request composer -- set when a supervisor clicks "Flag for recheck".
  const [flagging, setFlagging] = useState<{ employeeId: string; employeeName: string; eventId: string; date: string } | null>(null);
  const [flagType, setFlagType] = useState<"time" | "selfie" | "both">("both");
  const [flagMessage, setFlagMessage] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState("");
  const [flagSent, setFlagSent] = useState(false);

  // Default-landing preference -- only meaningful for a WFM-restricted
  // supervisor (see (app)/layout.tsx), but harmless to show/set from
  // anywhere else too. null = role default (Live Board).
  const [landing, setLanding] = useState<"live_board" | "dashboard" | null>(initialLanding);
  const [landingBusy, setLandingBusy] = useState(false);

  useEffect(() => {
    if (initialBoard) return; // server render already provided the preference
    fetch("/api/wfm/me/landing-preference")
      .then((r) => r.json())
      .then((json) => setLanding(json.landing ?? null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setDefaultLanding(value: "live_board" | "dashboard") {
    setLandingBusy(true);
    try {
      const res = await fetch("/api/wfm/me/landing-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landing: value === "live_board" ? null : value }),
      });
      if (res.ok) setLanding(value);
    } finally {
      setLandingBusy(false);
    }
  }

  async function submitFlag() {
    if (!flagging || !flagMessage.trim()) { setFlagError("A message is required"); return; }
    setFlagBusy(true);
    setFlagError("");
    try {
      const res = await fetch("/api/wfm/recheck-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: flagging.employeeId, target_date: flagging.date,
          target_event_id: flagging.eventId, recheck_type: flagType, message: flagMessage.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setFlagError(json.error ?? "Could not send"); return; }
      setFlagSent(true);
      setTimeout(() => { setFlagging(null); setFlagMessage(""); setFlagType("both"); setFlagSent(false); }, 1200);
    } catch {
      setFlagError("Network error");
    } finally {
      setFlagBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/live-board");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setBoard(json);
      setError("");
      setUpdatedAt(new Date());
    } catch {
      setError("Network error");
    }
  }, []);

  useEffect(() => {
    if (serverSeeded.current) {
      // First mount with a server-rendered board: skip the immediate
      // refetch, keep the polling interval for freshness.
      serverSeeded.current = false;
      setUpdatedAt(new Date());
    } else {
      load();
    }
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Board-wide aggregates -- memoised on `board` alone so a search keystroke
  // (which only touches `query`) no longer re-runs these ~12 full passes over
  // every employee, and the 30s poll recomputes them once, not per render.
  const rows = board?.rows;
  const counts = useMemo(() => ({
    in: (rows ?? []).filter((r) => r.state === "in").length,
    onBreak: (rows ?? []).filter((r) => r.state === "break").length,
    late: (rows ?? []).filter((r) => r.late).length,
    absent: (rows ?? []).filter((r) => r.absent).length,
    leave: (rows ?? []).filter((r) => r.on_leave).length,
    flagged: (rows ?? []).filter((r) => r.outside_geofence).length,
  }), [rows]);

  // Donut always reflects the whole board, not the filtered subset -- it's
  // the overview the filters act on, so filtering it too would leave a
  // single 100% slice and nothing to click back to.
  const donutSlices = useMemo(() => (Object.keys(BUCKET_COLOR) as Bucket[]).map((b) => ({
    label: b,
    value: (rows ?? []).filter((r) => bucketOf(r) === b).length,
    color: BUCKET_COLOR[b],
  })), [rows]);

  const sites = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.home_site_name ?? "No site assigned"))].sort(),
    [rows]
  );

  // The filtered subset + its site grouping -- keyed on the filters so it
  // recomputes only when a filter actually changes, not on every render.
  const orderedGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (rows ?? []).filter((r) => {
      if (statusFilter && bucketOf(r) !== statusFilter) return false;
      if (siteFilter && (r.home_site_name ?? "No site assigned") !== siteFilter) return false;
      if (flaggedOnly && !r.outside_geofence) return false;
      if (lateOnly && !r.late) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.employee_code ?? "").toLowerCase().includes(q) ||
        (r.shift_name ?? "").toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, Row[]>();
    for (const r of visible) {
      const key = r.home_site_name ?? "No site assigned";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) =>
      a === "No site assigned" ? 1 : b === "No site assigned" ? -1 : a.localeCompare(b)
    );
    return { visibleCount: visible.length, ordered };
  }, [rows, query, statusFilter, siteFilter, flaggedOnly, lateOnly]);

  if (error) {
    return <div style={{ ...cardStyle, color: c.muted, fontSize: 13 }}>{error}</div>;
  }
  if (!board) {
    return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading today&apos;s board…</div>;
  }

  // Every stat card is a live filter -- clicking "Late" shows exactly those
  // people, which is the action a supervisor wants the instant they see a
  // non-zero count. `onClick` omitted => the tile still lifts on hover but
  // isn't styled or cursored as clickable.
  const stat = (label: string, value: number, color?: string, onClick?: () => void, active?: boolean) => (
    <div
      key={label}
      onClick={onClick}
      className={`stat-tile${onClick ? " is-clickable" : ""}${active ? " is-active" : ""}`}
      style={{ ...cardStyle, padding: "10px 16px", minWidth: 100 }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? c.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: c.muted }}>{label}</div>
    </div>
  );
  const toggleStatus = (b: Bucket) => () => setStatusFilter((cur) => (cur === b ? null : b));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12, color: c.hint }}>
        <span>On login, show me:</span>
        <select
          style={{ ...inp, width: "auto", padding: "5px 9px", fontSize: 12 }}
          value={landing ?? "live_board"}
          disabled={landingBusy}
          onChange={(e) => setDefaultLanding(e.target.value as "live_board" | "dashboard")}
        >
          <option value="live_board">Live board</option>
          <option value="dashboard">Dashboard</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, alignItems: "stretch" }}>
        <section style={{ ...cardStyle, flex: "1 1 320px" }}>
          <Donut
            slices={donutSlices}
            title="Right now"
            centerLabel="employees"
            selected={statusFilter}
            onSelect={setStatusFilter}
          />
        </section>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: "1 1 320px", alignContent: "flex-start" }}>
          {stat("Checked in", counts.in, statusInk.good, toggleStatus("In"), statusFilter === "In")}
          {stat("On break", counts.onBreak, statusInk.warn, toggleStatus("On break"), statusFilter === "On break")}
          {/* Late isn't a bucket (it's a flag on top of one), so it drives
              its own filter rather than statusFilter. */}
          {stat("Late", counts.late, statusInk.bad, () => { setStatusFilter(null); setLateOnly((v) => !v); setFlaggedOnly(false); }, lateOnly)}
          {stat("Absent", counts.absent, statusInk.bad, toggleStatus("Absent"), statusFilter === "Absent")}
          {stat("On leave", counts.leave, undefined, toggleStatus("On leave"), statusFilter === "On leave")}
          {stat("Geofence flags", counts.flagged, counts.flagged ? statusInk.warn : undefined, () => { setFlaggedOnly((v) => !v); setLateOnly(false); }, flaggedOnly)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          style={{ ...inp, flex: "1 1 220px", maxWidth: 320 }}
          placeholder="Search name, code or shift…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={inp} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={inp} value={statusFilter ?? ""} onChange={(e) => setStatusFilter(e.target.value || null)}>
          <option value="">All statuses</option>
          {(Object.keys(BUCKET_COLOR) as Bucket[]).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          Geofence flags only
        </label>
        <span style={{ fontSize: 11.5, color: c.hint }}>{orderedGroups.visibleCount} of {board.rows.length}</span>
      </div>

      {(board.is_holiday || board.is_week_off) && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: c.muted }}>
          {board.is_holiday ? "Today is a holiday — " : "Today is a weekly off — "}
          no lateness or absence is being marked.
        </div>
      )}

      {orderedGroups.visibleCount === 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: c.hint }}>
          No employees match these filters.
        </div>
      )}

      {orderedGroups.ordered.map(([siteName, rows]) => {
        const sitePage = clampPage(sitePages[siteName] ?? 1, rows.length, DEFAULT_PAGE_SIZE);
        const pageRows = paginate(rows, sitePage, DEFAULT_PAGE_SIZE);
        return (
        <section key={siteName} style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
            {siteName}
            <span style={{ color: c.hint, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              {rows.filter((r) => r.state !== "out").length} of {rows.length} present
            </span>
          </div>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                <th style={th}>Shift</th>
                <th style={th}>Status</th>
                <th style={th}>First in</th>
                <th style={th}>Last out</th>
                <th style={th}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <Fragment key={r.employee_id}>
                <tr
                  onClick={() => setAuditFor((cur) => (cur === r.employee_id ? null : r.employee_id))}
                  style={{ cursor: "pointer" }}
                  title="Show selfies and punch locations"
                >
                  <td style={td}>
                    <Link
                      href={ROUTES.wfmEmployee(r.employee_id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontWeight: 600, color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}
                    >
                      {r.full_name}
                    </Link>
                    {r.employee_code && (
                      <span style={{ color: c.hint, marginLeft: 6, fontSize: 11.5 }}>{r.employee_code}</span>
                    )}
                    {r.employment_type === "contractor" && (
                      <span style={{ marginLeft: 6 }}><Pill label="Contractor" tone="teal" /></span>
                    )}
                  </td>
                  <td style={td}>{r.shift_name ?? "—"}</td>
                  <td style={td}>{statusPill(r)}</td>
                  <td style={td}>
                    {fmtTime(r.first_in, board.timezone)}
                    {r.late && <span style={{ color: statusInk.bad, marginLeft: 6, fontSize: 11 }}>late</span>}
                  </td>
                  <td style={td}>{fmtTime(r.last_out, board.timezone)}</td>
                  <td style={td}>
                    {r.outside_geofence ? <Pill label="Outside geofence" tone="amber" /> : "—"}
                  </td>
                </tr>
                {auditFor === r.employee_id && (
                  <tr>
                    <td colSpan={6} style={{ ...td, background: "var(--panel2)" }}>
                      <PunchAudit
                        employeeId={r.employee_id}
                        date={board.date}
                        canFlag
                        onFlag={(event) => {
                          setFlagging({ employeeId: r.employee_id, employeeName: r.full_name, eventId: event.id, date: board.date });
                          setFlagType("both");
                          setFlagMessage("");
                          setFlagError("");
                          setFlagSent(false);
                        }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "0 12px 10px" }}>
            <Pager
              page={sitePage}
              total={rows.length}
              pageSize={DEFAULT_PAGE_SIZE}
              onPage={(n) => setSitePages((m) => ({ ...m, [siteName]: n }))}
            />
          </div>
        </section>
        );
      })}

      <div style={{ fontSize: 11.5, color: c.hint }}>
        {board.date} · {board.timezone}
        {updatedAt && <> · updated {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>}
        {" "}· refreshes every 30s
      </div>

      {flagging && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setFlagging(null)}
        >
          <div style={{ ...cardStyle, width: 420, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Flag for review</div>
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 14 }}>{flagging.employeeName} · {flagging.date}</div>
            {flagSent ? (
              <div style={{ fontSize: 13, color: statusInk.good, padding: "10px 0" }}>✓ Sent — {flagging.employeeName} will see this on their Me page.</div>
            ) : (
              <>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>What needs review?</label>
                <select
                  value={flagType}
                  onChange={(e) => setFlagType(e.target.value as typeof flagType)}
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, marginBottom: 12, boxSizing: "border-box" }}
                >
                  <option value="both">Time and selfie</option>
                  <option value="time">Time only</option>
                  <option value="selfie">Selfie only</option>
                </select>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Message to employee</label>
                <textarea
                  value={flagMessage}
                  onChange={(e) => setFlagMessage(e.target.value)}
                  rows={3}
                  placeholder="e.g. Your check-in selfie looks blurry, please confirm this was really you."
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, resize: "vertical", boxSizing: "border-box" }}
                />
                {flagError && <div style={{ fontSize: 12, color: statusInk.bad, marginTop: 8 }}>{flagError}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={submitFlag}
                    disabled={flagBusy}
                    style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer" }}
                  >
                    {flagBusy ? "Sending…" : "Send"}
                  </button>
                  <button
                    onClick={() => setFlagging(null)}
                    style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
