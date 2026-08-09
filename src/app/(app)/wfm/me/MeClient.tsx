"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import Donut from "@/components/Donut";
import PunchAudit from "@/components/wfm/PunchAudit";
import type { PresenceKind, PunchState, LeaveRequestStatus } from "@/lib/wfm/types";
import { enqueuePunch, flushQueue, listQueuedPunches } from "@/lib/wfm/offlineQueue";

// The consent copy ships separately (bilingual EN + regional). Placeholder
// per requirements: CONSENT_TEXT_DE_EN_PLACEHOLDER.
const CONSENT_TEXT = `To record your attendance, this app captures:

• A selfie at every check-in and check-out
• Your location (GPS) at the time of each punch, which is converted into a street address using a mapping service (Ola Maps) so your supervisor can see where a punch was made

This data is used only for attendance and payroll summary purposes, is visible to your supervisor and employer, and punch selfies are automatically deleted after the configured retention period. You can request deletion of your data when you leave the organisation.

By tapping "I agree", you consent to this collection under India's DPDP Act.`;

type MeState = {
  employee: {
    id: string; full_name: string; employee_code: string | null;
    wfm_role: "employee" | "supervisor"; consent_recorded_at: string | null;
  } | null;
  is_supervisor: boolean;
  state: PunchState;
  today: { id: string; kind: PresenceKind; ts: string }[];
  running_minutes: number;
  break_minutes: number;
  home_site: { id: string; name: string } | null;
  shift: { name: string; start_time: string; end_time: string } | null;
  timezone: string;
};

type MonthTotals = {
  days_present: number; working_minutes: number; late_marks: number;
  half_day_deductions: number; paid_leave_days: number; unpaid_leave_days: number;
  holiday_days: number; night_shifts: number; night_allowance_total: number; incomplete_days: number;
};
type BreakSegment = { start: string; end: string | null; minutes: number };
type WorkSession = { in: string; out: string | null; gross_minutes: number; break_minutes: number; net_minutes: number; breaks: BreakSegment[] };
type DayRecord = {
  date: string; first_in: string | null; last_out: string | null;
  sessions: WorkSession[];
  breaks: BreakSegment[];
  net_minutes: number; gross_minutes: number; break_minutes: number;
  late: boolean; absent: boolean;
  incomplete: boolean; on_leave: { name: string; category: string } | null;
  holiday: string | null; is_week_off: boolean; punches: number;
};
type LeaveBalance = { leave_type_id: string; name: string; category: string; quota: number; used: number; balance: number };
type Holiday = { id: string; date: string; name: string; applies_to: string };
type CorrectionRequest = {
  id: string; target_date: string; status: "pending" | "approved" | "rejected";
  requested_change: { issue: string }; reason_text: string; supervisor_remark: string | null;
};
type LeaveRequest = {
  id: string; date_from: string; date_to: string; half_day: boolean;
  reason_text: string; status: LeaveRequestStatus; supervisor_remark: string | null;
  wfm_leave_types: { name: string; category: string } | null;
};
type TrendPoint = {
  month: string; working_minutes: number; days_present: number;
  late_marks: number; paid_leave_days: number; unpaid_leave_days: number; incomplete_days: number;
};
type Analytics = {
  month: string; is_supervisor: boolean; trend: TrendPoint[];
  current: TrendPoint; previous: TrendPoint | null; on_time_rate: number | null;
  team: { employee_count: number; avg_working_minutes: number; avg_days_present: number; avg_late_marks: number; total_incomplete_days: number } | null;
};

type Geo = { lat: number; lng: number; accuracy_m: number } | null;
type Tab = "home" | "time" | "leave" | "calendar" | "analytics";
type TimeView = "daily" | "monthly";

const TABS: { key: Tab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "time", label: "Time" },
  { key: "leave", label: "Leave" },
  { key: "calendar", label: "Calendar" },
  { key: "analytics", label: "Analytics" },
];

const KIND_LABEL: Record<PresenceKind, string> = {
  check_in: "Check in", check_out: "Check out", break_start: "Break", break_end: "End break",
};
const ISSUE_LABEL: Record<string, string> = {
  missing_check_in: "Missing check-in", missing_check_out: "Missing check-out",
  wrong_time: "Wrong time", other: "Other",
};
const STATUS_TONE: Record<string, "amber" | "green" | "red"> = { pending: "amber", approved: "green", rejected: "red" };

const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.abs(Math.round(mins)) % 60).padStart(2, "0")}m`;
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (s: string) => new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const fmtMonth = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const todayKey = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function getGeo(timeoutMs: number): Promise<Geo> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

function frameToBlob(video: HTMLVideoElement): Promise<Blob | null> {
  const MAX = 720;
  const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const g = canvas.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
}

const btn: React.CSSProperties = {
  padding: "9px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 9,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 12.5, border: `1px solid ${c.line}`,
  borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 11, color: c.muted, marginBottom: 4 };
const capStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase",
  letterSpacing: 0.4, marginBottom: 8,
};
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 };
const grid = (min: number): React.CSSProperties => ({
  display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 14,
});

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 21, fontWeight: 700, color: tone ?? c.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: c.muted }}>{label}</div>
    </div>
  );
}

function Bars({ points, valueOf, format }: { points: TrendPoint[]; valueOf: (p: TrendPoint) => number; format: (n: number) => string }) {
  const max = Math.max(1, ...points.map(valueOf));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110, marginTop: 6 }}>
      {points.map((p) => {
        const v = valueOf(p);
        return (
          <div key={p.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div style={{ fontSize: 10, color: c.hint, whiteSpace: "nowrap" }}>{format(v)}</div>
            <div
              title={`${fmtMonth(p.month)}: ${format(v)}`}
              style={{
                width: "100%", maxWidth: 46, borderRadius: "5px 5px 0 0",
                height: `${Math.max(3, (v / max) * 100)}%`,
                background: "var(--tenant-accent, #378ADD)", opacity: v === 0 ? 0.25 : 1,
              }}
            />
            <div style={{ fontSize: 10.5, color: c.muted, whiteSpace: "nowrap" }}>{fmtMonth(p.month)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function MeClient() {
  const [tab, setTab] = useState<Tab>("home");
  const [timeView, setTimeView] = useState<TimeView>("daily");
  const [month, setMonth] = useState(thisMonth());
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [leaveFilter, setLeaveFilter] = useState<string>("");
  const [holidayFilter, setHolidayFilter] = useState<"upcoming" | "all">("upcoming");
  const [holidayQuery, setHolidayQuery] = useState("");
  const [me, setMe] = useState<MeState | null>(null);
  const [monthTotals, setMonthTotals] = useState<MonthTotals | null>(null);
  const [days, setDays] = useState<DayRecord[]>([]);
  const [deductBreaks, setDeductBreaks] = useState(true);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [cameraFor, setCameraFor] = useState<PresenceKind | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState({ target_date: todayKey(), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
  const [leaveDraft, setLeaveDraft] = useState({ leave_type_id: "", date_from: todayKey(), date_to: todayKey(), half_day: false, reason_text: "" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/me/state");
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? "Could not load"); return; }
      setMe(json);
      setLoadError("");
      if (!json.employee?.consent_recorded_at) return;

      const [tsRes, holRes, corrRes, leaveRes, anRes] = await Promise.all([
        fetch(`/api/wfm/me/timesheet?month=${month}`),
        fetch("/api/wfm/holidays"),
        fetch("/api/wfm/corrections"),
        fetch("/api/wfm/leave-requests"),
        fetch("/api/wfm/me/analytics"),
      ]);
      if (tsRes.ok) {
        const ts = await tsRes.json();
        setMonthTotals(ts.summary?.totals ?? null);
        setDays(ts.summary?.days ?? []);
        setLeaveBalance(ts.leave_balance ?? []);
        setDeductBreaks(ts.deduct_breaks !== false);
      }
      if (holRes.ok) setHolidays(await holRes.json());
      if (corrRes.ok) setCorrections(await corrRes.json());
      if (leaveRes.ok) setLeaveRequests(await leaveRes.json());
      if (anRes.ok) setAnalytics(await anRes.json());
    } catch {
      setLoadError("Network error — check your connection");
    }
  }, [month]);

  const trySync = useCallback(async () => {
    try {
      const { synced, remaining } = await flushQueue();
      setQueuedCount(remaining);
      if (synced > 0) await load();
    } catch { /* still offline */ }
  }, [load]);

  useEffect(() => {
    load();
    listQueuedPunches().then((q) => setQueuedCount(q.length)).catch(() => {});
    trySync();
    const onOnline = () => trySync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, trySync]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraFor(null);
  }

  async function openCamera(kind: PresenceKind) {
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      setCameraFor(kind);
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch {
      setNotice({ tone: "err", text: "Camera permission is required to punch. Please allow camera access and try again." });
    }
  }

  async function submitPunch(kind: PresenceKind, selfie: Blob | null) {
    setBusy(true);
    setNotice(null);
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    const geo = await getGeo(kind === "break_start" || kind === "break_end" ? 5000 : 10_000);
    try {
      const res = await fetch("/api/wfm/punch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind, ts, geo }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Punch failed" }); return; }
      const where = json.site_name ? `at ${json.site_name}` : json.within_geofence === false ? "— location noted" : "";
      setNotice({ tone: json.within_geofence === false ? "warn" : "ok", text: `${KIND_LABEL[kind]} recorded at ${fmtTime(ts)} ${where}.` });
      if (selfie) {
        const form = new FormData();
        form.append("event_id", id);
        form.append("file", selfie, "selfie.jpg");
        fetch("/api/wfm/punch/selfie", { method: "POST", body: form }).catch(() => {});
      }
      await load();
    } catch {
      try {
        await enqueuePunch({ id, kind, ts, geo, selfie, queuedAt: new Date().toISOString() });
        setQueuedCount((await listQueuedPunches()).length);
        setNotice({ tone: "warn", text: `${KIND_LABEL[kind]} saved offline — will sync automatically when you're back online.` });
        await load();
      } catch {
        setNotice({ tone: "err", text: "Network error and offline storage failed — punch not recorded. Try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function captureAndPunch() {
    if (!videoRef.current || !cameraFor) return;
    const kind = cameraFor;
    const blob = await frameToBlob(videoRef.current);
    stopCamera();
    await submitPunch(kind, blob);
  }

  async function recordConsent() {
    setBusy(true);
    try {
      const res = await fetch("/api/wfm/consent", { method: "POST" });
      if (res.ok) await load();
      else setNotice({ tone: "err", text: (await res.json()).error ?? "Could not record consent" });
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection() {
    if (!correctionDraft.reason_text.trim()) { setNotice({ tone: "err", text: "Please describe the issue" }); return; }
    if (correctionDraft.issue !== "other" && !correctionDraft.proposed_ts) { setNotice({ tone: "err", text: "Please give the correct time" }); return; }
    setBusy(true);
    try {
      const proposed_ts = correctionDraft.proposed_ts
        ? new Date(`${correctionDraft.target_date}T${correctionDraft.proposed_ts}:00`).toISOString()
        : undefined;
      const res = await fetch("/api/wfm/corrections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...correctionDraft, proposed_ts, reason_text: correctionDraft.reason_text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Could not submit" }); return; }
      setShowCorrectionForm(false);
      setCorrectionDraft({ target_date: todayKey(), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
      setNotice({ tone: "ok", text: "Correction request submitted — your supervisor will review it." });
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function submitLeaveRequest() {
    if (!leaveDraft.leave_type_id) { setNotice({ tone: "err", text: "Please choose a leave type" }); return; }
    if (!leaveDraft.reason_text.trim()) { setNotice({ tone: "err", text: "Please give a reason" }); return; }
    if (leaveDraft.date_to < leaveDraft.date_from) { setNotice({ tone: "err", text: "End date can't be before start date" }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/wfm/leave-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaveDraft, reason_text: leaveDraft.reason_text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Could not submit" }); return; }
      setShowLeaveForm(false);
      setLeaveDraft({ leave_type_id: "", date_from: todayKey(), date_to: todayKey(), half_day: false, reason_text: "" });
      setNotice({ tone: "ok", text: "Leave request submitted — your supervisor will review it." });
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div style={{ ...cardStyle, color: statusInk.bad, fontSize: 13 }}>{loadError}</div>;
  if (!me) return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading…</div>;

  if (!me.employee) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.ink }}>No employee profile</div>
        <div style={{ fontSize: 12.5, color: c.muted }}>
          Your login isn&apos;t linked to an employee record yet. Ask your supervisor to add you in Workforce → Employees.
        </div>
      </div>
    );
  }

  if (!me.employee.consent_recorded_at) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: c.ink }}>Before you start</div>
        <div style={{ fontSize: 13, color: c.muted, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{CONSENT_TEXT}</div>
        <button style={{ ...btnPrimary, marginTop: 16 }} disabled={busy} onClick={recordConsent}>I agree</button>
      </div>
    );
  }

  if (cameraFor) {
    return (
      <div style={{ ...cardStyle, maxWidth: 440 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, textAlign: "center", color: c.ink }}>
          {KIND_LABEL[cameraFor]} — take a selfie
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 12, transform: "scaleX(-1)", background: "#000", aspectRatio: "3/4", objectFit: "cover" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button style={{ ...btn, flex: 1 }} onClick={stopCamera}>Cancel</button>
          <button style={{ ...btnPrimary, flex: 2 }} disabled={busy} onClick={captureAndPunch}>{busy ? "Recording…" : "Capture & punch"}</button>
        </div>
      </div>
    );
  }

  const toneColor = { ok: statusInk.good, warn: statusInk.warn, err: statusInk.bad };
  const upcoming = holidays.filter((h) => h.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date));
  const nextHoliday = upcoming[0] ?? null;
  const pendingLeave = leaveRequests.filter((r) => r.status === "pending").length;
  const pendingCorr = corrections.filter((r) => r.status === "pending").length;

  // ── Time tab data ────────────────────────────────────────────────────────
  const dayLabel = (d: DayRecord): string => {
    if (d.holiday) return "Holiday";
    if (d.on_leave) return "Leave";
    if (d.is_week_off) return "Week off";
    if (d.incomplete) return "Incomplete";
    if (d.absent) return "Absent";
    if (d.late) return "Late";
    if (d.punches > 0) return "Present";
    return "—";
  };
  // Past days only -- counting the rest of the month as "absent" would be
  // both wrong and alarming.
  const elapsedDays = days.filter((d) => d.date <= todayKey());
  const dayMix = [
    { label: "Present", color: pillar.green.base },
    { label: "Late", color: pillar.amber.base },
    { label: "Absent", color: pillar.red.base },
    { label: "Leave", color: pillar.purple.base },
    { label: "Holiday", color: pillar.blue.base },
    { label: "Week off", color: pillar.teal.base },
    { label: "Incomplete", color: pillar.red.base },
  ].map((s) => ({ ...s, value: elapsedDays.filter((d) => dayLabel(d) === s.label).length }));

  const workedMinutes = elapsedDays.reduce((s, d) => s + (deductBreaks ? d.net_minutes : d.gross_minutes), 0);
  const breakMinutes = elapsedDays.reduce((s, d) => s + d.break_minutes, 0);
  const hoursMix = [
    { label: "Worked", value: Math.round(workedMinutes / 60), color: pillar.green.base },
    { label: "Breaks", value: Math.round(breakMinutes / 60), color: pillar.amber.base },
  ];

  const visibleDays = elapsedDays
    .filter((d) => !dayFilter || dayLabel(d) === dayFilter)
    .slice()
    .reverse();

  const leaveMix = leaveBalance.map((lb, i) => ({
    label: lb.name,
    value: lb.used,
    color: [pillar.purple.base, pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.green.base][i % 5],
  }));

  const visibleHolidays = holidays.filter((h) => {
    if (holidayFilter === "upcoming" && h.date < todayKey()) return false;
    const hq = holidayQuery.trim().toLowerCase();
    return !hq || h.name.toLowerCase().includes(hq);
  });

  const visibleLeaveRequests = leaveFilter ? leaveRequests.filter((r) => r.status === leaveFilter) : leaveRequests;

  // The punch card is one tile among several, and check in/out happens
  // straight from it -- no separate punch screen (the ADP pattern the
  // client asked for).
  const punchTile = (
    <section className="stat-tile" style={{ ...cardStyle, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <div style={capStyle}>Punch</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: c.ink }}>{fmtHM(me.running_minutes)}</div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
          {me.state === "out" && me.today.length === 0 && "Not checked in yet"}
          {me.state === "out" && me.today.length > 0 && "Checked out for today"}
          {me.state === "in" && "You're checked in"}
          {me.state === "break" && "On break"}
          {me.break_minutes > 0 && ` · breaks ${fmtHM(me.break_minutes)} (not counted)`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {me.state === "out" && <button style={{ ...btnPrimary, background: "#10b981", padding: "12px 24px", fontSize: 14 }} disabled={busy} onClick={() => openCamera("check_in")}>Check in</button>}
        {me.state === "in" && (
          <>
            <button style={{ ...btnPrimary, background: "#ef4444", padding: "12px 24px", fontSize: 14 }} disabled={busy} onClick={() => openCamera("check_out")}>Check out</button>
            <button style={btn} disabled={busy} onClick={() => submitPunch("break_start", null)}>☕ Break</button>
          </>
        )}
        {me.state === "break" && (
          <>
            <button style={{ ...btnPrimary, padding: "12px 24px", fontSize: 14 }} disabled={busy} onClick={() => submitPunch("break_end", null)}>End break</button>
            <button style={btn} disabled={busy} onClick={() => openCamera("check_out")}>Check out</button>
          </>
        )}
      </div>
      {notice && <div style={{ marginTop: 12, fontSize: 12.5, color: toneColor[notice.tone] }}>{notice.text}</div>}
    </section>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={tab === t.key ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn}
          >
            {t.label}
            {t.key === "leave" && pendingLeave > 0 && <span style={{ marginLeft: 6, opacity: 0.85 }}>({pendingLeave})</span>}
          </button>
        ))}
      </div>

      {queuedCount > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.warn, fontSize: 12.5 }}>{queuedCount} punch(es) pending sync</div>
      )}

      {tab === "home" && (
        <>
          <div style={{ ...grid(260), marginBottom: 14 }}>
            {punchTile}

            <section className="stat-tile is-clickable" style={cardStyle} onClick={() => setTab("time")}>
              <div style={capStyle}>This month</div>
              {monthTotals ? (
                <>
                  <Stat value={fmtHM(monthTotals.working_minutes)} label={`working hours · ${monthTotals.days_present} days present`} />
                  <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11.5, color: c.muted, flexWrap: "wrap" }}>
                    <span style={{ color: monthTotals.late_marks > 0 ? statusInk.warn : undefined }}>{monthTotals.late_marks} late</span>
                    <span>{monthTotals.paid_leave_days + monthTotals.unpaid_leave_days} leave</span>
                    <span>{monthTotals.holiday_days} holidays</span>
                  </div>
                </>
              ) : <div style={{ fontSize: 12, color: c.hint }}>—</div>}
              <button style={{ ...btn, marginTop: 14 }} onClick={() => setTab("time")}>View timesheet</button>
            </section>

            <section className="stat-tile is-clickable" style={cardStyle} onClick={() => setTab("leave")}>
              <div style={capStyle}>Leave</div>
              {leaveBalance.length === 0 ? (
                <div style={{ fontSize: 12, color: c.hint }}>No leave types configured.</div>
              ) : (
                leaveBalance.slice(0, 3).map((lb) => (
                  <div key={lb.leave_type_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                    <span style={{ color: c.ink }}>{lb.name}</span>
                    <span style={{ color: lb.balance <= 0 ? statusInk.bad : c.muted }}>{lb.balance} / {lb.quota}</span>
                  </div>
                ))
              )}
              {pendingLeave > 0 && <div style={{ fontSize: 11.5, color: statusInk.warn, marginTop: 8 }}>{pendingLeave} request(s) awaiting approval</div>}
              <button style={{ ...btn, marginTop: 14 }} onClick={() => setTab("leave")}>Request leave</button>
            </section>

            <section className="stat-tile is-clickable" style={cardStyle} onClick={() => setTab("calendar")}>
              <div style={capStyle}>Next holiday</div>
              {nextHoliday ? (
                <>
                  <Stat value={fmtDate(nextHoliday.date)} label={nextHoliday.name} />
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8 }}>
                    in {Math.max(0, Math.round((new Date(nextHoliday.date + "T00:00:00").getTime() - new Date(todayKey() + "T00:00:00").getTime()) / 86_400_000))} day(s)
                  </div>
                </>
              ) : <div style={{ fontSize: 12, color: c.hint }}>None scheduled.</div>}
              <button style={{ ...btn, marginTop: 14 }} onClick={() => setTab("calendar")}>View calendar</button>
            </section>
          </div>

          {me.today.length > 0 && (
            <section style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={capStyle}>Today&apos;s punches</div>
              {/* Selfie + location for each punch -- the employee can see
                  exactly what was recorded about them, which is a DPDP
                  transparency expectation, not just a nicety. */}
              <PunchAudit employeeId={me.employee.id} />
              <div style={{ fontSize: 11.5, color: c.hint, marginTop: 10 }}>
                {me.employee.employee_code}
                {me.shift && <> · {me.shift.name} ({me.shift.start_time.slice(0, 5)}–{me.shift.end_time.slice(0, 5)})</>}
                {me.home_site && <> · {me.home_site.name}</>}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "time" && (
        <>
          <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <button style={timeView === "daily" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setTimeView("daily")}>Daily — detailed</button>
            <button style={timeView === "monthly" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setTimeView("monthly")}>Monthly summary</button>
            <input style={{ ...inp, width: "auto" }} type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>

          <div style={{ ...grid(300), marginBottom: 14 }}>
            <section style={cardStyle}>
              <Donut slices={dayMix} title="How your month is going" centerLabel="days" selected={dayFilter} onSelect={setDayFilter} />
            </section>
            <section style={cardStyle}>
              <Donut slices={hoursMix} title={`Hours split — ${deductBreaks ? "breaks deducted" : "breaks included"}`} centerLabel="hours" />
            </section>
          </div>

          {timeView === "daily" && (
            <section style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Daily record — {fmtMonth(month)}</div>
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 3 }}>
                    Every punch as booked. Total worked ={" "}
                    {deductBreaks ? "check-out − check-in − breaks" : "check-out − check-in (breaks not deducted)"}.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select style={{ ...inp, width: "auto" }} value={dayFilter ?? ""} onChange={(e) => setDayFilter(e.target.value || null)}>
                    <option value="">All days</option>
                    {dayMix.filter((s) => s.value > 0).map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
                  </select>
                  <span style={{ fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>{visibleDays.length} of {elapsedDays.length}</span>
                </div>
              </div>
              <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Date</th><th style={th}>In</th><th style={th}>Out</th>
                    <th style={th}>Breaks taken</th><th style={th}>Break total</th>
                    <th style={th}>Gross</th><th style={th}>Total worked</th><th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.map((d) => (
                    <tr key={d.date}>
                      <td style={{ ...td, color: c.ink, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDate(d.date)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        {d.sessions.length === 0 ? "—" : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {d.sessions.map((s, i) => (
                              <span key={s.in}>{d.sessions.length > 1 && <span style={{ color: c.hint }}>{i + 1}. </span>}{fmtTime(s.in)}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        {d.sessions.length === 0 ? "—" : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {d.sessions.map((s) => (
                              <span key={s.in}>{s.out ? fmtTime(s.out) : <span style={{ color: statusInk.bad }}>missing</span>}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, verticalAlign: "top" }}>
                        {d.breaks.length === 0 ? <span style={{ color: c.hint }}>—</span> : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {d.breaks.map((b, i) => (
                              <span key={b.start} style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                                <span style={{ color: c.hint }}>{i + 1}.</span>{" "}
                                {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : <span style={{ color: statusInk.warn }}>running</span>}
                                <span style={{ color: c.hint }}> ({b.minutes}m)</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", verticalAlign: "top" }}>{d.break_minutes > 0 ? fmtHM(d.break_minutes) : "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: c.muted, verticalAlign: "top" }}>{d.punches > 0 ? fmtHM(d.gross_minutes) : "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: c.ink, verticalAlign: "top" }}>
                        {d.punches > 0 ? fmtHM(deductBreaks ? d.net_minutes : d.gross_minutes) : "—"}
                      </td>
                      <td style={{ ...td, verticalAlign: "top" }}>
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
                  {visibleDays.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={8}>{dayFilter ? `No "${dayFilter}" days this month.` : "No records this month."}</td></tr>}
                </tbody>
                {monthTotals && (
                  <tfoot>
                    <tr>
                      <td style={{ ...td, fontWeight: 700, color: c.ink }} colSpan={4}>Month total</td>
                      <td style={{ ...td, fontWeight: 700 }}>{fmtHM(days.reduce((s, d) => s + d.break_minutes, 0))}</td>
                      <td style={{ ...td, fontWeight: 700, color: c.muted }}>{fmtHM(days.reduce((s, d) => s + d.gross_minutes, 0))}</td>
                      <td style={{ ...td, fontWeight: 700, color: c.ink }}>{fmtHM(monthTotals.working_minutes)}</td>
                      <td style={td}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </section>
          )}

          {timeView === "monthly" && (
            <div style={{ ...grid(200), marginBottom: 14 }}>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Total worked</div><Stat value={fmtHM(monthTotals?.working_minutes ?? 0)} label={deductBreaks ? "breaks deducted" : "breaks not deducted"} /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Days present</div><Stat value={String(monthTotals?.days_present ?? 0)} label="days with a punch" /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Break time</div><Stat value={fmtHM(days.reduce((s, d) => s + d.break_minutes, 0))} label="total this month" /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Late marks</div><Stat value={String(monthTotals?.late_marks ?? 0)} label={`${monthTotals?.half_day_deductions ?? 0} half-day deduction(s)`} tone={(monthTotals?.late_marks ?? 0) > 0 ? statusInk.warn : undefined} /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Leave</div><Stat value={String((monthTotals?.paid_leave_days ?? 0) + (monthTotals?.unpaid_leave_days ?? 0))} label={`${monthTotals?.paid_leave_days ?? 0} paid · ${monthTotals?.unpaid_leave_days ?? 0} unpaid`} /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Holidays</div><Stat value={String(monthTotals?.holiday_days ?? 0)} label="this month" /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Night shifts</div><Stat value={String(monthTotals?.night_shifts ?? 0)} label={monthTotals?.night_allowance_total ? `₹${monthTotals.night_allowance_total.toLocaleString("en-IN")} allowance` : "no allowance"} /></section>
              <section className="stat-tile" style={cardStyle}><div style={capStyle}>Incomplete</div><Stat value={String(monthTotals?.incomplete_days ?? 0)} label="days missing a check-out" tone={(monthTotals?.incomplete_days ?? 0) > 0 ? statusInk.bad : undefined} /></section>
            </div>
          )}

          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Correction requests{pendingCorr > 0 && <span style={{ color: statusInk.warn, fontWeight: 500 }}> · {pendingCorr} pending</span>}</div>
              <button style={btn} onClick={() => setShowCorrectionForm((s) => !s)}>{showCorrectionForm ? "Cancel" : "+ Request correction"}</button>
            </div>

            {showCorrectionForm && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "10px 0", borderBottom: `1px solid ${c.line}`, marginBottom: 10 }}>
                <div style={{ flex: "0 1 140px" }}>
                  <label style={lbl}>Date</label>
                  <input style={inp} type="date" max={todayKey()} value={correctionDraft.target_date} onChange={(e) => setCorrectionDraft({ ...correctionDraft, target_date: e.target.value })} />
                </div>
                <div style={{ flex: "0 1 160px" }}>
                  <label style={lbl}>Issue</label>
                  <select style={inp} value={correctionDraft.issue} onChange={(e) => setCorrectionDraft({ ...correctionDraft, issue: e.target.value })}>
                    {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {correctionDraft.issue !== "other" && (
                  <div style={{ flex: "0 1 120px" }}>
                    <label style={lbl}>Correct time</label>
                    <input style={inp} type="time" value={correctionDraft.proposed_ts} onChange={(e) => setCorrectionDraft({ ...correctionDraft, proposed_ts: e.target.value })} />
                  </div>
                )}
                <div style={{ flex: "1 1 180px" }}>
                  <label style={lbl}>Reason</label>
                  <input style={inp} value={correctionDraft.reason_text} onChange={(e) => setCorrectionDraft({ ...correctionDraft, reason_text: e.target.value })} placeholder="e.g. Phone died before I could check out" />
                </div>
                <button style={btnPrimary} disabled={busy} onClick={submitCorrection}>Submit</button>
              </div>
            )}

            {corrections.length === 0 && !showCorrectionForm && <div style={{ fontSize: 12, color: c.hint }}>No requests yet.</div>}
            {corrections.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
                <div>
                  <span style={{ color: c.ink, fontWeight: 600 }}>{fmtDate(r.target_date)}</span>
                  <span style={{ color: c.muted, marginLeft: 8 }}>{ISSUE_LABEL[r.requested_change.issue] ?? r.requested_change.issue}</span>
                  {r.supervisor_remark && <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{r.supervisor_remark}</div>}
                </div>
                <Pill label={r.status} tone={STATUS_TONE[r.status]} />
              </div>
            ))}
          </section>
        </>
      )}

      {tab === "leave" && (
        <>
          {leaveMix.some((s) => s.value > 0) && (
            <section style={{ ...cardStyle, marginBottom: 14 }}>
              <Donut slices={leaveMix} title="Leave used this year" centerLabel="days" />
            </section>
          )}

          <div style={{ ...grid(200), marginBottom: 14 }}>
            {leaveBalance.length === 0 && <section style={cardStyle}><div style={{ fontSize: 12, color: c.hint }}>No leave types configured yet — ask your admin to set them up in Workforce → Leave &amp; Holidays.</div></section>}
            {leaveBalance.map((lb) => (
              <section key={lb.leave_type_id} style={cardStyle}>
                <div style={capStyle}>{lb.name}</div>
                <Stat value={String(lb.balance)} label={`of ${lb.quota} days left · ${lb.used} used`} tone={lb.balance <= 0 ? statusInk.bad : undefined} />
                <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{lb.category}</div>
              </section>
            ))}
          </div>

          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>My leave requests</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {leaveRequests.length > 0 && (
                  <select style={{ ...inp, width: "auto" }} value={leaveFilter} onChange={(e) => setLeaveFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                )}
                <button style={leaveBalance.length === 0 ? { ...btn, opacity: 0.5 } : btnPrimary} disabled={leaveBalance.length === 0} onClick={() => setShowLeaveForm((s) => !s)}>
                  {showLeaveForm ? "Cancel" : "+ Request leave"}
                </button>
              </div>
            </div>

            {showLeaveForm && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "10px 0", borderBottom: `1px solid ${c.line}`, marginBottom: 10 }}>
                <div style={{ flex: "1 1 150px" }}>
                  <label style={lbl}>Leave type</label>
                  <select style={inp} value={leaveDraft.leave_type_id} onChange={(e) => setLeaveDraft({ ...leaveDraft, leave_type_id: e.target.value })}>
                    <option value="">— select —</option>
                    {leaveBalance.map((lb) => <option key={lb.leave_type_id} value={lb.leave_type_id}>{lb.name} ({lb.balance} left)</option>)}
                  </select>
                </div>
                <div style={{ flex: "0 1 140px" }}><label style={lbl}>From</label><input style={inp} type="date" value={leaveDraft.date_from} onChange={(e) => setLeaveDraft({ ...leaveDraft, date_from: e.target.value })} /></div>
                <div style={{ flex: "0 1 140px" }}><label style={lbl}>To</label><input style={inp} type="date" value={leaveDraft.date_to} onChange={(e) => setLeaveDraft({ ...leaveDraft, date_to: e.target.value })} /></div>
                <div style={{ flex: "0 1 100px" }}>
                  <label style={lbl}>Half-day</label>
                  <select style={inp} value={leaveDraft.half_day ? "yes" : "no"} onChange={(e) => setLeaveDraft({ ...leaveDraft, half_day: e.target.value === "yes" })}>
                    <option value="no">No</option><option value="yes">Yes</option>
                  </select>
                </div>
                <div style={{ flex: "1 1 180px" }}><label style={lbl}>Reason</label><input style={inp} value={leaveDraft.reason_text} onChange={(e) => setLeaveDraft({ ...leaveDraft, reason_text: e.target.value })} placeholder="e.g. Family function" /></div>
                <button style={btnPrimary} disabled={busy} onClick={submitLeaveRequest}>Submit</button>
              </div>
            )}

            {visibleLeaveRequests.length === 0 && !showLeaveForm && (
              <div style={{ fontSize: 12, color: c.hint }}>{leaveFilter ? `No ${leaveFilter} requests.` : "No leave requests yet."}</div>
            )}
            {visibleLeaveRequests.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: c.ink, fontWeight: 600 }}>{r.wfm_leave_types?.name ?? "Leave"}</span>
                  <span style={{ color: c.muted, marginLeft: 8 }}>
                    {fmtDate(r.date_from)}{r.date_to !== r.date_from && ` – ${fmtDate(r.date_to)}`}{r.half_day && " (half-day)"}
                  </span>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{r.reason_text}</div>
                  {r.supervisor_remark && <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>Supervisor: {r.supervisor_remark}</div>}
                </div>
                <Pill label={r.status} tone={STATUS_TONE[r.status]} />
              </div>
            ))}
          </section>
        </>
      )}

      {tab === "calendar" && (
        <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Company holidays</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input style={{ ...inp, width: 180 }} placeholder="Search holiday…" value={holidayQuery} onChange={(e) => setHolidayQuery(e.target.value)} />
              <select style={{ ...inp, width: "auto" }} value={holidayFilter} onChange={(e) => setHolidayFilter(e.target.value as "upcoming" | "all")}>
                <option value="upcoming">Upcoming only</option>
                <option value="all">Whole year</option>
              </select>
            </div>
          </div>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Holiday</th><th style={th}>Applies to</th><th style={th}></th></tr></thead>
            <tbody>
              {visibleHolidays.map((h) => {
                const past = h.date < todayKey();
                return (
                  <tr key={h.id} style={{ opacity: past ? 0.5 : 1 }}>
                    <td style={{ ...td, color: c.ink, fontWeight: 600 }}>{new Date(h.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td style={td}>{h.name}</td>
                    <td style={{ ...td, color: c.muted }}>{h.applies_to === "all" ? "Everyone" : h.applies_to === "full_time" ? "Full-time" : "Contractors"}</td>
                    <td style={td}>{h.date === todayKey() ? <Pill label="Today" tone="green" /> : past ? <span style={{ color: c.hint, fontSize: 11 }}>past</span> : <span style={{ color: c.hint, fontSize: 11 }}>upcoming</span>}</td>
                  </tr>
                );
              })}
              {visibleHolidays.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={4}>{holidays.length === 0 ? "No holidays configured." : "No holidays match."}</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {tab === "analytics" && (
        analytics ? (
          <>
            <div style={{ ...grid(200), marginBottom: 14 }}>
              <section style={cardStyle}>
                <div style={capStyle}>On-time rate</div>
                <Stat
                  value={analytics.on_time_rate === null ? "—" : `${analytics.on_time_rate}%`}
                  label="of attended days this month"
                  tone={analytics.on_time_rate !== null && analytics.on_time_rate < 80 ? statusInk.warn : statusInk.good}
                />
              </section>
              <section style={cardStyle}>
                <div style={capStyle}>Hours vs last month</div>
                {analytics.previous ? (() => {
                  const diff = analytics.current.working_minutes - analytics.previous.working_minutes;
                  return <Stat value={`${diff >= 0 ? "+" : "−"}${fmtHM(Math.abs(diff))}`} label={`vs ${fmtMonth(analytics.previous.month)}`} tone={diff >= 0 ? statusInk.good : statusInk.warn} />;
                })() : <Stat value="—" label="no prior month" />}
              </section>
              <section style={cardStyle}>
                <div style={capStyle}>Days present</div>
                <Stat value={String(analytics.current.days_present)} label="this month" />
              </section>
              <section style={cardStyle}>
                <div style={capStyle}>Leave taken</div>
                <Stat value={String(analytics.current.paid_leave_days + analytics.current.unpaid_leave_days)} label={`${analytics.current.paid_leave_days} paid · ${analytics.current.unpaid_leave_days} unpaid`} />
              </section>
            </div>

            <section style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={capStyle}>Working hours — last 6 months</div>
              <Bars points={analytics.trend} valueOf={(p) => p.working_minutes} format={(n) => (n > 0 ? `${Math.round(n / 60)}h` : "0")} />
            </section>

            <section style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={capStyle}>Late marks — last 6 months</div>
              <Bars points={analytics.trend} valueOf={(p) => p.late_marks} format={(n) => String(n)} />
            </section>

            {analytics.team && (
              <section style={cardStyle}>
                <div style={capStyle}>Team this month · supervisor view</div>
                <div style={grid(150)}>
                  <Stat value={String(analytics.team.employee_count)} label="active employees" />
                  <Stat value={fmtHM(analytics.team.avg_working_minutes)} label="avg hours per employee" />
                  <Stat value={String(analytics.team.avg_days_present)} label="avg days present" />
                  <Stat value={String(analytics.team.avg_late_marks)} label="avg late marks" tone={analytics.team.avg_late_marks > 0 ? pillar.amber.fg : undefined} />
                  <Stat value={String(analytics.team.total_incomplete_days)} label="incomplete days (team)" tone={analytics.team.total_incomplete_days > 0 ? "#ef4444" : undefined} />
                </div>
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 12 }}>
                  Your own hours this month: {fmtHM(analytics.current.working_minutes)} · team average {fmtHM(analytics.team.avg_working_minutes)}.
                </div>
              </section>
            )}
          </>
        ) : <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading analytics…</div>
      )}
    </>
  );
}
