"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { PresenceKind, PunchState } from "@/lib/wfm/types";
import { enqueuePunch, flushQueue, listQueuedPunches } from "@/lib/wfm/offlineQueue";

// The consent copy ships separately (bilingual EN + regional). Placeholder
// per requirements: CONSENT_TEXT_DE_EN_PLACEHOLDER.
const CONSENT_TEXT = `To record your attendance, this app captures:

• A selfie at every check-in and check-out
• Your location (GPS) at the time of each punch

This data is used only for attendance and payroll summary purposes, is visible to your supervisor and employer, and punch selfies are automatically deleted after the configured retention period. You can request deletion of your data when you leave the organisation.

By tapping "I agree", you consent to this collection under India's DPDP Act.`;

type MeState = {
  employee: {
    id: string;
    full_name: string;
    employee_code: string | null;
    wfm_role: "employee" | "supervisor";
    consent_recorded_at: string | null;
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
  days_present: number;
  working_minutes: number;
  late_marks: number;
  half_day_deductions: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  holiday_days: number;
};

type LeaveBalance = { name: string; category: string; quota: number; used: number; balance: number };
type Holiday = { id: string; date: string; name: string; applies_to: string };
type CorrectionRequest = {
  id: string; target_date: string; status: "pending" | "approved" | "rejected";
  requested_change: { issue: string }; reason_text: string; supervisor_remark: string | null;
};

type Geo = { lat: number; lng: number; accuracy_m: number } | null;

const KIND_LABEL: Record<PresenceKind, string> = {
  check_in: "Check in", check_out: "Check out", break_start: "Break", break_end: "End break",
};
const ISSUE_LABEL: Record<string, string> = {
  missing_check_in: "Missing check-in", missing_check_out: "Missing check-out",
  wrong_time: "Wrong time", other: "Other",
};
const STATUS_TONE: Record<string, "amber" | "green" | "red"> = { pending: "amber", approved: "green", rejected: "red" };

const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.abs(mins) % 60).padStart(2, "0")}m`;
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (s: string) => new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

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
  padding: "10px 16px", fontSize: 13, fontWeight: 600, borderRadius: 10,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };

export default function MeClient() {
  const [me, setMe] = useState<MeState | null>(null);
  const [monthTotals, setMonthTotals] = useState<MonthTotals | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance[]>([]);
  const [nextHoliday, setNextHoliday] = useState<Holiday | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [cameraFor, setCameraFor] = useState<PresenceKind | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState({ target_date: new Date().toISOString().slice(0, 10), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/me/state");
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? "Could not load"); return; }
      setMe(json);
      setLoadError("");

      if (json.employee?.consent_recorded_at) {
        const month = new Date().toISOString().slice(0, 7);
        const [tsRes, holRes, corrRes] = await Promise.all([
          fetch(`/api/wfm/me/timesheet?month=${month}`),
          fetch("/api/wfm/holidays"),
          fetch("/api/wfm/corrections"),
        ]);
        if (tsRes.ok) {
          const ts = await tsRes.json();
          setMonthTotals(ts.summary?.totals ?? null);
          setLeaveBalance(ts.leave_balance ?? []);
        }
        if (holRes.ok) {
          const holidays: Holiday[] = await holRes.json();
          const today = new Date().toISOString().slice(0, 10);
          const upcoming = holidays.filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
          setNextHoliday(upcoming[0] ?? null);
        }
        if (corrRes.ok) setCorrections((await corrRes.json()).slice(0, 5));
      }
    } catch {
      setLoadError("Network error — check your connection");
    }
  }, []);

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
      const t = fmtTime(ts);
      const where = json.site_name ? `at ${json.site_name}` : json.within_geofence === false ? "— location noted" : "";
      setNotice({ tone: json.within_geofence === false ? "warn" : "ok", text: `${KIND_LABEL[kind]} recorded at ${t} ${where}.` });
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
        body: JSON.stringify({ target_date: correctionDraft.target_date, issue: correctionDraft.issue, proposed_ts, reason_text: correctionDraft.reason_text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setNotice({ tone: "err", text: json.error ?? "Could not submit" }); return; }
      setShowCorrectionForm(false);
      setCorrectionDraft({ target_date: new Date().toISOString().slice(0, 10), issue: "missing_check_out", proposed_ts: "", reason_text: "" });
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <div style={{ ...cardStyle, color: "#ef4444", fontSize: 13 }}>{loadError}</div>;
  }
  if (!me) {
    return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading…</div>;
  }
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

  const tone = { ok: "#10b981", warn: c.amber, err: "#ef4444" };

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

  return (
    <>
      {queuedCount > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, color: c.amber, fontSize: 12.5 }}>{queuedCount} punch(es) pending sync</div>
      )}

      {/* Punch card */}
      <section style={{ ...cardStyle, textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: c.ink }}>{me.employee.full_name}</div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>
          {me.employee.employee_code}
          {me.shift && <> · {me.shift.name} ({me.shift.start_time.slice(0, 5)}–{me.shift.end_time.slice(0, 5)})</>}
          {me.home_site && <> · {me.home_site.name}</>}
        </div>

        <div style={{ margin: "16px 0 4px", fontSize: 36, fontWeight: 800, letterSpacing: -1, color: c.ink }}>{fmtHM(me.running_minutes)}</div>
        {me.break_minutes > 0 && <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 4 }}>breaks: {fmtHM(me.break_minutes)} (not counted)</div>}
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 16 }}>
          {me.state === "out" && me.today.length === 0 && "Not checked in yet"}
          {me.state === "out" && me.today.length > 0 && "Checked out — see you tomorrow"}
          {me.state === "in" && "You're checked in"}
          {me.state === "break" && "On break"}
        </div>

        {me.state === "out" && <button style={{ ...btnPrimary, background: "#10b981", padding: "14px 32px", fontSize: 15 }} disabled={busy} onClick={() => openCamera("check_in")}>Check in</button>}
        {me.state === "in" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={{ ...btnPrimary, background: "#ef4444", padding: "14px 32px", fontSize: 15 }} disabled={busy} onClick={() => openCamera("check_out")}>Check out</button>
            <button style={btn} disabled={busy} onClick={() => submitPunch("break_start", null)}>☕ Start break</button>
          </div>
        )}
        {me.state === "break" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={{ ...btnPrimary, padding: "14px 32px", fontSize: 15 }} disabled={busy} onClick={() => submitPunch("break_end", null)}>End break</button>
            <button style={btn} disabled={busy} onClick={() => openCamera("check_out")}>Check out</button>
          </div>
        )}

        {notice && <div style={{ marginTop: 14, fontSize: 12.5, color: tone[notice.tone] }}>{notice.text}</div>}
      </section>

      {/* Today */}
      {me.today.length > 0 && (
        <section style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>Today</div>
          {me.today.map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
              <span style={{ color: c.ink }}>{KIND_LABEL[e.kind]}</span>
              <span style={{ color: c.hint }}>{fmtTime(e.ts)}</span>
            </div>
          ))}
        </section>
      )}

      {/* This month + leave + holiday */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 14 }}>
        <section style={cardStyle}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>This month</div>
          {monthTotals ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{fmtHM(monthTotals.working_minutes)}</div>
              <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 8 }}>working hours · {monthTotals.days_present} days present</div>
              <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: c.muted, flexWrap: "wrap" }}>
                <span style={{ color: monthTotals.late_marks > 0 ? pillar.amber.fg : undefined }}>{monthTotals.late_marks} late</span>
                <span>{monthTotals.paid_leave_days + monthTotals.unpaid_leave_days} leave</span>
                <span>{monthTotals.holiday_days} holidays</span>
              </div>
            </>
          ) : <div style={{ fontSize: 12, color: c.hint }}>—</div>}
        </section>

        <section style={cardStyle}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Leave balance</div>
          {leaveBalance.length === 0 ? <div style={{ fontSize: 12, color: c.hint }}>No leave types configured.</div> : leaveBalance.map((lb) => (
            <div key={lb.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
              <span style={{ color: c.ink }}>{lb.name}</span>
              <span style={{ color: lb.balance <= 0 ? "#ef4444" : c.muted }}>{lb.balance} / {lb.quota}</span>
            </div>
          ))}
        </section>

        <section style={cardStyle}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Next holiday</div>
          {nextHoliday ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>{fmtDate(nextHoliday.date)}</div>
              <div style={{ fontSize: 12, color: c.muted }}>{nextHoliday.name}</div>
            </>
          ) : <div style={{ fontSize: 12, color: c.hint }}>None scheduled.</div>}
        </section>
      </div>

      {/* Corrections */}
      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Recent corrections</div>
          <button style={btn} onClick={() => setShowCorrectionForm((s) => !s)}>{showCorrectionForm ? "Cancel" : "+ Request correction"}</button>
        </div>

        {showCorrectionForm && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "10px 0", borderBottom: `1px solid ${c.line}`, marginBottom: 10 }}>
            <div style={{ flex: "0 1 140px" }}>
              <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 4 }}>Date</label>
              <input type="date" max={new Date().toISOString().slice(0, 10)} value={correctionDraft.target_date}
                onChange={(e) => setCorrectionDraft({ ...correctionDraft, target_date: e.target.value })}
                style={{ padding: "7px 10px", fontSize: 12.5, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink }} />
            </div>
            <div style={{ flex: "0 1 160px" }}>
              <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 4 }}>Issue</label>
              <select value={correctionDraft.issue} onChange={(e) => setCorrectionDraft({ ...correctionDraft, issue: e.target.value })}
                style={{ padding: "7px 10px", fontSize: 12.5, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, width: "100%" }}>
                {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {correctionDraft.issue !== "other" && (
              <div style={{ flex: "0 1 120px" }}>
                <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 4 }}>Correct time</label>
                <input type="time" value={correctionDraft.proposed_ts} onChange={(e) => setCorrectionDraft({ ...correctionDraft, proposed_ts: e.target.value })}
                  style={{ padding: "7px 10px", fontSize: 12.5, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink }} />
              </div>
            )}
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 4 }}>Reason</label>
              <input value={correctionDraft.reason_text} onChange={(e) => setCorrectionDraft({ ...correctionDraft, reason_text: e.target.value })}
                placeholder="e.g. Phone died before I could check out"
                style={{ padding: "7px 10px", fontSize: 12.5, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, width: "100%", boxSizing: "border-box" }} />
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
            </div>
            <Pill label={r.status} tone={STATUS_TONE[r.status]} />
          </div>
        ))}
      </section>
    </>
  );
}
