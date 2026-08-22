"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selfieRequiredFor, locationRequiredFor } from "@/lib/wfm/punchRules";
import LocationHelp from "@/components/wfm/LocationHelp";
import DeviceSetupCard from "@/components/wfm/DeviceSetupCard";
import FaceEnrollModal from "@/components/wfm/FaceEnrollModal";
import DayColumn from "@/components/wfm/DayColumn";
import { computeDayHours } from "@/lib/wfm/hours";
import { geoPermissionState } from "@/lib/wfm/devicePermissions";
import { useIsMobile } from "@/lib/useIsMobile";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import Donut from "@/components/Donut";
import MonthTimeline from "@/components/wfm/MonthTimeline";
import LeaveRangePicker, { type LeaveDayContext } from "@/components/wfm/LeaveRangePicker";
import PunchAudit from "@/components/wfm/PunchAudit";
import {
  allowedKinds, isOtKind, PUNCH_KIND_GROUP, PUNCH_KIND_LABEL,
  type PresenceKind, type PunchState, type LeaveRequestStatus,
} from "@/lib/wfm/types";
import { enqueuePunch, flushQueue, listQueuedPunches, listRejectedPunches, discardRejectedPunch, type QueuedPunch } from "@/lib/wfm/offlineQueue";
import { useIsNextgen3Layer } from "@/lib/tenant-context";
import { celebrate } from "@/lib/celebrate";

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
    phone?: string | null; employment_type?: string | null;
  } | null;
  is_supervisor: boolean;
  state: PunchState;
  today: { id: string; kind: PresenceKind; ts: string }[];
  running_minutes: number;
  break_minutes: number;
  home_site: { id: string; name: string } | null;
  shift: { name: string; start_time: string; end_time: string } | null;
  timezone: string;
  /** Optional punch-type groups this tenant has switched on. */
  punch_types?: { ot: boolean; mobile_work: boolean; business_trip: boolean };
  require_location?: boolean;
  selfie_mode?: "off" | "shift" | "all";
  employee_self_service?: boolean;
  passkey_login?: boolean;
  face_punch?: "off" | "kiosk";
  deduct_breaks?: boolean;
  face_enrolled?: boolean;
  upcoming: {
    date: string; is_day_off: boolean; shift_name: string | null;
    start_time: string | null; end_time: string | null; is_night_shift: boolean;
    source: "roster" | "standing"; note: string | null;
  }[];
  pending_rechecks: {
    id: string; target_date: string; recheck_type: "time" | "selfie" | "both";
    message: string; status: string; created_at: string;
  }[];
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
  ot_minutes: number; ot_pending_minutes: number;
  ot_segments: { start: string; end: string; minutes: number; status: string }[];
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
type Tab = "profile" | "home" | "time" | "timeline" | "leave" | "calendar" | "analytics";
type TimeView = "daily" | "monthly";

const LEAVE_INSIGHTS_LS_KEY = "bms_wfm_leave_insights";

// Attendance leads (client decision 2026-08-22): punching in and out is what
// the page is for -- the profile hub is a tab, not the landing.
const TABS: { key: Tab; label: string }[] = [
  { key: "home", label: "Attendance" },
  { key: "time", label: "Time" },
  { key: "leave", label: "Leave" },
  { key: "profile", label: "Profile" },
  { key: "timeline", label: "Timeline" },
  { key: "calendar", label: "Calendar" },
  { key: "analytics", label: "Analytics" },
];

const KIND_LABEL: Record<PresenceKind, string> = {
  check_in: "Check in", check_out: "Check out", break_start: "Break", break_end: "End break",
  ot_in: "OT in", ot_out: "OT out",
  mobile_work_start: "Mobile work", mobile_work_end: "End mobile work",
  business_trip_start: "Business trip", business_trip_end: "End business trip",
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

// Last /state payload, cached so the punch page can render offline (a cold
// open with no network -- the service worker serves the shell, this restores
// the punch state). Bump the suffix if MeState's shape changes.
const ME_CACHE_KEY = "wfm_me_state_v1";
function cacheMeState(state: unknown) {
  try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
}
function readCachedMeState(): MeState | null {
  try { const raw = localStorage.getItem(ME_CACHE_KEY); return raw ? (JSON.parse(raw) as MeState) : null; } catch { return null; }
}

// Pure -- hoisted out of the component so the memoised day rollups below can
// share one definition without re-creating it every render.
function dayLabel(d: DayRecord): string {
  if (d.holiday) return "Holiday";
  if (d.on_leave) return "Leave";
  if (d.is_week_off) return "Week off";
  if (d.incomplete) return "Incomplete";
  if (d.absent) return "Absent";
  if (d.late) return "Late";
  if (d.punches > 0) return "Present";
  return "—";
}

/** Why a fix could not be obtained. 1/2/3 mirror GeolocationPositionError. */
export type GeoFailure = "denied" | "unavailable" | "timeout" | "unsupported";

/**
 * The failure REASON is returned, not just null. Denied, "the device could
 * not get a fix" and "it took too long" need completely different advice --
 * sending someone indoors with poor GPS into their permission settings
 * wastes their time and leaves them still unable to punch.
 */
function getGeoResult(timeoutMs: number): Promise<{ geo: Geo; failure: GeoFailure | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ geo: null, failure: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ geo: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }, failure: null }),
      (err) => resolve({
        geo: null,
        failure: err.code === err.PERMISSION_DENIED ? "denied"
          : err.code === err.TIMEOUT ? "timeout"
          : "unavailable",
      }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

async function getGeo(timeoutMs: number): Promise<Geo> {
  return (await getGeoResult(timeoutMs)).geo;
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** One expandable profile tile in the portal Home hub. */
function ProfileTile({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle: string; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "15px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 650, color: c.ink }}>{title}</span>
          <span style={{ display: "block", fontSize: 12, color: c.muted, marginTop: 2 }}>{subtitle}</span>
        </span>
        <span aria-hidden style={{ color: c.hint, fontSize: 15, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>›</span>
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: `1px solid ${c.line}` }}>
      <span style={{ fontSize: 12.5, color: c.muted }}>{label}</span>
      <span style={{ fontSize: 12.5, color: c.ink, fontWeight: 550, textAlign: "right" }}>{value}</span>
    </div>
  );
}

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

export default function MeClient({ initialState = null }: { initialState?: MeState | null }) {
  const [faceEnrollOpen, setFaceEnrollOpen] = useState(false);
  // Profile hub (portal Home): which tile is expanded, plus the change-password
  // form state used inside the Account settings tile.
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkMsg, setPkMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Engagement layer (3-layer theme only): checking out at/after your
  // shift's end earns a full-shift celebration. Judged on wall-clock in
  // the tenant's timezone against the assigned shift, never on pay math.
  const celebrateShift = useIsNextgen3Layer();
  const [tab, setTab] = useState<Tab>("home");
  const isMobile = useIsMobile();
  // Mobile-only: the Time tab's two charts, collapsed until asked for.
  const [showCharts, setShowCharts] = useState(false);
  const [timeView, setTimeView] = useState<TimeView>("daily");
  const [month, setMonth] = useState(thisMonth());
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [leaveFilter, setLeaveFilter] = useState<string>("");
  // Balance donut + per-type cards are an INSIGHT, not the point of the tab --
  // they were pushing the actual requests (and "+ Request leave") below the
  // fold. Collapsed by default, same toggle pattern as the object lists;
  // the headline numbers stay on the collapsed row so nothing is really lost.
  const [leaveInsightsOpen, setLeaveInsightsOpen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(LEAVE_INSIGHTS_LS_KEY) === "1") setLeaveInsightsOpen(true); } catch { /* ignore */ }
  }, []);
  function toggleLeaveInsights() {
    setLeaveInsightsOpen((v) => {
      try { localStorage.setItem(LEAVE_INSIGHTS_LS_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }
  const [holidayFilter, setHolidayFilter] = useState<"upcoming" | "all">("upcoming");
  const [holidayQuery, setHolidayQuery] = useState("");
  // Seeded from the page's server render when available (see
  // lib/wfm/meState.ts) so the punch tile paints real data at hydration
  // instead of waiting for a post-load fetch; the ref makes the mount
  // effect skip the redundant /state refetch exactly once.
  const [me, setMe] = useState<MeState | null>(initialState);

  // Live clock so the running total climbs on its own (ADP-style) instead of
  // freezing at the value the server computed on load. Starts at 0 so the
  // server render and first client paint agree (no hydration mismatch on a
  // time-derived number); the effect stamps the real time on mount and ticks
  // every 15s while the shift is open.
  const meActive = me?.state === "in" || me?.state === "break" || me?.state === "ot";
  const [liveNow, setLiveNow] = useState(0);
  useEffect(() => {
    setLiveNow(Date.now());
    if (!meActive) return;
    const id = setInterval(() => setLiveNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [meActive]);
  const liveHours = me && liveNow > 0
    ? computeDayHours(me.today as { kind: PresenceKind; ts: string }[], new Date(liveNow))
    : null;
  const liveWorked = liveHours
    ? (me?.deduct_breaks === false ? liveHours.gross_minutes : liveHours.net_minutes)
    : (me?.running_minutes ?? 0);
  const liveBreak = liveHours ? liveHours.break_minutes : (me?.break_minutes ?? 0);
  const serverSeeded = useRef(initialState != null);
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
  // The punch that was refused for location, so "Try again" resumes it.
  const [locationBlocked, setLocationBlocked] = useState<PresenceKind | null>(null);
  const [locationFailure, setLocationFailure] = useState<GeoFailure | null>(null);
  const [locationCheckedAt, setLocationCheckedAt] = useState<Date | null>(null);
  // True when /state couldn't be reached but we're rendering a cached snapshot
  // -- the punch UI still works and punches queue for later sync.
  const [offline, setOffline] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [rejectedPunches, setRejectedPunches] = useState<QueuedPunch[]>([]);
  const [cameraFor, setCameraFor] = useState<PresenceKind | null>(null);
  // ADP-style: one punch-type dropdown + one action button, instead of a
  // button per action. Options are the transitions the state machine allows
  // right now, minus any optional group the tenant hasn't switched on.
  const [selectedKind, setSelectedKind] = useState<PresenceKind | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState({ target_date: todayKey(), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [recheckResponse, setRecheckResponse] = useState("");
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [correctionFromRecheckId, setCorrectionFromRecheckId] = useState<string | null>(null);
  const [leaveDraft, setLeaveDraft] = useState({ leave_type_id: "", date_from: todayKey(), date_to: todayKey(), half_day: false, reason_text: "" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadSecondary = useCallback(async () => {
    try {
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
      // Secondary data (timesheet, holidays, ...) is optional -- offline, just
      // flag it; never blank the page over it, /state already succeeded.
      setOffline(true);
    }
  }, [month]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/me/state");
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? "Could not load"); return; }
      setMe(json);
      setLoadError("");
      setOffline(false);
      cacheMeState(json);
      if (!json.employee?.consent_recorded_at) return;
      await loadSecondary();
    } catch {
      // No network: fall back to the last state cached while online so the
      // punch UI still renders and punches queue. Only hard-fail if this
      // device has never loaded the page online.
      const cached = readCachedMeState();
      if (cached) { setMe(cached); setOffline(true); setLoadError(""); }
      else setLoadError("You're offline — connect once to load your workforce page, then it works offline.");
    }
  }, [loadSecondary]);

  const trySync = useCallback(async () => {
    try {
      const { synced, remaining } = await flushQueue();
      setQueuedCount(remaining);
      setRejectedPunches(await listRejectedPunches());
      if (synced > 0) await load();
    } catch { /* still offline */ }
  }, [load]);

  useEffect(() => {
    if (serverSeeded.current) {
      // First mount with server-rendered state: the /state payload is
      // already on screen, only the secondary tabs' data needs fetching.
      // Later re-runs (month change regenerates load()) refetch fully.
      serverSeeded.current = false;
      if (initialState) cacheMeState(initialState);
      if (initialState?.employee?.consent_recorded_at) loadSecondary();
    } else {
      load();
    }
    listQueuedPunches().then((q) => setQueuedCount(q.filter((e) => !e.rejected).length)).catch(() => {});
    listRejectedPunches().then(setRejectedPunches).catch(() => {});
    trySync();
    const onOnline = () => trySync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, loadSecondary, trySync, initialState]);

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
    // Breaks get a shorter best-effort window UNLESS location is mandated --
    // then they deserve the same full budget as a check-in, since a timeout
    // now means a rejected punch instead of a tolerated blank.
    const isBreak = kind === "break_start" || kind === "break_end";
    const geo = await getGeo(isBreak && !me?.require_location ? 5000 : 10_000);
    try {
      const res = await fetch("/api/wfm/punch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind, ts, geo }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Punch failed" }); return; }
      const where = json.site_name ? `at ${json.site_name}` : json.within_geofence === false ? "— location noted" : "";
      setNotice({ tone: json.within_geofence === false ? "warn" : "ok", text: `${KIND_LABEL[kind]} recorded at ${fmtTime(ts)} ${where}.` });
      // Full-shift celebration: checked out at/after the shift's scheduled
      // end (tenant-tz wall clock; a night shift's end is "after end and
      // before next start"). Needs a real day behind it (>= 1h on the clock)
      // so a stray in/out pair doesn't throw a party.
      if (celebrateShift && kind === "check_out" && me?.shift && (json.running_minutes ?? 0) >= 60) {
        const hm = (v: string) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; };
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: me.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
        const now = hm(parts);
        const start = hm(me.shift.start_time), end = hm(me.shift.end_time);
        const fullShift = start < end ? now >= end : (now >= end && now < start);
        if (fullShift) celebrate("Full shift complete!", `${fmtHM(json.running_minutes)} on the clock — well done. See you tomorrow.`);
      }
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
        setQueuedCount((await listQueuedPunches()).filter((e) => !e.rejected).length);
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
        body: JSON.stringify({
          ...correctionDraft, proposed_ts, reason_text: correctionDraft.reason_text.trim(),
          recheck_request_id: correctionFromRecheckId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Could not submit" }); return; }
      setShowCorrectionForm(false);
      setCorrectionDraft({ target_date: todayKey(), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
      setCorrectionFromRecheckId(null);
      setNotice({ tone: "ok", text: "Correction request submitted — your supervisor will review it." });
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function respondToRecheck(id: string) {
    if (!recheckResponse.trim()) { setNotice({ tone: "err", text: "Please add a reply first" }); return; }
    setRecheckBusy(true);
    try {
      const res = await fetch(`/api/wfm/recheck-requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "respond", employee_response_text: recheckResponse.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Could not send" }); return; }
      setRespondingTo(null);
      setRecheckResponse("");
      setNotice({ tone: "ok", text: "Reply sent to your supervisor." });
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error" });
    } finally {
      setRecheckBusy(false);
    }
  }

  // What each date already carries, so the leave calendar can mark it --
  // holidays and any day already covered by a non-rejected request of this
  // employee's own. (Team-wide availability would need its own endpoint;
  // this is the employee's own view.)
  const leaveDayContext = useMemo(() => {
    const map: Record<string, LeaveDayContext> = {};
    for (const h of holidays) {
      map[h.date] = { ...(map[h.date] ?? {}), holiday: h.name };
    }
    for (const r of leaveRequests) {
      if (r.status === "rejected") continue;
      for (let d = new Date(`${r.date_from}T00:00:00`); d <= new Date(`${r.date_to}T00:00:00`); d.setDate(d.getDate() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        map[key] = { ...(map[key] ?? {}), existingLeave: r.wfm_leave_types?.name ?? "Leave" };
      }
    }
    return map;
  }, [holidays, leaveRequests]);

  // ── Derived rollups ───────────────────────────────────────────────────────
  // These loop over the month's days / the holiday & leave lists, so without
  // memoisation they re-ran on EVERY render -- including every keystroke in an
  // unrelated search box, and on every tab even when the data isn't shown.
  // Placed above the early returns below so they're unconditional hooks.
  const elapsedDays = useMemo(() => days.filter((d) => d.date <= todayKey()), [days]);

  // Single pass over elapsedDays instead of one filter per status label (was
  // 7 full passes -- ~210 dayLabel() calls -- every render).
  const dayMix = useMemo(() => {
    const order = [
      { label: "Present", color: pillar.green.base },
      { label: "Late", color: pillar.amber.base },
      { label: "Absent", color: pillar.red.base },
      { label: "Leave", color: pillar.purple.base },
      { label: "Holiday", color: pillar.blue.base },
      { label: "Week off", color: pillar.teal.base },
      { label: "Incomplete", color: pillar.red.base },
    ];
    const counts: Record<string, number> = {};
    for (const d of elapsedDays) counts[dayLabel(d)] = (counts[dayLabel(d)] ?? 0) + 1;
    return order.map((s) => ({ ...s, value: counts[s.label] ?? 0 }));
  }, [elapsedDays]);

  const { workedMinutes, breakMinutes, hoursMix } = useMemo(() => {
    const worked = elapsedDays.reduce((s, d) => s + (deductBreaks ? d.net_minutes : d.gross_minutes), 0);
    const brk = elapsedDays.reduce((s, d) => s + d.break_minutes, 0);
    return {
      workedMinutes: worked,
      breakMinutes: brk,
      hoursMix: [
        { label: "Worked", value: Math.round(worked / 60), color: pillar.green.base },
        { label: "Breaks", value: Math.round(brk / 60), color: pillar.amber.base },
      ],
    };
  }, [elapsedDays, deductBreaks]);

  const visibleDays = useMemo(
    () => elapsedDays.filter((d) => !dayFilter || dayLabel(d) === dayFilter).slice().reverse(),
    [elapsedDays, dayFilter]
  );

  const leaveMix = useMemo(
    () => leaveBalance.map((lb, i) => ({
      label: lb.name,
      value: lb.used,
      color: [pillar.purple.base, pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.green.base][i % 5],
    })),
    [leaveBalance]
  );

  const upcoming = useMemo(
    () => holidays.filter((h) => h.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)),
    [holidays]
  );

  const visibleHolidays = useMemo(() => {
    const hq = holidayQuery.trim().toLowerCase();
    return holidays.filter((h) => {
      if (holidayFilter === "upcoming" && h.date < todayKey()) return false;
      return !hq || h.name.toLowerCase().includes(hq);
    });
  }, [holidays, holidayFilter, holidayQuery]);

  const visibleLeaveRequests = useMemo(
    () => (leaveFilter ? leaveRequests.filter((r) => r.status === leaveFilter) : leaveRequests),
    [leaveRequests, leaveFilter]
  );

  const { pendingLeave, pendingCorr } = useMemo(() => ({
    pendingLeave: leaveRequests.filter((r) => r.status === "pending").length,
    pendingCorr: corrections.filter((r) => r.status === "pending").length,
  }), [leaveRequests, corrections]);

  async function submitLeaveRequest() {
    if (!leaveDraft.date_from || !leaveDraft.date_to) { setNotice({ tone: "err", text: "Please pick the dates on the calendar" }); return; }
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

  // Only hard-stop when there's genuinely nothing to show. Offline WITH a
  // cached snapshot keeps loadError empty and renders the punch UI instead.
  if (loadError && !me) return <div style={{ ...cardStyle, color: statusInk.bad, fontSize: 13 }}>{loadError}</div>;
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
  const nextHoliday = upcoming[0] ?? null;

  // Which punch types are offered right now: the state machine decides what
  // is legal from the current state (this is also what stops OT from being
  // punched between a check-in and a check-out -- `ot` is only reachable
  // from `out`), and the tenant's punch_types config decides which optional
  // groups are visible at all.
  const enabledPunchTypes = me.punch_types ?? { ot: false, mobile_work: false, business_trip: false };
  const punchOptions = allowedKinds(me.state as PunchState).filter((k) => {
    const group = PUNCH_KIND_GROUP[k];
    return !group || enabledPunchTypes[group];
  });
  const activeKind = selectedKind && punchOptions.includes(selectedKind) ? selectedKind : punchOptions[0] ?? null;

  // Supervisor-managed workforce (client decision 2026-08-21): when a tenant
  // turns employee self-service off, employees no longer punch from their
  // own phone or self-enroll their face -- attendance is captured at the
  // office kiosk by face, and a supervisor enrolls them. The Me page still
  // shows their hours and today's shape (read-only), and Leave/Correction
  // stay available. Defaults on, so every existing tenant is unchanged.
  const selfService = me.employee_self_service !== false;

  async function changePassword() {
    if (!pwCur || pwNew.length < 8) return;
    setPwBusy(true);
    setPwMsg(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: pwCur, new_password: pwNew }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setPwMsg({ tone: "err", text: json.error ?? "Could not change your password." }); return; }
      setPwMsg({ tone: "ok", text: "Password changed." });
      setPwCur("");
      setPwNew("");
    } finally {
      setPwBusy(false);
    }
  }

  async function addPasskey() {
    setPkBusy(true);
    setPkMsg(null);
    try {
      const optRes = await fetch("/api/auth/passkey/register-options", { method: "POST" });
      const options = await optRes.json();
      if (!optRes.ok) { setPkMsg({ tone: "err", text: options.error ?? "Passkeys aren't available." }); return; }

      const { startRegistration } = await import("@simplewebauthn/browser");
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: options });
      } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "InvalidStateError") {
          setPkMsg({ tone: "ok", text: "This device already has a passkey for your account." });
        } else if (name !== "NotAllowedError" && name !== "AbortError") {
          setPkMsg({ tone: "err", text: "This device or browser doesn't support passkeys." });
        }
        return;
      }

      const ua = navigator.userAgent;
      const label = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "This device";
      const verRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, device_label: label }),
      });
      const json = await verRes.json().catch(() => ({}));
      if (!verRes.ok) { setPkMsg({ tone: "err", text: json.error ?? "Could not save the passkey." }); return; }
      setPkMsg({ tone: "ok", text: "Passkey added — next time, sign in with Face ID / fingerprint from the login screen." });
    } catch {
      setPkMsg({ tone: "err", text: "Network error — try again." });
    } finally {
      setPkBusy(false);
    }
  }

  async function logout() {
    await createBrowserSupabase().auth.signOut().catch(() => {});
    window.location.href = "/login";
  }

  function punchTone(kind: PresenceKind | null): string {
    if (!kind) return c.accent;
    if (kind === "check_in") return "#10b981";
    if (kind === "check_out") return "#ef4444";
    if (isOtKind(kind)) return "#7f77dd";
    return c.accent;
  }

  async function startPunch(kind: PresenceKind, opts?: { ask?: boolean }) {
    // Location is checked BEFORE the camera opens. Doing it the other way
    // round means taking a selfie and only then being told the punch can't
    // happen -- and the punch route rejects it anyway, so the camera step
    // would have been wasted. A denied permission needs a browser-settings
    // change, so the message says that rather than just "try again".
    // Which kinds the mandate covers (shift punches + breaks) is the shared
    // rule the punch route enforces -- lib/wfm/punchRules.
    if (locationRequiredFor(kind) && me?.require_location) {
      // Never fire the browser prompt cold. A reflexive "Deny" here is
      // permanent and costs an OS-settings trip plus a reload to undo, so
      // the first ask is always preceded by one line explaining it -- and
      // if they aren't ready, dismissing OUR panel records no refusal.
      if (!opts?.ask && (await geoPermissionState()) === "prompt") {
        setNotice(null);
        setLocationFailure(null);
        setLocationCheckedAt(null);
        setLocationBlocked(kind);
        return;
      }
      setBusy(true);
      const { geo, failure } = await getGeoResult(10_000);
      setBusy(false);
      if (!geo) {
        setLocationFailure(failure);
        setLocationCheckedAt(new Date());
        // The panel below explains how to turn it back on for THIS device
        // and retries the same punch, so the worker never has to remember
        // which button they were on.
        setNotice(null);
        setLocationBlocked(kind);
        return;
      }
      setLocationBlocked(null);
      setLocationCheckedAt(null);
    }

    // Which kinds need a selfie is the tenant's setting now, not a
    // hardcoded list -- and it is shared with the punch route rather than
    // duplicated (lib/wfm/punchRules).
    if (selfieRequiredFor(kind, me?.selfie_mode ?? "shift")) {
      openCamera(kind);
    } else {
      submitPunch(kind, null);
    }
  }

  // The punch card is one tile among several, and check in/out happens
  // straight from it -- no separate punch screen (the ADP pattern the
  // client asked for).
  const punchTile = (
    <section className="stat-tile" style={{ ...cardStyle, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <div style={capStyle}>Punch</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{fmtHM(liveWorked)}</div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
          {me.state === "out" && me.today.length === 0 && "Not checked in yet"}
          {me.state === "out" && me.today.length > 0 && "Checked out for today"}
          {me.state === "in" && "You're checked in"}
          {me.state === "break" && "On break"}
          {me.state === "ot" && "On overtime"}
          {liveBreak > 0 && ` · breaks ${fmtHM(liveBreak)}`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
        {!selfService ? (
          <span style={{ fontSize: 12, color: c.hint, lineHeight: 1.5 }}>
            Punch in and out at the office kiosk — it recognises you by face, no phone needed. Your hours here update automatically.
          </span>
        ) : punchOptions.length === 0 ? (
          <span style={{ fontSize: 12, color: c.hint }}>No punch action available right now.</span>
        ) : (
          <>
            <select
              value={activeKind ?? ""}
              onChange={(e) => setSelectedKind(e.target.value as PresenceKind)}
              disabled={busy}
              style={{
                padding: "11px 12px", borderRadius: 8, border: `1px solid ${c.line}`,
                background: c.panel, color: c.ink, fontSize: 13.5, fontWeight: 600,
                outline: "none", cursor: "pointer", minWidth: 170,
              }}
            >
              {punchOptions.map((k) => (
                <option key={k} value={k}>{PUNCH_KIND_LABEL[k]}</option>
              ))}
            </select>
            <button
              style={{ ...btnPrimary, background: punchTone(activeKind), padding: "12px 24px", fontSize: 14 }}
              disabled={busy || !activeKind}
              onClick={() => activeKind && startPunch(activeKind)}
            >
              {busy ? "Working…" : "Punch"}
            </button>
          </>
        )}
      </div>
    </section>
  );

  return (
    <>
      {/* On a phone, 7 tab buttons wrap into a two-row wall. Show the four
          everyday tabs and club the rest (Timeline / Calendar / Analytics)
          into one native "More" dropdown -- one row, no wrapping. */}
      <div style={{ display: "flex", gap: isMobile ? 5 : 7, marginBottom: 14, flexWrap: isMobile ? "nowrap" : "wrap", alignItems: "center", overflowX: isMobile ? "auto" : undefined }}>
        {(isMobile ? TABS.filter((t) => ["home", "time", "leave", "profile"].includes(t.key)) : TABS).map((t) => {
          const compact = isMobile ? { padding: "7px 10px", fontSize: 12, whiteSpace: "nowrap" as const } : {};
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={tab === t.key
                ? { ...btn, ...compact, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" }
                : { ...btn, ...compact }}
            >
              {t.label}
              {t.key === "leave" && pendingLeave > 0 && <span style={{ marginLeft: 6, opacity: 0.85 }}>({pendingLeave})</span>}
            </button>
          );
        })}
        {isMobile && (
          <select
            value={["timeline", "calendar", "analytics"].includes(tab) ? tab : ""}
            onChange={(e) => { if (e.target.value) setTab(e.target.value as Tab); }}
            style={{
              padding: "7px 8px", fontSize: 12, fontWeight: 600, borderRadius: 8,
              border: `1px solid ${c.line}`, cursor: "pointer", outline: "none",
              background: ["timeline", "calendar", "analytics"].includes(tab) ? "var(--tenant-accent, #378ADD)" : c.panel,
              color: ["timeline", "calendar", "analytics"].includes(tab) ? "#fff" : c.ink,
            }}
          >
            <option value="" disabled>More…</option>
            <option value="timeline">Timeline</option>
            <option value="calendar">Calendar</option>
            <option value="analytics">Analytics</option>
          </select>
        )}
      </div>

      {offline && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: statusInk.warn, display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-hidden>●</span>
          <span>
            You&apos;re offline — showing your last synced status. You can still punch;
            it&apos;s saved on this device and syncs automatically when you&apos;re back online
            {queuedCount > 0 ? ` (${queuedCount} waiting)` : ""}.
          </span>
        </div>
      )}

      {/* Global feedback for actions from ANY tab (punch, correction, leave
          request, recheck reply) -- this used to live inside the Home tab's
          punch tile only, so a leave-request error/success on the Leave tab
          was set but never rendered anywhere the user could see it. */}
      {notice && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: toneColor[notice.tone] }}>{notice.text}</div>
      )}

      {locationBlocked && (
        <div style={{ marginBottom: 14 }}>
          <LocationHelp
            failure={locationFailure}
            checkedAt={locationCheckedAt}
            retrying={busy}
            onDismiss={() => { setLocationBlocked(null); setLocationCheckedAt(null); }}
            onRetry={() => { void startPunch(locationBlocked, { ask: true }); }}
          />
        </div>
      )}

      {queuedCount > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.warn, fontSize: 12.5 }}>{queuedCount} punch(es) pending sync</div>
      )}

      {rejectedPunches.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, borderLeft: `3px solid ${statusInk.bad}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: statusInk.bad, marginBottom: 6 }}>
            {rejectedPunches.length} offline punch{rejectedPunches.length === 1 ? "" : "es"} could not be recorded
          </div>
          {rejectedPunches.map((rp) => (
            <div key={rp.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, color: c.ink, padding: "4px 0" }}>
              <span>
                <strong>{KIND_LABEL[rp.kind] ?? rp.kind}</strong>{" "}
                <span style={{ color: c.muted }}>
                  {new Date(rp.ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" — "}{rp.rejected?.reason}
                </span>
              </span>
              <button
                style={{ ...btn, fontSize: 11.5, padding: "5px 10px" }}
                onClick={async () => { await discardRejectedPunch(rp.id); setRejectedPunches(await listRejectedPunches()); }}
              >Dismiss</button>
            </div>
          ))}
          <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>
            These were captured offline but the server declined them (usually too old to accept). File a correction from the Time tab if you need them counted.
          </div>
        </div>
      )}

      {me.pending_rechecks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {me.pending_rechecks.map((rq) => (
            <section key={rq.id} style={{ ...cardStyle, borderLeft: `3px solid ${statusInk.warn}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>
                    ⚑ Your supervisor flagged your {rq.recheck_type === "both" ? "time and selfie" : rq.recheck_type} for {rq.target_date} — please review
                  </div>
                  <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4 }}>&ldquo;{rq.message}&rdquo;</div>
                </div>
              </div>
              {respondingTo === rq.id ? (
                <div style={{ marginTop: 12 }}>
                  <textarea
                    value={recheckResponse}
                    onChange={(e) => setRecheckResponse(e.target.value)}
                    rows={2}
                    placeholder="Reply to your supervisor…"
                    style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, resize: "vertical", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button style={{ ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" }} disabled={recheckBusy} onClick={() => respondToRecheck(rq.id)}>
                      {recheckBusy ? "Sending…" : "Send reply"}
                    </button>
                    <button
                      style={btn}
                      onClick={() => {
                        setRespondingTo(null);
                        setShowCorrectionForm(true);
                        setCorrectionDraft((d) => ({ ...d, target_date: rq.target_date }));
                        setCorrectionFromRecheckId(rq.id);
                        setTab("time");
                      }}
                    >
                      File a correction instead
                    </button>
                    <button style={btn} onClick={() => { setRespondingTo(null); setRecheckResponse(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button style={{ ...btn, marginTop: 12 }} onClick={() => { setRespondingTo(rq.id); setRecheckResponse(""); }}>
                  Respond
                </button>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === "profile" && me?.employee && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
          {/* Identity header — name, avatar, and the employee-ID badge. */}
          <section style={{ ...cardStyle, display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 54, height: 54, borderRadius: "50%", flexShrink: 0,
              background: "var(--tenant-accent, #378ADD)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700,
            }}>
              {initials(me.employee.full_name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: c.ink }}>{me.employee.full_name}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
                {me.employee.employee_code && (
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, color: "var(--tenant-accent, #378ADD)",
                    background: "color-mix(in srgb, var(--tenant-accent, #378ADD) 13%, transparent)",
                    padding: "2px 10px", borderRadius: 999,
                  }}>
                    #ID {me.employee.employee_code}
                  </span>
                )}
                {me.employee.wfm_role === "supervisor" && <Pill label="Supervisor" tone="purple" />}
              </div>
            </div>
          </section>

          <ProfileTile
            title="Personal Info"
            subtitle="Your contact details"
            open={openTile === "personal"}
            onToggle={() => setOpenTile(openTile === "personal" ? null : "personal")}
          >
            <KV label="Full name" value={me.employee.full_name} />
            <KV label="Employee ID" value={me.employee.employee_code ?? "—"} />
            <KV label="Phone" value={me.employee.phone || "—"} />
          </ProfileTile>

          <ProfileTile
            title="Employment Information"
            subtitle="Role, shift and site"
            open={openTile === "employment"}
            onToggle={() => setOpenTile(openTile === "employment" ? null : "employment")}
          >
            <KV label="Role" value={me.employee.wfm_role === "supervisor" ? "Supervisor" : "Employee"} />
            <KV label="Employment type" value={me.employee.employment_type ? me.employee.employment_type.replace(/_/g, " ") : "—"} />
            <KV label="Shift" value={me.shift ? `${me.shift.name} (${me.shift.start_time.slice(0, 5)}–${me.shift.end_time.slice(0, 5)})` : "—"} />
            <KV label="Site" value={me.home_site?.name ?? "—"} />
          </ProfileTile>

          <ProfileTile
            title="Account Settings"
            subtitle="Change your password or sign out"
            open={openTile === "account"}
            onToggle={() => setOpenTile(openTile === "account" ? null : "account")}
          >
            <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ ...capStyle, marginBottom: 5 }}>Current password</label>
                <input
                  type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)}
                  placeholder="Current password" autoComplete="current-password"
                  style={{ width: "100%", padding: "9px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, boxSizing: "border-box", outline: "none" }}
                />
              </div>
              <div>
                <label style={{ ...capStyle, marginBottom: 5 }}>New password</label>
                <input
                  type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)}
                  placeholder="At least 8 characters" autoComplete="new-password"
                  style={{ width: "100%", padding: "9px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, boxSizing: "border-box", outline: "none" }}
                />
              </div>
              {pwMsg && (
                <div style={{ fontSize: 12.5, color: pwMsg.tone === "ok" ? statusInk.good : statusInk.bad }}>{pwMsg.text}</div>
              )}
              <div>
                <button style={{ ...btnPrimary }} disabled={pwBusy || !pwCur || pwNew.length < 8} onClick={changePassword}>
                  {pwBusy ? "Saving…" : "Change password"}
                </button>
              </div>
              {me.passkey_login && (
                <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12, marginTop: 2 }}>
                  <div style={{ fontSize: 12, color: c.muted, marginBottom: 8, lineHeight: 1.5 }}>
                    Add a passkey to sign in with this phone&apos;s Face ID or fingerprint — no password to type.
                  </div>
                  <button style={btn} disabled={pkBusy} onClick={addPasskey}>
                    {pkBusy ? "Waiting for your device…" : "✦ Add a passkey"}
                  </button>
                  {pkMsg && (
                    <div style={{ fontSize: 12.5, color: pkMsg.tone === "ok" ? statusInk.good : statusInk.bad, marginTop: 8 }}>{pkMsg.text}</div>
                  )}
                </div>
              )}
              <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12, marginTop: 2 }}>
                <button style={{ ...btn, color: statusInk.bad, borderColor: "transparent" }} onClick={logout}>
                  Sign out
                </button>
              </div>
            </div>
          </ProfileTile>
        </div>
      )}

      {tab === "home" && me?.employee && (
        <DeviceSetupCard needsLocation={me.require_location === true} />
      )}

      {/* Self-service face enrollment (client decision 2026-08-20):
          employees with logins set up their own face here; the door kiosk
          then recognizes them from this same enrollment. Disappears once
          enrolled. */}
      {tab === "home" && selfService && me?.employee && me.face_punch === "kiosk" && !me.face_enrolled && (
        <section style={{ ...cardStyle, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Set up face punch</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.5 }}>
              Enroll your face once from your own login, and you can punch in and out on the office kiosk — no phone needed at the door.
            </div>
          </div>
          <button
            style={{
              padding: "9px 16px", fontSize: 12.5, fontWeight: 650, borderRadius: 8, border: "none",
              background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer",
            }}
            onClick={() => setFaceEnrollOpen(true)}
          >
            Set up
          </button>
        </section>
      )}

      {faceEnrollOpen && me?.employee && (
        <FaceEnrollModal
          self
          employeeId={me.employee.id}
          employeeName={me.employee.full_name}
          onClose={() => setFaceEnrollOpen(false)}
          onDone={() => void load()}
        />
      )}

      {tab === "home" && (
        <>
          {/* Home is deliberately just the two things you came here to do and
              see: punch, and today's shape. Month totals, leave, holidays and
              the roster live on their own tabs (and the Analytics tab carries
              the at-a-glance summary). Punch and the day column sit side by
              side on desktop and stack on a phone. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginBottom: 14, alignItems: "stretch" }}>
            {punchTile}

            {me.today.length > 0 && (
              <section style={cardStyle}>
                <div style={capStyle}>Your day</div>
                <div style={{ marginTop: 16, paddingBottom: 6 }}>
                  <DayColumn events={me.today} now={liveNow} workedMinutes={liveWorked} breakMinutes={liveBreak} />
                </div>
              </section>
            )}
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

      {tab === "timeline" && (
        <>
          <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...inp, width: "auto" }} type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />
            <span style={{ fontSize: 11.5, color: c.hint }}>
              One row per day on a 24-hour axis. Click any day for its punches, or to raise a correction.
            </span>
          </div>
          <section style={{ ...cardStyle, overflowX: "auto" }}>
            <MonthTimeline
              days={days}
              month={month}
              pendingCorrectionDates={corrections.filter((cr) => cr.status === "pending").map((cr) => cr.target_date)}
              onRequestCorrection={(date) => {
                setCorrectionDraft({ target_date: date, issue: "missing_check_out", proposed_ts: "", reason_text: "" });
                setShowCorrectionForm(true);
                setTab("time");
              }}
            />
          </section>
        </>
      )}

      {tab === "time" && (
        <>
          <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <button style={timeView === "daily" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setTimeView("daily")}>{isMobile ? "Daily" : "Daily — detailed"}</button>
            <button style={timeView === "monthly" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setTimeView("monthly")}>{isMobile ? "Monthly" : "Monthly summary"}</button>
            <input style={{ ...inp, width: "auto" }} type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />
            {isMobile && (
              <button style={btn} onClick={() => setShowCharts((v) => !v)} aria-expanded={showCharts}>
                {showCharts ? "Hide charts" : "Charts ▾"}
              </button>
            )}
          </div>

          {/* Phone: the two donuts are half a screen each -- behind a toggle,
              so the actual daily record is the first thing on the tab. */}
          {(!isMobile || showCharts) && (
            <div style={{ ...grid(300), marginBottom: 14 }}>
              <section style={cardStyle}>
                <Donut slices={dayMix} title="How your month is going" centerLabel="days" selected={dayFilter} onSelect={setDayFilter} />
              </section>
              <section style={cardStyle}>
                <Donut slices={hoursMix} title={`Hours split — ${deductBreaks ? "breaks deducted" : "breaks included"}`} centerLabel="hours" />
              </section>
            </div>
          )}

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
              {/* Phone: 8 columns forced a sideways scroll. Club to four --
                  Date, In–Out (sessions on one line each), Worked, Status;
                  break detail stays on desktop and in the charts. */}
              <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {isMobile ? (
                      <>
                        <th style={th}>Date</th><th style={th}>In – Out</th>
                        <th style={th}>Worked</th><th style={th}>Status</th>
                      </>
                    ) : (
                      <>
                        <th style={th}>Date</th><th style={th}>In</th><th style={th}>Out</th>
                        <th style={th}>Breaks taken</th><th style={th}>Break total</th>
                        <th style={th}>Gross</th><th style={th}>Total worked</th><th style={th}>Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.map((d) => {
                    const statusCell = (
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
                    );
                    if (isMobile) {
                      return (
                        <tr key={d.date}>
                          <td style={{ ...td, color: c.ink, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDate(d.date)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap", verticalAlign: "top", fontSize: 12 }}>
                            {d.sessions.length === 0 ? "—" : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                {d.sessions.map((s) => (
                                  <span key={s.in}>
                                    {fmtTime(s.in)} – {s.out ? fmtTime(s.out) : <span style={{ color: statusInk.bad }}>missing</span>}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: c.ink, verticalAlign: "top" }}>
                            {d.punches > 0 ? fmtHM(deductBreaks ? d.net_minutes : d.gross_minutes) : "—"}
                          </td>
                          {statusCell}
                        </tr>
                      );
                    }
                    return (
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
                      {statusCell}
                    </tr>
                    );
                  })}
                  {visibleDays.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={isMobile ? 4 : 8}>{dayFilter ? `No "${dayFilter}" days this month.` : "No records this month."}</td></tr>}
                </tbody>
                {monthTotals && (
                  <tfoot>
                    <tr>
                      {isMobile ? (
                        <>
                          <td style={{ ...td, fontWeight: 700, color: c.ink }} colSpan={2}>Month total</td>
                          <td style={{ ...td, fontWeight: 700, color: c.ink }}>{fmtHM(monthTotals.working_minutes)}</td>
                          <td style={td}></td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...td, fontWeight: 700, color: c.ink }} colSpan={4}>Month total</td>
                          <td style={{ ...td, fontWeight: 700 }}>{fmtHM(days.reduce((s, d) => s + d.break_minutes, 0))}</td>
                          <td style={{ ...td, fontWeight: 700, color: c.muted }}>{fmtHM(days.reduce((s, d) => s + d.gross_minutes, 0))}</td>
                          <td style={{ ...td, fontWeight: 700, color: c.ink }}>{fmtHM(monthTotals.working_minutes)}</td>
                          <td style={td}></td>
                        </>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </section>
          )}

          {timeView === "monthly" && (
            /* Phone: minmax(200px) stacked these one per row -- eight tall
               cards. 140px puts two per row. */
            <div style={{ ...grid(isMobile ? 140 : 200), marginBottom: 14 }}>
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
              <button style={btn} onClick={() => setShowCorrectionForm(true)}>+ Request correction</button>
            </div>

            {/* A dialog rather than an inline block: it can be opened from the
                Timeline day-detail and from a review flag, both of which land
                the user at the top of the Time tab -- an inline form then sits
                below the whole daily table, off-screen, and looks like nothing
                happened. Centered, it's always in view. */}
            {showCorrectionForm && (
              <div
                onClick={() => setShowCorrectionForm(false)}
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  style={{ background: c.panel, borderRadius: 12, width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)", padding: 20 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>Request a correction</div>
                    <button style={{ border: "none", background: "none", color: c.hint, fontSize: 20, cursor: "pointer", lineHeight: 1 }} onClick={() => setShowCorrectionForm(false)} aria-label="Close">×</button>
                  </div>
                  <div style={{ fontSize: 12, color: c.muted, marginBottom: 14 }}>
                    Your supervisor reviews it — nothing changes until they approve.
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 130px" }}>
                        <label style={lbl}>Date</label>
                        <input style={inp} type="date" max={todayKey()} value={correctionDraft.target_date} onChange={(e) => setCorrectionDraft({ ...correctionDraft, target_date: e.target.value })} />
                      </div>
                      {correctionDraft.issue !== "other" && (
                        <div style={{ flex: "1 1 110px" }}>
                          <label style={lbl}>Correct time</label>
                          <input style={inp} type="time" value={correctionDraft.proposed_ts} onChange={(e) => setCorrectionDraft({ ...correctionDraft, proposed_ts: e.target.value })} />
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={lbl}>Issue</label>
                      <select style={inp} value={correctionDraft.issue} onChange={(e) => setCorrectionDraft({ ...correctionDraft, issue: e.target.value })}>
                        {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Reason</label>
                      <input style={inp} value={correctionDraft.reason_text} onChange={(e) => setCorrectionDraft({ ...correctionDraft, reason_text: e.target.value })} placeholder="e.g. Phone died before I could check out" />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                      <button style={btn} disabled={busy} onClick={() => setShowCorrectionForm(false)}>Cancel</button>
                      <button style={btnPrimary} disabled={busy} onClick={submitCorrection}>Submit</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {corrections.length === 0 && <div style={{ fontSize: 12, color: c.hint }}>No requests yet.</div>}
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
          {/* Collapsed row: the balance headline stays readable at a glance,
              so closing the panel costs nothing but the vertical space. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={toggleLeaveInsights}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${leaveInsightsOpen ? `var(--modern-accent, ${c.accent})` : c.line}`,
                background: "var(--panel)", color: leaveInsightsOpen ? `var(--modern-accent, ${c.accent})` : c.muted,
              }}
            >
              ▦ Leave balance
              <span style={{ fontSize: 10, color: c.hint }}>{leaveInsightsOpen ? "▲" : "▼"}</span>
            </button>

            {!leaveInsightsOpen && leaveBalance.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, color: c.muted }}>
                {leaveBalance.map((lb) => (
                  <span key={lb.leave_type_id} style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                    <strong style={{ fontSize: 13.5, color: lb.balance <= 0 ? statusInk.bad : c.ink }}>{lb.balance}</strong>
                    <span>{lb.name} left</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {leaveInsightsOpen && (
            <>
              {leaveMix.some((s) => s.value > 0) && (
                <section style={{ ...cardStyle, marginBottom: 14 }}>
                  <Donut slices={leaveMix} title="Leave used this year" centerLabel="days" />
                </section>
              )}

              <div style={{ ...grid(isMobile ? 140 : 200), marginBottom: 14 }}>
                {leaveBalance.map((lb) => (
                  <section key={lb.leave_type_id} style={cardStyle}>
                    <div style={capStyle}>{lb.name}</div>
                    <Stat value={String(lb.balance)} label={`of ${lb.quota} days left · ${lb.used} used`} tone={lb.balance <= 0 ? statusInk.bad : undefined} />
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{lb.category}</div>
                  </section>
                ))}
              </div>
            </>
          )}

          {/* The "no leave types configured" case is a blocker, not an
              insight -- it stays visible whether or not the panel is open,
              since it explains why + Request leave is disabled. */}
          {leaveBalance.length === 0 && (
            <section style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: c.hint }}>No leave types configured yet — ask your admin to set them up in Settings → Workforce → Leave Types.</div>
            </section>
          )}

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
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20,
                alignItems: "flex-start", padding: "12px 0", borderBottom: `1px solid ${c.line}`, marginBottom: 10,
              }}>
                {/* Pick the dates by dragging on the calendar (the ADP
                    gesture) rather than typing two dates. */}
                <LeaveRangePicker
                  from={leaveDraft.date_from || null}
                  to={leaveDraft.date_to || null}
                  context={leaveDayContext}
                  onChange={(f, t) => setLeaveDraft({ ...leaveDraft, date_from: f ?? "", date_to: t ?? "" })}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={lbl}>Leave type</label>
                    <select style={inp} value={leaveDraft.leave_type_id} onChange={(e) => setLeaveDraft({ ...leaveDraft, leave_type_id: e.target.value })}>
                      <option value="">— select —</option>
                      {leaveBalance.map((lb) => <option key={lb.leave_type_id} value={lb.leave_type_id}>{lb.name} ({lb.balance} left)</option>)}
                    </select>
                  </div>
                  {/* Half-day only makes sense for a single-day request. */}
                  {leaveDraft.date_from && leaveDraft.date_from === leaveDraft.date_to && (
                    <div>
                      <label style={lbl}>Half-day</label>
                      <select style={inp} value={leaveDraft.half_day ? "yes" : "no"} onChange={(e) => setLeaveDraft({ ...leaveDraft, half_day: e.target.value === "yes" })}>
                        <option value="no">No — full day</option><option value="yes">Yes — half day</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={lbl}>Reason</label>
                    <input style={inp} value={leaveDraft.reason_text} onChange={(e) => setLeaveDraft({ ...leaveDraft, reason_text: e.target.value })} placeholder="e.g. Family function" />
                  </div>
                  <button
                    style={{ ...btnPrimary, opacity: !leaveDraft.date_from ? 0.6 : 1 }}
                    disabled={busy || !leaveDraft.date_from}
                    onClick={submitLeaveRequest}
                  >
                    {leaveDraft.date_from ? "Submit request" : "Pick dates first"}
                  </button>
                </div>
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
        <div style={{ ...grid(340), alignItems: "flex-start" }}>
          <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>My shifts</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>Next {me.upcoming.length} days · set by your supervisor</div>
            </div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {me.upcoming.map((u) => {
                const isToday = u.date === todayKey();
                return (
                  <div
                    key={u.date}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                      padding: "9px 12px", borderBottom: `1px solid ${c.line}`,
                      borderLeft: `3px solid ${u.is_day_off ? statusInk.bad : isToday ? "var(--tenant-accent, #378ADD)" : "transparent"}`,
                      background: isToday ? "var(--panel2)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap" }}>
                        {new Date(u.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                      </span>
                      {isToday && <Pill label="Today" tone="green" />}
                    </div>
                    <div style={{ fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap" }}>
                      {u.is_day_off ? (
                        <Pill label="Day off" tone="red" />
                      ) : u.shift_name ? (
                        <>
                          <span style={{ color: c.ink, fontWeight: 600 }}>{u.shift_name}</span>
                          <span style={{ color: c.muted, marginLeft: 6 }}>{u.start_time?.slice(0, 5)}–{u.end_time?.slice(0, 5)}</span>
                          {u.is_night_shift && <span style={{ marginLeft: 6 }}><Pill label="Night" tone="purple" /></span>}
                        </>
                      ) : (
                        <span style={{ color: c.hint }}>No shift assigned</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {me.upcoming.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: c.hint }}>No shift assigned yet — ask your supervisor.</div>
              )}
            </div>
          </section>

          <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Company holidays</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input style={{ ...inp, width: 150 }} placeholder="Search holiday…" value={holidayQuery} onChange={(e) => setHolidayQuery(e.target.value)} />
                <select style={{ ...inp, width: "auto" }} value={holidayFilter} onChange={(e) => setHolidayFilter(e.target.value as "upcoming" | "all")}>
                  <option value="upcoming">Upcoming only</option>
                  <option value="all">Whole year</option>
                </select>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
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
            </div>
          </section>
        </div>
      )}

      {tab === "analytics" && (
        analytics ? (
          <>
            {/* At-a-glance overview (moved off the Home tab, which is now just
                punch + the day column). Each still links to its own tab. */}
            <div style={{ ...grid(240), marginBottom: 14 }}>
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

              <section className="stat-tile is-clickable" style={cardStyle} onClick={() => setTab("calendar")}>
                <div style={capStyle}>My shift — next few days</div>
                {me.upcoming.length === 0 ? (
                  <div style={{ fontSize: 12, color: c.hint }}>No shift assigned.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {me.upcoming.slice(0, 3).map((u) => (
                      <div key={u.date} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                        <span style={{ color: c.ink }}>
                          {new Date(u.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                        </span>
                        <span style={{ color: u.is_day_off ? statusInk.bad : c.muted }}>
                          {u.is_day_off ? "Day off" : u.shift_name ? `${u.shift_name} ${u.start_time?.slice(0, 5)}–${u.end_time?.slice(0, 5)}` : "— none —"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <button style={{ ...btn, marginTop: 14 }} onClick={() => setTab("calendar")}>View full calendar</button>
              </section>
            </div>

            <div style={{ ...grid(isMobile ? 140 : 200), marginBottom: 14 }}>
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
