"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { WfmShift, WfmSite } from "@/lib/wfm/types";
import { depthOf } from "@/lib/wfm/projectTree";
import { groupSpans, type Span } from "@/lib/wfm/rosterSpans";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  shift_id: string | null;
  site_id: string | null;
  status: string;
};

type OverrideRow = {
  id: string;
  employee_id: string;
  date: string;
  is_day_off: boolean;
  shift_id?: string | null;
  /** Only present when the tenant has project costing (0104). The API route
   *  flattens the name into project_name; the server prefetch returns the
   *  raw embed instead, so both shapes have to be readable here. */
  project_id?: string | null;
  project_name?: string | null;
  wfm_projects?: { name: string } | { name: string }[] | null;
  note: string | null;
  wfm_shifts: { name: string; start_time: string; end_time: string } | { name: string; start_time: string; end_time: string }[] | null;
  employees: { first_name: string; last_name: string; employee_code: string | null } | { first_name: string; last_name: string; employee_code: string | null }[] | null;
};

// Supabase's untyped client sometimes infers a *-to-one relation as an
// array -- normalize either shape to a single object or null.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const UPCOMING_DAYS = 30;
const UNASSIGNED = "__unassigned__";

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const thCenter: React.CSSProperties = { ...th, textAlign: "center" };
const thGroup: React.CSSProperties = { ...thCenter, borderBottom: "none", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: c.hint, paddingBottom: 4 };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const tdCenter: React.CSSProperties = { ...td, textAlign: "center" };
const btn: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const btnTiny: React.CSSProperties = { ...btn, padding: "3px 8px", fontSize: 10.5, fontWeight: 600 };
const hhmm = (t: string) => t.slice(0, 5);
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
const todayKey = () => new Date().toISOString().slice(0, 10);

/** The API route and the server prefetch return the project differently --
 *  read whichever is present so the column is populated either way. */
function projectNameOf(r: OverrideRow): string | null {
  return r.project_name ?? one(r.wfm_projects)?.name ?? null;
}

function empName(e: { first_name: string; last_name: string } | null): string {
  return e ? [e.first_name, e.last_name].filter(Boolean).join(" ") : "—";
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// One matrix row, memoised. The Section A matrix is employees ×
// (sites + shifts + 2) checkbox cells; before this, a single tick re-rendered
// EVERY row's cells because the whole `.map` re-ran with the parent. Memoised
// on primitive props (effSh/effSt/changed) + stable callbacks, only the one
// employee whose effective assignment actually changed re-renders now.
type MatrixRowProps = {
  e: EmployeeRow;
  effSh: string | null;
  effSt: string | null;
  changed: boolean;
  activeSites: WfmSite[];
  activeShifts: WfmShift[];
  onSetSite: (employeeId: string, siteId: string | null) => void;
  onSetShift: (employeeId: string, shiftId: string | null) => void;
};

const MatrixRow = memo(function MatrixRow({
  e, effSh, effSt, changed, activeSites, activeShifts, onSetSite, onSetShift,
}: MatrixRowProps) {
  return (
    <tr style={changed ? { background: "rgba(55, 138, 221, 0.08)" } : undefined}>
      <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>
        <Link href={ROUTES.wfmEmployee(e.id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>{empName(e)}</Link>
        {e.employee_code && <span style={{ color: c.hint, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{e.employee_code}</span>}
      </td>
      {activeSites.map((s) => (
        <td key={s.id} style={tdCenter}>
          <input type="checkbox" checked={effSt === s.id} onChange={() => onSetSite(e.id, s.id)} style={{ cursor: "pointer" }} />
        </td>
      ))}
      {activeSites.length > 0 && (
        <td style={tdCenter}>
          <input type="checkbox" checked={effSt === null} onChange={() => onSetSite(e.id, null)} style={{ cursor: "pointer" }} />
        </td>
      )}
      {activeShifts.map((s, i) => (
        <td key={s.id} style={i === 0 && activeSites.length > 0 ? { ...tdCenter, borderLeft: `1px solid ${c.line}` } : tdCenter}>
          <input type="checkbox" checked={effSh === s.id} onChange={() => onSetShift(e.id, s.id)} style={{ cursor: "pointer" }} />
        </td>
      ))}
      {activeShifts.length > 0 && (
        <td style={tdCenter}>
          <input type="checkbox" checked={effSh === null} onChange={() => onSetShift(e.id, null)} style={{ cursor: "pointer" }} />
        </td>
      )}
    </tr>
  );
});

/**
 * Pick employees for a dated assignment: search, filter by site, tick.
 * Shared by the shift-change and project sections so the two behave the
 * same -- before the split, the one form held both, and putting someone on
 * a project meant walking through a section named for shift changes.
 */
function EmployeePicker({ employees, sites, shifts, selected, onChange }: {
  employees: EmployeeRow[];
  sites: WfmSite[];
  shifts: WfmShift[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const [site, setSite] = useState("");
  const [shift, setShift] = useState("");
  const needle = q.trim().toLowerCase();
  // Site AND shift, because "everyone on the second shift at Hosapete" is
  // exactly the group a supervisor moves in one go.
  const visible = employees.filter((e) =>
    e.status === "active" &&
    (!needle || empName(e).toLowerCase().includes(needle) || (e.employee_code ?? "").toLowerCase().includes(needle)) &&
    (!site || (site === UNASSIGNED ? e.site_id === null : e.site_id === site)) &&
    (!shift || (shift === UNASSIGNED ? e.shift_id === null : e.shift_id === shift))
  );
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  const selectAll = () => {
    const next = new Set(selected);
    for (const e of visible) next.add(e.id);
    onChange(next);
  };
  return (
    <>
      <label style={lbl}>Employees ({selected.size} selected)</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inp, width: 220 }} placeholder="Search employee name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...inp, width: 180 }} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value={UNASSIGNED}>Unassigned site</option>
        </select>
        <select style={{ ...inp, width: 180 }} value={shift} onChange={(e) => setShift(e.target.value)}>
          <option value="">All shifts</option>
          {shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value={UNASSIGNED}>No standing shift</option>
        </select>
        <button style={btnTiny} onClick={selectAll}>Select all{needle || site || shift ? " filtered" : ""}</button>
        <button style={btnTiny} onClick={() => onChange(new Set())}>Clear selection</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflowY: "auto", padding: 8, border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 12 }}>
        {visible.map((e) => (
          <label
            key={e.id}
            style={{
              display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "4px 8px",
              borderRadius: 6, cursor: "pointer",
              background: selected.has(e.id) ? "var(--tenant-accent, #378ADD)" : c.panel,
              color: selected.has(e.id) ? "#fff" : c.ink,
              border: `1px solid ${selected.has(e.id) ? "transparent" : c.line}`,
            }}
          >
            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} style={{ cursor: "pointer" }} />
            {empName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}
          </label>
        ))}
        {visible.length === 0 && <span style={{ fontSize: 12, color: c.hint }}>No employees match.</span>}
      </div>
    </>
  );
}

export default function RosterClient({ initial = null }: {
  initial?: { employees: EmployeeRow[]; shifts: WfmShift[]; sites: WfmSite[]; overrides: OverrideRow[] } | null;
}) {
  const [employees, setEmployees] = useState<EmployeeRow[]>(initial?.employees ?? []);
  const [shifts, setShifts] = useState<WfmShift[]>(initial?.shifts ?? []);
  const [sites, setSites] = useState<WfmSite[]>(initial?.sites ?? []);
  const [overrides, setOverrides] = useState<OverrideRow[]>(initial?.overrides ?? []);
  const [loading, setLoading] = useState(initial == null);
  const serverSeeded = useRef(initial != null);
  const [error, setError] = useState("");

  // ── Section A: standing site + shift (bulk matrix) ────────────────────
  const [searchA, setSearchA] = useState("");
  const [siteFilterA, setSiteFilterA] = useState("");
  const [pendingShift, setPendingShift] = useState<Map<string, string | null>>(new Map());
  const [pendingSite, setPendingSite] = useState<Map<string, string | null>>(new Map());
  const [savingA, setSavingA] = useState(false);
  const [okA, setOkA] = useState("");

  // ── Section B: shift changes and days off ────────────────────────────
  const [selectedB, setSelectedB] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState(todayKey());
  const [toDate, setToDate] = useState(todayKey());
  const [overrideShiftId, setOverrideShiftId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string; ref: string | null; parent_id: string | null }[]>([]);
  // Whether the tenant HAS project costing, which is a different question from
  // whether they have created any projects yet. The endpoint 404s when the
  // module is off, so an ok response is the signal. Keeping these apart is
  // what stops "no projects yet" from looking identical to "feature missing".
  const [projectsOn, setProjectsOn] = useState(false);
  const [overrideDayOff, setOverrideDayOff] = useState(false);
  const [busyB, setBusyB] = useState(false);
  const [errorB, setErrorB] = useState("");
  const [okB, setOkB] = useState("");

  // ── Section C: project assignments (owner 2026-09-06) ────────────────
  // Its own section, not a field inside the shift form: assigning a project
  // shares the shift form's mechanics (dates, people) but nothing of its
  // meaning, and the one control that mattered was labelled "site default".
  const [selectedC, setSelectedC] = useState<Set<string>>(new Set());
  const [fromC, setFromC] = useState(todayKey());
  const [toC, setToC] = useState(todayKey());
  const [projectC, setProjectC] = useState("");
  const [busyC, setBusyC] = useState(false);
  const [errorC, setErrorC] = useState("");
  const [okC, setOkC] = useState("");

  const load = useCallback(async () => {
    const from = todayKey();
    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + UPCOMING_DAYS);
    const rangeEndKey = rangeEnd.toISOString().slice(0, 10);

    const [empRes, shiftRes, siteRes, ovRes] = await Promise.all([
      fetch("/api/wfm/employees"),
      fetch("/api/wfm/shifts"),
      fetch("/api/wfm/sites"),
      fetch(`/api/wfm/roster?from=${from}&to=${rangeEndKey}`),
    ]);
    if (empRes.ok) setEmployees(await empRes.json()); else setError((await empRes.json()).error ?? "Failed to load employees");
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (siteRes.ok) setSites(await siteRes.json());
    if (ovRes.ok) setOverrides(await ovRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (serverSeeded.current) { serverSeeded.current = false; return; } // server-rendered bootstrap
    load();
  }, [load]);

  // Projects are fetched on their OWN effect, deliberately outside load().
  // The page server-prefetches the roster bootstrap, which makes the effect
  // above skip its first run -- so anything living inside load() never runs
  // on a normal page load at all. That is exactly how the Project control
  // came to be invisible on a tenant that had the module switched on
  // (reported 2026-09-04). Projects aren't part of the prefetched payload,
  // so they need a fetch that always happens.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/wfm/projects?status=active")
      .then(async (r) => {
        // 404 = the tenant doesn't have project costing. Anything else that
        // isn't ok is a real failure, and is left silent here rather than
        // pushing an error onto a screen whose main job is the roster.
        if (!r.ok) return;
        const json = await r.json();
        if (cancelled) return;
        setProjectsOn(true);
        setProjects(Array.isArray(json) ? json : []);
      })
      .catch(() => { /* roster still works without it */ });
    return () => { cancelled = true; };
  }, []);

  // ── Section A logic ───────────────────────────────────────────────────
  const activeShifts = useMemo(() => shifts.filter((s) => s.active), [shifts]);
  const activeSites = useMemo(() => sites.filter((s) => s.active), [sites]);

  function effectiveShift(e: EmployeeRow): string | null {
    return pendingShift.has(e.id) ? pendingShift.get(e.id)! : e.shift_id;
  }
  function effectiveSite(e: EmployeeRow): string | null {
    return pendingSite.has(e.id) ? pendingSite.get(e.id)! : e.site_id;
  }

  const qA = searchA.trim().toLowerCase();
  const visibleEmployeesA = useMemo(
    () => employees.filter((e) =>
      e.status === "active" &&
      (!qA || empName(e).toLowerCase().includes(qA) || (e.employee_code ?? "").toLowerCase().includes(qA)) &&
      (!siteFilterA || (siteFilterA === UNASSIGNED ? effectiveSite(e) === null : effectiveSite(e) === siteFilterA))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, qA, siteFilterA, pendingSite]
  );

  // useCallback so the memoised MatrixRow's callback props keep a stable
  // identity across renders -- otherwise every row would re-render on any tick.
  const setShiftCell = useCallback((employeeId: string, shiftId: string | null) => {
    setOkA("");
    setPendingShift((prev) => {
      const next = new Map(prev);
      const emp = employees.find((e) => e.id === employeeId);
      if (emp && emp.shift_id === shiftId) next.delete(employeeId);
      else next.set(employeeId, shiftId);
      return next;
    });
  }, [employees]);
  const setSiteCell = useCallback((employeeId: string, siteId: string | null) => {
    setOkA("");
    setPendingSite((prev) => {
      const next = new Map(prev);
      const emp = employees.find((e) => e.id === employeeId);
      if (emp && emp.site_id === siteId) next.delete(employeeId);
      else next.set(employeeId, siteId);
      return next;
    });
  }, [employees]);

  function assignAllVisibleShift(shiftId: string | null) {
    setOkA("");
    setPendingShift((prev) => {
      const next = new Map(prev);
      for (const e of visibleEmployeesA) {
        if (e.shift_id === shiftId) next.delete(e.id);
        else next.set(e.id, shiftId);
      }
      return next;
    });
  }
  function assignAllVisibleSite(siteId: string | null) {
    setOkA("");
    setPendingSite((prev) => {
      const next = new Map(prev);
      for (const e of visibleEmployeesA) {
        if (e.site_id === siteId) next.delete(e.id);
        else next.set(e.id, siteId);
      }
      return next;
    });
  }

  const pendingCount = pendingShift.size + pendingSite.size;

  async function saveAssignmentChanges() {
    if (pendingCount === 0) return;
    setSavingA(true);
    setError("");
    setOkA("");
    try {
      // Group each map by its target value so this is a handful of bulk
      // calls total, not one per employee.
      function groupBy(map: Map<string, string | null>): Map<string, string[]> {
        const groups = new Map<string, string[]>();
        for (const [employeeId, value] of map) {
          const key = value ?? "";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(employeeId);
        }
        return groups;
      }

      const shiftGroups = groupBy(pendingShift);
      const siteGroups = groupBy(pendingSite);

      const results = await Promise.all([
        ...[...shiftGroups.entries()].map(([key, ids]) =>
          fetch("/api/wfm/employees/bulk-shift", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_ids: ids, shift_id: key || null }),
          })
        ),
        ...[...siteGroups.entries()].map(([key, ids]) =>
          fetch("/api/wfm/employees/bulk-site", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_ids: ids, site_id: key || null }),
          })
        ),
      ]);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const json = await failed.json().catch(() => ({}));
        setError(json.error ?? "Some changes failed to save");
      } else {
        setOkA(`Saved ${pendingCount} change(s).`);
        setPendingShift(new Map());
        setPendingSite(new Map());
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSavingA(false);
    }
  }

  // ── Project options, indented by level so a sub-project reads as one ──
  const projectNodes = useMemo(
    () => new Map(projects.map((p) => [p.id, { id: p.id, parent_id: p.parent_id }])),
    [projects]
  );
  const projectOptions = useMemo(
    () => [...projects]
      .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }))
      .map((p) => ({ ...p, depth: depthOf(projectNodes, p.id) ?? 0 })),
    [projects, projectNodes]
  );
  const projectName = projects.find((p) => p.id === projectC)?.name ?? "";

  async function applyOverride() {
    setErrorB("");
    setOkB("");
    if (selectedB.size === 0) { setErrorB("Select at least one employee"); return; }
    if (!overrideDayOff && !overrideShiftId) { setErrorB("Choose a shift, or mark as day off"); return; }
    if (toDate < fromDate) { setErrorB("End date can't be before start date"); return; }
    const dates = dateRange(fromDate, toDate);
    if (dates.length > 62) { setErrorB("That date range is too long (max 62 days) — split it up"); return; }
    setBusyB(true);
    try {
      const res = await fetch("/api/wfm/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ids: [...selectedB],
          dates,
          shift_id: overrideDayOff ? null : overrideShiftId || null,
          is_day_off: overrideDayOff,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErrorB(json.error ?? "Failed to apply"); return; }
      setOkB(`Applied to ${selectedB.size} employee(s) across ${dates.length} date(s).`);
      setSelectedB(new Set());
      await load();
    } catch {
      setErrorB("Network error");
    } finally {
      setBusyB(false);
    }
  }

  // A project on its own is a valid roster row -- the standing shift still
  // applies (see makeShiftResolver); only where the hours go changes.
  async function applyProject() {
    setErrorC("");
    setOkC("");
    if (!projectC) { setErrorC("Choose a project"); return; }
    if (selectedC.size === 0) { setErrorC("Select at least one employee"); return; }
    if (toC < fromC) { setErrorC("End date can't be before start date"); return; }
    const dates = dateRange(fromC, toC);
    if (dates.length > 62) { setErrorC("That date range is too long (max 62 days) — split it up"); return; }
    setBusyC(true);
    try {
      const res = await fetch("/api/wfm/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_ids: [...selectedC], dates, project_id: projectC, is_day_off: false }),
      });
      const json = await res.json();
      if (!res.ok) { setErrorC(json.error ?? "Failed to assign"); return; }
      setOkC(`${selectedC.size} employee(s) on ${projectName} for ${dates.length} day(s).`);
      setSelectedC(new Set());
      await load();
    } catch {
      setErrorC("Network error");
    } finally {
      setBusyC(false);
    }
  }

  // One span, one call: a week on a project is seven rows underneath, and a
  // Remove that fired seven requests could half-succeed.
  async function removeSpan(span: Span<OverrideRow>) {
    setBusyB(true);
    setBusyC(true);
    try {
      await fetch("/api/wfm/roster", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: span.rows.map((r) => r.id) }),
      });
      await load();
    } finally {
      setBusyC(false);
      setBusyB(false);
    }
  }

  // One roster row can carry a shift AND a project; it then shows in both
  // lists, because it is honestly both things.
  const shiftSpans = groupSpans(overrides.filter((r) => r.is_day_off || one(r.wfm_shifts)));
  const projectSpans = groupSpans(overrides.filter((r) => !r.is_day_off && projectNameOf(r)));
  const fmtSpan = (sp: Span<OverrideRow>) =>
    sp.from === sp.to ? fmtDate(sp.from) : `${fmtDate(sp.from)} – ${fmtDate(sp.to)}`;

  if (loading) return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading roster…</div>;

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      {/* ── Section A: standing site + shift ──────────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, marginBottom: 22, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Standing site &amp; shift</div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
            Everyone&apos;s default site and shift. Tick a cell to change someone — this applies every day until
            changed again, or overridden for specific dates below. A column&apos;s &quot;Assign all&quot; sets a whole
            filtered group at once. Filter by site first to manage one location&apos;s team together.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              style={{ ...inp, width: 240 }}
              placeholder="Search employee name or code…"
              value={searchA}
              onChange={(e) => setSearchA(e.target.value)}
            />
            <select style={{ ...inp, width: 200 }} value={siteFilterA} onChange={(e) => setSiteFilterA(e.target.value)}>
              <option value="">All sites</option>
              {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={UNASSIGNED}>Unassigned site</option>
            </select>
          </div>
        </div>

        {activeShifts.length === 0 && activeSites.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>
            No active sites or shifts yet — set them up in Settings → Workforce → Sites / Shifts first.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...th, verticalAlign: "bottom" }}>Employee</th>
                {activeSites.length > 0 && <th colSpan={activeSites.length + 1} style={thGroup}>Site</th>}
                {activeShifts.length > 0 && <th colSpan={activeShifts.length + 1} style={{ ...thGroup, borderLeft: `1px solid ${c.line}` }}>Shift</th>}
              </tr>
              <tr>
                {activeSites.map((s) => (
                  <th key={s.id} style={thCenter}>
                    <div>{s.name}</div>
                    <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisibleSite(s.id)}>
                      Assign all{qA || siteFilterA ? " filtered" : ""}
                    </button>
                  </th>
                ))}
                {activeSites.length > 0 && (
                  <th style={thCenter}>
                    <div>Unassigned</div>
                    <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisibleSite(null)}>
                      Clear all{qA || siteFilterA ? " filtered" : ""}
                    </button>
                  </th>
                )}
                {activeShifts.map((s, i) => (
                  <th key={s.id} style={i === 0 ? { ...thCenter, borderLeft: `1px solid ${c.line}` } : thCenter}>
                    <div>{s.name}</div>
                    <div style={{ fontWeight: 400, color: c.hint, fontSize: 10.5 }}>{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                    <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisibleShift(s.id)}>
                      Assign all{qA || siteFilterA ? " filtered" : ""}
                    </button>
                  </th>
                ))}
                {activeShifts.length > 0 && (
                  <th style={activeSites.length === 0 ? thCenter : { ...thCenter, borderLeft: activeShifts.length === 0 ? `1px solid ${c.line}` : undefined }}>
                    <div>Unassigned</div>
                    <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisibleShift(null)}>
                      Clear all{qA || siteFilterA ? " filtered" : ""}
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleEmployeesA.map((e) => (
                <MatrixRow
                  key={e.id}
                  e={e}
                  effSh={effectiveShift(e)}
                  effSt={effectiveSite(e)}
                  changed={pendingShift.has(e.id) || pendingSite.has(e.id)}
                  activeSites={activeSites}
                  activeShifts={activeShifts}
                  onSetSite={setSiteCell}
                  onSetShift={setShiftCell}
                />
              ))}
              {visibleEmployeesA.length === 0 && (
                <tr><td style={{ ...td, color: c.hint }} colSpan={2 + activeSites.length + activeShifts.length}>No employees match.</td></tr>
              )}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderTop: `1px solid ${c.line}` }}>
          <button style={{ ...btnPrimary, opacity: pendingCount === 0 ? 0.5 : 1 }} disabled={pendingCount === 0 || savingA} onClick={saveAssignmentChanges}>
            {savingA ? "Saving…" : `Save changes${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
          </button>
          {okA && <span style={{ fontSize: 12, color: statusInk.good }}>{okA}</span>}
        </div>
      </section>

      {/* ── Section B: shift changes and days off ─────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, marginBottom: 22, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Shift changes &amp; days off</div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
            A different shift, or a day off, for selected employees on specific dates only — the standing
            site and shift above stay as they are. For a holiday that applies to everyone, use Settings →
            Workforce → Holidays instead.
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <div>
              <label style={lbl}>From</label>
              <input style={inp} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>To</label>
              <input style={inp} type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div style={{ minWidth: 200 }}>
              <label style={lbl}>Shift</label>
              <select
                style={{ ...inp, width: "100%" }}
                value={overrideShiftId}
                disabled={overrideDayOff}
                onChange={(e) => setOverrideShiftId(e.target.value)}
              >
                <option value="">— select —</option>
                {activeShifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({hhmm(s.start_time)}–{hhmm(s.end_time)})</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, paddingBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={overrideDayOff} onChange={(e) => setOverrideDayOff(e.target.checked)} />
              Mark as day off instead
            </label>
          </div>

          <EmployeePicker employees={employees} sites={activeSites} shifts={activeShifts} selected={selectedB} onChange={setSelectedB} />

          {errorB && <div style={{ fontSize: 12, color: statusInk.bad, marginBottom: 8 }}>{errorB}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={btnPrimary} disabled={busyB} onClick={applyOverride}>
              {busyB ? "Applying…" : `Apply to ${selectedB.size || "…"} selected`}
            </button>
            {okB && <span style={{ fontSize: 12, color: statusInk.good }}>{okB}</span>}
          </div>
        </div>

        <div style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: c.ink }}>
          Upcoming — next {UPCOMING_DAYS} days
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Dates</th><th style={th}>Employee</th><th style={th}>Shift</th>
              <th style={th}>Note</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {shiftSpans.map((sp) => {
              const r = sp.rows[0];
              const shift = one(r.wfm_shifts);
              const emp = one(r.employees);
              return (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {fmtSpan(sp)}
                    {sp.rows.length > 1 && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>{sp.rows.length} days</span>}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <Link href={ROUTES.wfmEmployee(r.employee_id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>{empName(emp)}</Link>
                    {emp?.employee_code && <span style={{ color: c.hint, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{emp.employee_code}</span>}
                  </td>
                  <td style={td}>
                    {r.is_day_off
                      ? <Pill label="Day off" tone="red" />
                      : shift ? `${shift.name} (${hhmm(shift.start_time)}–${hhmm(shift.end_time)})` : "—"}
                  </td>
                  <td style={{ ...td, color: c.muted }}>{r.note ?? "—"}</td>
                  <td style={td}><button style={btnTiny} disabled={busyB} onClick={() => removeSpan(sp)}>Remove</button></td>
                </tr>
              );
            })}
            {shiftSpans.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={5}>Nothing in this window — everyone follows their standing shift.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── Section C: project assignments ────────────────────────────── */}
      {projectsOn && (
        <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Project assignments</div>
            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
              Put selected employees on a project for specific dates. Their shift doesn&apos;t change — only
              where the hours go. On those days this beats the project&apos;s own people, shift and site
              links, so it is the way to settle who is on what.
            </div>
          </div>

          <div style={{ padding: 14, borderBottom: `1px solid ${c.line}` }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <div style={{ minWidth: 260 }}>
                <label style={lbl}>Project</label>
                <select
                  style={{ ...inp, width: "100%" }}
                  value={projectC}
                  disabled={projects.length === 0}
                  onChange={(e) => setProjectC(e.target.value)}
                >
                  <option value="">{projects.length === 0 ? "No active projects yet" : "— choose a project —"}</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {"\u00a0\u00a0\u00a0".repeat(p.depth)}{p.depth > 0 ? "↳ " : ""}{p.name}{p.depth > 0 ? ` · Level ${p.depth}` : ""}
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <Link href={ROUTES.wfmProjects} style={{ display: "inline-block", marginTop: 4, fontSize: 11, color: "var(--tenant-accent, #378ADD)", textDecoration: "none", fontWeight: 600 }}>
                    Add a project →
                  </Link>
                )}
              </div>
              <div>
                <label style={lbl}>From</label>
                <input style={inp} type="date" value={fromC} onChange={(e) => setFromC(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>To</label>
                <input style={inp} type="date" value={toC} min={fromC} onChange={(e) => setToC(e.target.value)} />
              </div>
            </div>

            <EmployeePicker employees={employees} sites={activeSites} shifts={activeShifts} selected={selectedC} onChange={setSelectedC} />

            {errorC && <div style={{ fontSize: 12, color: statusInk.bad, marginBottom: 8 }}>{errorC}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button style={btnPrimary} disabled={busyC || projects.length === 0} onClick={applyProject}>
                {busyC ? "Assigning…" : `Assign ${selectedC.size || "…"} to ${projectName || "project"}`}
              </button>
              {okC && <span style={{ fontSize: 12, color: statusInk.good }}>{okC}</span>}
            </div>
          </div>

          <div style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: c.ink }}>
            On a project — next {UPCOMING_DAYS} days
          </div>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Dates</th><th style={th}>Employee</th><th style={th}>Project</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {projectSpans.map((sp) => {
                const r = sp.rows[0];
                const emp = one(r.employees);
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {fmtSpan(sp)}
                      {sp.rows.length > 1 && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>{sp.rows.length} days</span>}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      <Link href={ROUTES.wfmEmployee(r.employee_id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>{empName(emp)}</Link>
                      {emp?.employee_code && <span style={{ color: c.hint, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{emp.employee_code}</span>}
                    </td>
                    <td style={td}>{projectNameOf(r)}</td>
                    <td style={td}><button style={btnTiny} disabled={busyC} onClick={() => removeSpan(sp)}>Remove</button></td>
                  </tr>
                );
              })}
              {projectSpans.length === 0 && (
                <tr><td style={{ ...td, color: c.hint }} colSpan={4}>Nobody is on a project by roster in this window — hours follow each project&apos;s own people, shift and site links.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
