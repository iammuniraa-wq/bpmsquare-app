"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresenceKind, PunchState } from "@/lib/wfm/types";

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

type Geo = { lat: number; lng: number; accuracy_m: number } | null;

const KIND_LABEL: Record<PresenceKind, string> = {
  check_in: "Check in",
  check_out: "Check out",
  break_start: "Break",
  break_end: "End break",
};

function fmtHM(mins: number) {
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

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

// Downscale + JPEG-compress the captured frame to the ~200–400 KB target.
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

export default function PunchClient({ tenantName, accentColor }: { tenantName: string; accentColor: string }) {
  const [me, setMe] = useState<MeState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  // camera flow: which punch kind the camera was opened for
  const [cameraFor, setCameraFor] = useState<PresenceKind | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/me/state");
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? "Could not load"); return; }
      setMe(json);
      setLoadError("");
    } catch {
      setLoadError("Network error — check your connection");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraFor(null);
  }

  async function openCamera(kind: PresenceKind) {
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraFor(kind);
      // the <video> mounts after state updates; attach on next tick
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind, ts, geo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ tone: "err", text: json.error ?? "Punch failed" });
        return;
      }
      const t = new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const where = json.site_name
        ? `at ${json.site_name}`
        : json.within_geofence === false
          ? "— location noted"
          : "";
      setNotice({
        tone: json.within_geofence === false ? "warn" : "ok",
        text: `${KIND_LABEL[kind]} recorded at ${t} ${where}. Today: ${fmtHM(json.running_minutes ?? 0)}.`,
      });
      if (selfie) {
        // fire-and-forget: the punch is already recorded
        const form = new FormData();
        form.append("event_id", id);
        form.append("file", selfie, "selfie.jpg");
        fetch("/api/wfm/punch/selfie", { method: "POST", body: form }).catch(() => {});
      }
      await load();
    } catch {
      setNotice({ tone: "err", text: "Network error — punch not recorded. Try again." });
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

  // ── styles (self-contained; no CRM shell) ──────────────────────────────
  const S: Record<string, React.CSSProperties> = {
    page: {
      minHeight: "100dvh", background: "#0e1a28", color: "#e8eef4",
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 16px 32px",
    },
    header: {
      width: "100%", maxWidth: 440, padding: "18px 0 6px",
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
    },
    card: {
      width: "100%", maxWidth: 440, background: "#152233", borderRadius: 14,
      padding: 18, marginTop: 14, boxSizing: "border-box",
    },
    bigBtn: {
      width: "100%", padding: "20px 0", fontSize: 20, fontWeight: 700,
      borderRadius: 14, border: "none", cursor: "pointer", color: "#fff",
    },
    subBtn: {
      flex: 1, padding: "14px 0", fontSize: 15, fontWeight: 600,
      borderRadius: 12, border: "1px solid #2a3b52", background: "transparent",
      color: "#e8eef4", cursor: "pointer",
    },
  };

  const header = (
    <div style={S.header}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{tenantName}</div>
      <div style={{ fontSize: 12, color: "#8fa1b3" }}>Attendance</div>
    </div>
  );

  if (loadError) {
    return (
      <div style={S.page}>
        {header}
        <div style={S.card}>
          <div style={{ fontSize: 14, color: "#f6b23c" }}>{loadError}</div>
          <button style={{ ...S.subBtn, marginTop: 14 }} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div style={S.page}>
        {header}
        <div style={{ ...S.card, textAlign: "center", color: "#8fa1b3", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!me.employee) {
    return (
      <div style={S.page}>
        {header}
        <div style={S.card}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No employee profile</div>
          <div style={{ fontSize: 13.5, color: "#8fa1b3", lineHeight: 1.5 }}>
            Your login isn&apos;t linked to an employee record yet. Ask your supervisor to add you
            in Workforce → Employees.
          </div>
          {me.is_supervisor && (
            <a href="/wfm/live-board" style={{ display: "block", marginTop: 14, color: accentColor, fontSize: 14 }}>
              Open the supervisor live board →
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── consent gate ───────────────────────────────────────────────────────
  if (!me.employee.consent_recorded_at) {
    return (
      <div style={S.page}>
        {header}
        <div style={S.card}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Before you start</div>
          <div style={{ fontSize: 13.5, color: "#c6d2dd", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
            {CONSENT_TEXT}
          </div>
          <button
            style={{ ...S.bigBtn, background: accentColor, marginTop: 18, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={recordConsent}
          >
            I agree
          </button>
        </div>
      </div>
    );
  }

  // ── camera modal ───────────────────────────────────────────────────────
  if (cameraFor) {
    return (
      <div style={S.page}>
        {header}
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, textAlign: "center" }}>
            {KIND_LABEL[cameraFor]} — take a selfie
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: "100%", borderRadius: 12, transform: "scaleX(-1)", background: "#000", aspectRatio: "3/4", objectFit: "cover" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={S.subBtn} onClick={stopCamera}>Cancel</button>
            <button
              style={{ ...S.subBtn, background: accentColor, border: "none", flex: 2, opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={captureAndPunch}
            >
              {busy ? "Recording…" : "Capture & punch"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── punch home ─────────────────────────────────────────────────────────
  const tone = { ok: "#22c07a", warn: "#f6b23c", err: "#ff6b6b" };

  return (
    <div style={S.page}>
      {header}

      <div style={{ ...S.card, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{me.employee.full_name}</div>
        <div style={{ fontSize: 12.5, color: "#8fa1b3", marginTop: 3 }}>
          {me.employee.employee_code}
          {me.shift && <> · {me.shift.name} ({me.shift.start_time.slice(0, 5)}–{me.shift.end_time.slice(0, 5)})</>}
          {me.home_site && <> · {me.home_site.name}</>}
        </div>

        <div style={{ margin: "18px 0 6px", fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>
          {fmtHM(me.running_minutes)}
        </div>
        {me.break_minutes > 0 && (
          <div style={{ fontSize: 12, color: "#8fa1b3", marginBottom: 4 }}>
            breaks: {fmtHM(me.break_minutes)} (not counted)
          </div>
        )}
        <div style={{ fontSize: 12, color: "#8fa1b3", marginBottom: 18 }}>
          {me.state === "out" && me.today.length === 0 && "Not checked in yet"}
          {me.state === "out" && me.today.length > 0 && "Checked out — see you tomorrow"}
          {me.state === "in" && "You're checked in"}
          {me.state === "break" && "On break"}
        </div>

        {me.state === "out" && me.today.length === 0 && (
          <button style={{ ...S.bigBtn, background: "#22c07a" }} disabled={busy} onClick={() => openCamera("check_in")}>
            Check in
          </button>
        )}
        {me.state === "out" && me.today.length > 0 && (
          <button style={{ ...S.bigBtn, background: "#22c07a" }} disabled={busy} onClick={() => openCamera("check_in")}>
            Check in again
          </button>
        )}
        {me.state === "in" && (
          <>
            <button style={{ ...S.bigBtn, background: "#ff6b6b" }} disabled={busy} onClick={() => openCamera("check_out")}>
              Check out
            </button>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button style={S.subBtn} disabled={busy} onClick={() => submitPunch("break_start", null)}>
                ☕ Start break
              </button>
            </div>
          </>
        )}
        {me.state === "break" && (
          <>
            <button style={{ ...S.bigBtn, background: accentColor }} disabled={busy} onClick={() => submitPunch("break_end", null)}>
              End break
            </button>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button style={S.subBtn} disabled={busy} onClick={() => openCamera("check_out")}>
                Check out
              </button>
            </div>
          </>
        )}

        {notice && (
          <div style={{ marginTop: 14, fontSize: 13, color: tone[notice.tone], lineHeight: 1.45 }}>
            {notice.text}
          </div>
        )}
      </div>

      {me.today.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#c6d2dd" }}>Today</div>
          {me.today.map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1e2f44", fontSize: 13.5 }}>
              <span>{KIND_LABEL[e.kind]}</span>
              <span style={{ color: "#8fa1b3" }}>
                {new Date(e.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "#5f7286", marginTop: 10 }}>
            Break time is recorded and excluded from your working-hours total.
          </div>
        </div>
      )}
    </div>
  );
}
