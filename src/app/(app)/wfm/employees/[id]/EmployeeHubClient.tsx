"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type {
  WfmShift, WfmSite, CorrectionIssue, WfmCorrectionRequest, WfmLeaveRequest, WfmRecheckRequest,
} from "@/lib/wfm/types";

type Person = { id: string; first_name: string; last_name: string };
type EmployeeOpt = Person & { employee_code: string | null; wfm_role: "employee" | "supervisor" };

type DayRecord = {
  date: string; first_in: string | null; last_out: string | null;
  net_minutes: number; gross_minutes: number; break_minutes: number;
  late: boolean; absent: boolean; incomplete: boolean;
  on_leave: { name: string } | null; holiday: string | null; is_week_off: boolean; punches: number;
};
type MonthSummary = {
  totals: {
    days_present: number; working_minutes: number; late_marks: number;
    half_day_deductions: number; paid_leave_days: number; unpaid_leave_days: number;
    holiday_days: number; incomplete_days: number;
  };
  days: DayRecord[];
};
type LeaveBalanceRow = { leave_type_id: string; name: string; category: string; quota: number; used: number; balance: number };

type Profile = {
  id: string; employee_code: string | null; first_name: string; last_name: string; phone: string | null;
  status: "active" | "inactive"; employment_type: string; wfm_role: "employee" | "supervisor";
  supervisor_id: string | null; consent_recorded_at: string | null;
  wfm_shifts: { id: string; name: string; start_time: string; end_time: string; is_night_shift: boolean } | { id: string; name: string; start_time: string; end_time: string; is_night_shift: boolean }[] | null;
  wfm_sites: { id: string; name: string } | { id: string; name: string }[] | null;
  supervisor: Person | null;
  has_login: boolean;
  reports: Person[];
  month: string;
  month_summary: MonthSummary | null;
  leave_balance: LeaveBalanceRow[];
};

type UpcomingRow = {
  date: string; is_day_off: boolean; shift_name: string | null;
  start_time: string | null; end_time: string | null; is_night_shift: boolean; source: "roster" | "standing";
};

type LeaveRecordRow = {
  id: string; date_from: string; date_to: string; half_day: boolean; remarks: string | null;
  wfm_leave_types: { name: string } | { name: string }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const ISSUE_LABEL: Record<CorrectionIssue, string> = {
  missing_check_in: "Missing check-in", missing_check_out: "Missing check-out", wrong_time: "Wrong time", other: "Other",
};
const CORRECTION_TONE = { pending: "amber", approved: "green", rejected: "red" } as const;
const LEAVE_TONE = { pending: "amber", approved: "green", rejected: "red" } as const;
const RECHECK_TONE = { pending: "amber", responded: "blue", resolved: "green", dismissed: "red" } as const;

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 11, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "top" };
const btn: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const btnGreen: React.CSSProperties = { ...btn, background: "#10b981", borderColor: "transparent", color: "#fff" };
const btnRed: React.CSSProperties = { ...btn, background: "#ef4444", borderColor: "transparent", color: "#fff" };
const capStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 };
const grid = (min: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });
const hhmm = (t: string) => t.slice(0, 5);
const fmtHM = (m: number) => `${Math.floor(m / 60)}h ${String(Math.abs(Math.round(m)) % 60).padStart(2, "0")}m`;
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
const fmtTs = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const todayKey = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

type Tab = "overview" | "attendance" | "corrections" | "leave" | "roster" | "recheck";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "attendance", label: "Attendance" },
  { key: "corrections", label: "Corrections" },
  { key: "leave", label: "Leave" },
  { key: "roster", label: "Roster" },
  { key: "recheck", label: "Flagged" },
];

export default function EmployeeHubClient({ employeeId, initialProfile = null, initialLists = null, employmentTypes = [] }: {
  employeeId: string;
  /** The tenant's configured employment types (Settings -> Workforce). */
  employmentTypes?: { code: string; label: string }[];
  /** Server-rendered core profile for the current month, so the hub paints
   * filled on first render instead of a blank "Loading…" through a fetch. */
  initialProfile?: Profile | null;
  initialLists?: {
    shifts: WfmShift[]; sites: WfmSite[]; supervisors: EmployeeOpt[];
    upcoming: UpcomingRow[]; corrections: WfmCorrectionRequest[];
    leaveRequests: WfmLeaveRequest[]; leaveRecords: LeaveRecordRow[]; recheck: WfmRecheckRequest[];
  } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(initialProfile?.month ?? thisMonth());

  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [shifts, setShifts] = useState<WfmShift[]>(initialLists?.shifts ?? []);
  const [sites, setSites] = useState<WfmSite[]>(initialLists?.sites ?? []);
  const [supervisors, setSupervisors] = useState<EmployeeOpt[]>(initialLists?.supervisors ?? []);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>(initialLists?.upcoming ?? []);
  const [corrections, setCorrections] = useState<(WfmCorrectionRequest)[]>(initialLists?.corrections ?? []);
  const [leaveRequests, setLeaveRequests] = useState<WfmLeaveRequest[]>(initialLists?.leaveRequests ?? []);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecordRow[]>(initialLists?.leaveRecords ?? []);
  const [recheck, setRecheck] = useState<WfmRecheckRequest[]>(initialLists?.recheck ?? []);
  const serverSeeded = useRef(initialLists != null);
  // The month whose core profile is already loaded. Seeded from the server
  // profile so the mount doesn't re-fetch the month it already has, and
  // updated by loadCore -- this is what stops the month-change effect from
  // firing a duplicate loadCore the instant `loading` flips to false.
  const loadedMonth = useRef<string | null>(initialProfile?.month ?? null);

  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(initialProfile == null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [editing, setEditing] = useState(false);
  // The identity grid + stat tiles collapse into a one-line summary so the
  // header doesn't dominate the page -- the record's tabs are what matter.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState({
    first_name: "", last_name: "", phone: "",
    employment_type: "" as string,
    wfm_role: "employee" as "employee" | "supervisor",
    status: "active" as "active" | "inactive",
    shift_id: "", site_id: "", supervisor_id: "",
  });

  const [rejectingCorr, setRejectingCorr] = useState<string | null>(null);
  const [remarkCorr, setRemarkCorr] = useState("");
  const [rejectingLeave, setRejectingLeave] = useState<string | null>(null);
  const [remarkLeave, setRemarkLeave] = useState("");

  const loadCore = useCallback(async (m: string) => {
    const res = await fetch(`/api/wfm/employees/${employeeId}?month=${m}`);
    const json = await res.json();
    if (!res.ok) { setLoadError(json.error ?? "Failed to load employee"); return; }
    loadedMonth.current = m;
    setProfile(json);
    setDraft({
      first_name: json.first_name, last_name: json.last_name,
      phone: json.phone ?? "", employment_type: json.employment_type, wfm_role: json.wfm_role, status: json.status,
      shift_id: one(json.wfm_shifts)?.id ?? "", site_id: one(json.wfm_sites)?.id ?? "", supervisor_id: json.supervisor_id ?? "",
    });
  }, [employeeId]);

  const loadAll = useCallback(async () => {
    if (serverSeeded.current) {
      // Server render already provided the eight secondary lists. The core
      // profile is fetched only if it WASN'T also seeded -- when the page
      // supplied initialProfile there is nothing left to fetch on mount, so
      // the hub shows real data with zero client round-trips. Any later
      // loadAll() (after a mutation) refetches everything.
      serverSeeded.current = false;
      if (!profile) await loadCore(month);
      setLoading(false);
      return;
    }
    const today = todayKey();
    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + 14);
    const rangeEndKey = rangeEnd.toISOString().slice(0, 10);

    const [
      shiftRes, siteRes, empRes, rosterRes, corrRes, leaveReqRes, leaveRecRes, recheckRes,
    ] = await Promise.all([
      fetch("/api/wfm/shifts"),
      fetch("/api/wfm/sites"),
      fetch("/api/wfm/employees"),
      fetch(`/api/wfm/roster?from=${today}&to=${rangeEndKey}&employee_id=${employeeId}`),
      fetch(`/api/wfm/corrections?employee_id=${employeeId}`),
      fetch(`/api/wfm/leave-requests?employee_id=${employeeId}`),
      fetch(`/api/wfm/leave-records?employee_id=${employeeId}`),
      fetch(`/api/wfm/recheck-requests?employee_id=${employeeId}`),
    ]);
    await loadCore(month);
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (siteRes.ok) setSites(await siteRes.json());
    if (empRes.ok) setSupervisors((await empRes.json()).filter((e: EmployeeOpt) => e.wfm_role === "supervisor" && e.id !== employeeId));
    if (rosterRes.ok) setUpcoming(await rosterRes.json());
    if (corrRes.ok) setCorrections(await corrRes.json());
    if (leaveReqRes.ok) setLeaveRequests(await leaveReqRes.json());
    if (leaveRecRes.ok) setLeaveRecords(await leaveRecRes.json());
    if (recheckRes.ok) setRecheck(await recheckRes.json());
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  // Reload the core profile ONLY on a real month change -- not on the initial
  // loading->false flip, which used to re-fetch the month already loaded (the
  // duplicate call visible in the production trace).
  useEffect(() => {
    if (loading || loadedMonth.current === month) return;
    loadCore(month);
  }, [month, loadCore, loading]);

  async function saveEdit() {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/wfm/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          shift_id: draft.shift_id || null,
          site_id: draft.site_id || null,
          supervisor_id: draft.supervisor_id || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setActionError(json.error ?? "Could not save"); return; }
      setEditing(false);
      await loadCore(month);
    } catch {
      setActionError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function resolveCorrection(id: string, action: "approve" | "reject", supervisor_remark?: string) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/wfm/corrections/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, supervisor_remark }),
      });
      const json = await res.json();
      if (!res.ok) { setActionError(json.error ?? "Request failed"); return; }
      setRejectingCorr(null); setRemarkCorr("");
      setCorrections(await (await fetch(`/api/wfm/corrections?employee_id=${employeeId}`)).json());
    } catch {
      setActionError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function resolveLeaveRequest(id: string, action: "approve" | "reject", supervisor_remark?: string) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/wfm/leave-requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, supervisor_remark }),
      });
      const json = await res.json();
      if (!res.ok) { setActionError(json.error ?? "Request failed"); return; }
      setRejectingLeave(null); setRemarkLeave("");
      setLeaveRequests(await (await fetch(`/api/wfm/leave-requests?employee_id=${employeeId}`)).json());
      setLeaveRecords(await (await fetch(`/api/wfm/leave-records?employee_id=${employeeId}`)).json());
    } catch {
      setActionError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function resolveRecheck(id: string, action: "resolve" | "dismiss") {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/wfm/recheck-requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) { setActionError(json.error ?? "Request failed"); return; }
      setRecheck(await (await fetch(`/api/wfm/recheck-requests?employee_id=${employeeId}`)).json());
    } catch {
      setActionError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const pendingCorr = useMemo(() => corrections.filter((r) => r.status === "pending").length, [corrections]);
  const pendingLeave = useMemo(() => leaveRequests.filter((r) => r.status === "pending").length, [leaveRequests]);
  const pendingRecheck = useMemo(() => recheck.filter((r) => r.status === "pending" || r.status === "responded").length, [recheck]);

  const activeShifts = useMemo(() => shifts.filter((s) => s.active), [shifts]);
  const activeSites = useMemo(() => sites.filter((s) => s.active), [sites]);

  if (loadError) return <div style={{ ...cardStyle, color: statusInk.bad, fontSize: 13 }}>{loadError}</div>;
  if (loading || !profile) return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading…</div>;

  const shift = one(profile.wfm_shifts);
  const site = one(profile.wfm_sites);
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");

  const tabBtn = (key: Tab, count?: number): React.CSSProperties => ({
    padding: "8px 14px", fontSize: 12.5, fontWeight: tab === key ? 700 : 500, whiteSpace: "nowrap",
    color: tab === key ? "#fff" : c.ink, background: tab === key ? "var(--tenant-accent, #378ADD)" : c.panel,
    border: `1px solid ${tab === key ? "transparent" : c.line}`, borderRadius: 8, cursor: "pointer",
    display: "flex", alignItems: "center", gap: 6,
  });

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href={ROUTES.wfmEmployees} style={{ fontSize: 12.5, color: c.muted, textDecoration: "none" }}>← Employees</Link>
      </div>

      {actionError && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{actionError}</div>}

      {/* ── Identity header ──────────────────────────────────────────── */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: c.ink, margin: 0 }}>{fullName}</h1>
              <Pill label={profile.status === "active" ? "Active" : "Inactive"} tone={profile.status === "active" ? "green" : "red"} />
              <Pill label={profile.wfm_role === "supervisor" ? "Supervisor" : "Employee"} tone={profile.wfm_role === "supervisor" ? "purple" : "teal"} />
              {!profile.has_login && <Pill label="No login" tone="amber" />}
            </div>
            <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4 }}>
              {profile.employee_code && <span>{profile.employee_code} · </span>}
              {employmentTypes.find((t) => t.code === profile.employment_type)?.label ?? profile.employment_type}
              {profile.phone && <span> · {profile.phone}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {!editing && (
              <button style={btn} onClick={() => setDetailsOpen((o) => !o)}>
                {detailsOpen ? "Hide details ▾" : "Details ▸"}
              </button>
            )}
            <button style={btn} onClick={() => setEditing((s) => !s)}>{editing ? "Cancel" : "Edit"}</button>
          </div>
        </div>

        {/* Collapsed (and not editing): a single line with the facts that
            matter, so nothing important is hidden while the block stays small. */}
        {!editing && !detailsOpen && (
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span><span style={{ color: c.hint }}>Site</span> {site?.name ?? "—"}</span>
            <span style={{ color: c.line }}>|</span>
            <span><span style={{ color: c.hint }}>Shift</span> {shift?.name ?? "—"}</span>
            <span style={{ color: c.line }}>|</span>
            <span><span style={{ color: c.hint }}>This month</span> <span style={{ color: c.ink, fontWeight: 600 }}>{fmtHM(profile.month_summary?.totals.working_minutes ?? 0)}</span></span>
            {(pendingCorr + pendingLeave + pendingRecheck) > 0 && (
              <>
                <span style={{ color: c.line }}>|</span>
                <span style={{ color: statusInk.warn, fontWeight: 600 }}>{pendingCorr + pendingLeave + pendingRecheck} pending</span>
              </>
            )}
          </div>
        )}

        {!editing && detailsOpen ? (
          <div style={{ ...grid(180), marginTop: 16 }}>
            <div>
              <div style={capStyle}>Site</div>
              <div style={{ fontSize: 13, color: c.ink, fontWeight: 600 }}>{site?.name ?? "— unassigned —"}</div>
            </div>
            <div>
              <div style={capStyle}>Shift</div>
              <div style={{ fontSize: 13, color: c.ink, fontWeight: 600 }}>
                {shift ? `${shift.name} (${hhmm(shift.start_time)}–${hhmm(shift.end_time)})` : "— unassigned —"}
              </div>
            </div>
            <div>
              <div style={capStyle}>Supervisor</div>
              <div style={{ fontSize: 13, color: c.ink, fontWeight: 600 }}>
                {profile.supervisor ? (
                  <Link href={ROUTES.wfmEmployee(profile.supervisor.id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {[profile.supervisor.first_name, profile.supervisor.last_name].filter(Boolean).join(" ")}
                  </Link>
                ) : "— none —"}
              </div>
            </div>
            {profile.reports.length > 0 && (
              <div>
                <div style={capStyle}>Reports to them</div>
                <div style={{ fontSize: 13, color: c.ink }}>
                  {profile.reports.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ", "}
                      <Link href={ROUTES.wfmEmployee(r.id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none", fontWeight: 600 }}>
                        {[r.first_name, r.last_name].filter(Boolean).join(" ")}
                      </Link>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : editing ? (
          <div style={{ ...grid(160), marginTop: 16 }}>
            <div><label style={lbl}>First name</label><input style={inp} value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /></div>
            <div><label style={lbl}>Last name</label><input style={inp} value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /></div>
            <div><label style={lbl}>Employee code</label><div style={{ fontSize: 12.5, color: profile.employee_code ? c.ink : c.hint, paddingTop: 9, fontFamily: profile.employee_code ? "monospace" : undefined }}>{profile.employee_code ?? "Assigned automatically (EMP-####)"}</div></div>
            <div><label style={lbl}>Phone</label><input style={inp} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
            <div>
              <label style={lbl}>Site</label>
              <select style={inp} value={draft.site_id} onChange={(e) => setDraft({ ...draft, site_id: e.target.value })}>
                <option value="">— unassigned —</option>
                {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Shift</label>
              <select style={inp} value={draft.shift_id} onChange={(e) => setDraft({ ...draft, shift_id: e.target.value })}>
                <option value="">— unassigned —</option>
                {activeShifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({hhmm(s.start_time)}–{hhmm(s.end_time)})</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Supervisor</label>
              <select style={inp} value={draft.supervisor_id} onChange={(e) => setDraft({ ...draft, supervisor_id: e.target.value })}>
                <option value="">— none —</option>
                {supervisors.map((s) => <option key={s.id} value={s.id}>{[s.first_name, s.last_name].filter(Boolean).join(" ")}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>WFM role</label>
              <select style={inp} value={draft.wfm_role} onChange={(e) => setDraft({ ...draft, wfm_role: e.target.value as "employee" | "supervisor" })}>
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Employment type</label>
              <select style={inp} value={draft.employment_type} onChange={(e) => setDraft({ ...draft, employment_type: e.target.value })}>
                {employmentTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Status</label>
              <select style={inp} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as "active" | "inactive" })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Clickable stat tiles (only when details are expanded) ─────── */}
      {!editing && detailsOpen && (
      <div style={{ ...grid(150), marginBottom: 14 }}>
        <div className="stat-tile is-clickable" style={{ ...cardStyle, cursor: "pointer" }} onClick={() => setTab("attendance")}>
          <div style={capStyle}>Hours this month</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: c.ink }}>{fmtHM(profile.month_summary?.totals.working_minutes ?? 0)}</div>
          <div style={{ fontSize: 11.5, color: c.muted }}>{profile.month_summary?.totals.days_present ?? 0} days present</div>
        </div>
        <div className="stat-tile is-clickable" style={{ ...cardStyle, cursor: "pointer" }} onClick={() => setTab("attendance")}>
          <div style={capStyle}>Late marks</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: (profile.month_summary?.totals.late_marks ?? 0) > 0 ? statusInk.warn : c.ink }}>
            {profile.month_summary?.totals.late_marks ?? 0}
          </div>
          <div style={{ fontSize: 11.5, color: c.muted }}>{profile.month_summary?.totals.half_day_deductions ?? 0} half-day deduction(s)</div>
        </div>
        <div className="stat-tile is-clickable" style={{ ...cardStyle, cursor: "pointer" }} onClick={() => setTab("corrections")}>
          <div style={capStyle}>Corrections</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: pendingCorr > 0 ? statusInk.warn : c.ink }}>{pendingCorr}</div>
          <div style={{ fontSize: 11.5, color: c.muted }}>pending of {corrections.length}</div>
        </div>
        <div className="stat-tile is-clickable" style={{ ...cardStyle, cursor: "pointer" }} onClick={() => setTab("leave")}>
          <div style={capStyle}>Leave requests</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: pendingLeave > 0 ? statusInk.warn : c.ink }}>{pendingLeave}</div>
          <div style={{ fontSize: 11.5, color: c.muted }}>pending of {leaveRequests.length}</div>
        </div>
        <div className="stat-tile is-clickable" style={{ ...cardStyle, cursor: "pointer" }} onClick={() => setTab("recheck")}>
          <div style={capStyle}>Flagged for review</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: pendingRecheck > 0 ? statusInk.warn : c.ink }}>{pendingRecheck}</div>
          <div style={{ fontSize: 11.5, color: c.muted }}>open of {recheck.length}</div>
        </div>
      </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(t.key)} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "corrections" && pendingCorr > 0 && <span style={{ opacity: 0.85 }}>({pendingCorr})</span>}
            {t.key === "leave" && pendingLeave > 0 && <span style={{ opacity: 0.85 }}>({pendingLeave})</span>}
            {t.key === "recheck" && pendingRecheck > 0 && <span style={{ opacity: 0.85 }}>({pendingRecheck})</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={grid(280)}>
          <section style={cardStyle}>
            <div style={capStyle}>Leave balance</div>
            {profile.leave_balance.length === 0 ? (
              <div style={{ fontSize: 12, color: c.hint }}>No leave types configured — see Settings → Workforce → Leave Types.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {profile.leave_balance.map((lb) => (
                  <div key={lb.leave_type_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: c.ink }}>{lb.name}</span>
                    <span style={{ color: lb.balance <= 0 ? statusInk.bad : c.muted }}>{lb.balance} / {lb.quota} left</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section style={cardStyle}>
            <div style={capStyle}>Next few days</div>
            {upcoming.length === 0 ? (
              <div style={{ fontSize: 12, color: c.hint }}>No shift assigned.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {upcoming.slice(0, 4).map((u) => (
                  <div key={u.date} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: c.ink }}>{fmtDateShort(u.date)}</span>
                    <span style={{ color: u.is_day_off ? statusInk.bad : c.muted }}>
                      {u.is_day_off ? "Day off" : u.shift_name ? `${u.shift_name} ${u.start_time?.slice(0, 5)}–${u.end_time?.slice(0, 5)}` : "— none —"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button style={{ ...btn, marginTop: 12 }} onClick={() => setTab("roster")}>View full roster</button>
          </section>
        </div>
      )}

      {tab === "attendance" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Daily attendance</div>
            <input style={{ ...inp, width: "auto" }} type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={th}>Date</th><th style={th}>In</th><th style={th}>Out</th><th style={th}>Worked</th><th style={th}>Status</th></tr>
              </thead>
              <tbody>
                {(profile.month_summary?.days ?? []).filter((d) => d.date <= todayKey()).slice().reverse().map((d) => (
                  <tr key={d.date}>
                    <td style={{ ...td, fontWeight: 600, color: c.ink, whiteSpace: "nowrap" }}>{fmtDate(d.date)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{d.first_in ? new Date(d.first_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{d.last_out ? new Date(d.last_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>{d.punches > 0 ? fmtHM(d.net_minutes) : "—"}</td>
                    <td style={td}>
                      {d.holiday ? <Pill label={d.holiday} tone="blue" />
                        : d.on_leave ? <Pill label={d.on_leave.name} tone="purple" />
                        : d.is_week_off ? <span style={{ color: c.hint }}>Week off</span>
                        : d.incomplete ? <Pill label="Incomplete" tone="red" />
                        : d.absent ? <Pill label="Absent" tone="red" />
                        : d.late ? <Pill label="Late" tone="amber" />
                        : d.punches > 0 ? <Pill label="Present" tone="green" />
                        : <span style={{ color: c.hint }}>—</span>}
                    </td>
                  </tr>
                ))}
                {(profile.month_summary?.days ?? []).length === 0 && (
                  <tr><td style={{ ...td, color: c.hint }} colSpan={5}>No records this month.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "corrections" && (
        <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={th}>Date</th><th style={th}>Issue</th><th style={th}>Reason</th><th style={th}>Proposed</th><th style={th}>Status</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {corrections.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{fmtDate(r.target_date)}</td>
                  <td style={td}>{ISSUE_LABEL[r.requested_change.issue]}</td>
                  <td style={{ ...td, maxWidth: 220 }}>{r.reason_text}</td>
                  <td style={td}>{fmtTs(r.requested_change.proposed_ts)}</td>
                  <td style={td}>
                    <Pill label={r.status} tone={CORRECTION_TONE[r.status]} />
                    {r.supervisor_remark && <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>{r.supervisor_remark}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {r.status === "pending" && (
                      rejectingCorr === r.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input autoFocus value={remarkCorr} onChange={(e) => setRemarkCorr(e.target.value)} placeholder="Reason" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, width: 120 }} />
                          <button style={btnRed} disabled={busy || !remarkCorr.trim()} onClick={() => resolveCorrection(r.id, "reject", remarkCorr)}>Confirm</button>
                          <button style={btn} disabled={busy} onClick={() => { setRejectingCorr(null); setRemarkCorr(""); }}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <button style={btnGreen} disabled={busy} onClick={() => resolveCorrection(r.id, "approve")}>Approve</button>{" "}
                          <button style={btnRed} disabled={busy} onClick={() => setRejectingCorr(r.id)}>Reject</button>
                        </>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {corrections.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={6}>No correction requests.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {tab === "leave" && (
        <>
          <section style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
            <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>Leave requests</div>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>From</th><th style={th}>To</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}></th></tr></thead>
              <tbody>
                {leaveRequests.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{fmtDate(r.date_from)}</td>
                    <td style={td}>{fmtDate(r.date_to)}{r.half_day && <span style={{ color: c.hint }}> (half-day)</span>}</td>
                    <td style={{ ...td, maxWidth: 220 }}>{r.reason_text}</td>
                    <td style={td}>
                      <Pill label={r.status} tone={LEAVE_TONE[r.status]} />
                      {r.supervisor_remark && <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>{r.supervisor_remark}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {r.status === "pending" && (
                        rejectingLeave === r.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input autoFocus value={remarkLeave} onChange={(e) => setRemarkLeave(e.target.value)} placeholder="Reason" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, width: 120 }} />
                            <button style={btnRed} disabled={busy || !remarkLeave.trim()} onClick={() => resolveLeaveRequest(r.id, "reject", remarkLeave)}>Confirm</button>
                            <button style={btn} disabled={busy} onClick={() => { setRejectingLeave(null); setRemarkLeave(""); }}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            <button style={btnGreen} disabled={busy} onClick={() => resolveLeaveRequest(r.id, "approve")}>Approve</button>{" "}
                            <button style={btnRed} disabled={busy} onClick={() => setRejectingLeave(r.id)}>Reject</button>
                          </>
                        )
                      )}
                    </td>
                  </tr>
                ))}
                {leaveRequests.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={5}>No leave requests.</td></tr>}
              </tbody>
            </table>
          </section>

          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>Leave records</div>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Type</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Remarks</th></tr></thead>
              <tbody>
                {leaveRecords.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600, color: c.ink }}>{one(r.wfm_leave_types)?.name ?? "—"}</td>
                    <td style={td}>{fmtDate(r.date_from)}</td>
                    <td style={td}>{fmtDate(r.date_to)}{r.half_day && <span style={{ color: c.hint }}> (half-day)</span>}</td>
                    <td style={{ ...td, color: c.muted }}>{r.remarks ?? "—"}</td>
                  </tr>
                ))}
                {leaveRecords.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={4}>No leave records.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "roster" && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Upcoming shifts</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>Next {upcoming.length} days</div>
            </div>
            <button style={btn} onClick={() => router.push(ROUTES.wfmRoster)}>Manage roster →</button>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {upcoming.map((u) => {
              const isToday = u.date === todayKey();
              return (
                <div key={u.date} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderBottom: `1px solid ${c.line}`,
                  borderLeft: `3px solid ${u.is_day_off ? statusInk.bad : isToday ? "var(--tenant-accent, #378ADD)" : "transparent"}`,
                  background: isToday ? "var(--panel2)" : "transparent",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{fmtDateShort(u.date)}</span>
                    {isToday && <Pill label="Today" tone="green" />}
                    {u.source === "roster" && <span style={{ fontSize: 10.5, color: c.hint }}>(override)</span>}
                  </div>
                  <div style={{ fontSize: 12.5, textAlign: "right" }}>
                    {u.is_day_off ? <Pill label="Day off" tone="red" />
                      : u.shift_name ? (
                        <>
                          <span style={{ color: c.ink, fontWeight: 600 }}>{u.shift_name}</span>
                          <span style={{ color: c.muted, marginLeft: 6 }}>{u.start_time?.slice(0, 5)}–{u.end_time?.slice(0, 5)}</span>
                        </>
                      ) : <span style={{ color: c.hint }}>No shift assigned</span>}
                  </div>
                </div>
              );
            })}
            {upcoming.length === 0 && <div style={{ padding: 14, fontSize: 12, color: c.hint }}>No shift assigned.</div>}
          </div>
        </section>
      )}

      {tab === "recheck" && (
        <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Message</th><th style={th}>Reply</th><th style={th}>Status</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {recheck.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{fmtDate(r.target_date)}</td>
                  <td style={td}>{r.recheck_type === "both" ? "Time & selfie" : r.recheck_type === "time" ? "Time" : "Selfie"}</td>
                  <td style={{ ...td, maxWidth: 200, color: c.muted }}>{r.message}</td>
                  <td style={{ ...td, maxWidth: 200 }}>
                    {r.employee_response_text ?? <span style={{ color: c.hint }}>— no reply yet —</span>}
                    {r.linked_correction_id && <div style={{ marginTop: 4 }}><Pill label="Filed a correction" tone="blue" /></div>}
                  </td>
                  <td style={td}><Pill label={r.status} tone={RECHECK_TONE[r.status]} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {(r.status === "pending" || r.status === "responded") && (
                      <>
                        <button style={btnGreen} disabled={busy} onClick={() => resolveRecheck(r.id, "resolve")}>Resolve</button>{" "}
                        <button style={btnRed} disabled={busy} onClick={() => resolveRecheck(r.id, "dismiss")}>Dismiss</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {recheck.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={6}>No recheck requests.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
