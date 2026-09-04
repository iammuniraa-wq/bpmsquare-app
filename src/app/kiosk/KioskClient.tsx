"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The kiosk screen: one round = one face → one match → one tap → one punch
 * → reset. No state is held between people (the confirm screen's buttons
 * are bound to the ticket of THAT round's match, and the ticket dies in
 * 60s server-side).
 *
 * Tap-to-scan, deliberately: a continuous auto-scan loop would stream
 * frames to the matching service all day (real per-call cost, and a
 * camera that "watches" instead of being invoked). A tap is one frame,
 * one match call, fully predictable. Auto-scan can come later behind the
 * same API without touching the server.
 *
 * Dark, fixed styling on purpose — this page is not themed per tenant;
 * it's a fixture on a wall, readable from a metre away.
 */

const TOKEN_KEY = "bpm_kiosk_token";
import { describeCameraError } from "@/lib/wfm/devicePermissions";
const CHOICE_TIMEOUT_S = 12;

const KIND_LABEL: Record<string, string> = {
  check_in: "Punch in",
  check_out: "Punch out",
  break_start: "Start break",
  break_end: "End break",
};
const KIND_COLOR: Record<string, string> = {
  check_in: "#16a34a",
  check_out: "#dc2626",
  break_start: "#d97706",
  break_end: "#2563eb",
};

type Screen =
  | { s: "setup"; error?: string }
  | { s: "idle"; info: string }
  | { s: "scanning" }
  | { s: "choice"; name: string; kinds: string[]; ticket: string; frame: Blob; secondsLeft: number }
  | { s: "confirm"; text: string; ok: boolean };

export default function KioskClient() {
  const [token, setToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ s: "setup" });
  const [header, setHeader] = useState<{ tenant: string | null; site: string | null }>({ tenant: null, site: null });
  const [askUnregister, setAskUnregister] = useState(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clock, setClock] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setScreen({ s: "idle", info: describeCameraError(e) });
    }
  }, []);

  const validate = useCallback(async (tok: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/wfm/kiosk/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setScreen({ s: "setup", error: json.error ?? "Invalid kiosk code" });
        return false;
      }
      setHeader({ tenant: json.tenant_name, site: json.site_name });
      setScreen({
        s: "idle",
        info: json.face_ready ? "" : "Face service is not configured yet — punches can't be matched.",
      });
      return true;
    } catch {
      setScreen({ s: "setup", error: "Could not reach the server" });
      return false;
    }
  }, []);

  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (stored) {
      setToken(stored);
      void validate(stored).then((ok) => { if (ok) void startCamera(); });
    }
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function captureFrame(): Promise<Blob | null> {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return Promise.resolve(null);
    const MAX = 900;
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  }

  // Unregister — the ONLY way to move a tablet to a different kiosk code
  // without clearing browser data, which is not an instruction to give a
  // client at a door (and is exactly what the Manuvana mix-up cost us,
  // 2026-09-04). Deliberately behind a long-press on the site name plus a
  // confirm: findable when someone is told where it is, essentially
  // unhittable by a passer-by tapping the wall.
  function unregister() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setToken("");
    setHeader({ tenant: null, site: null });
    setAskUnregister(false);
    setScreen({ s: "setup", error: "" });
  }

  function resetToIdle(info = "") {
    if (timerRef.current) clearInterval(timerRef.current);
    setScreen({ s: "idle", info });
  }

  async function scan() {
    if (!token) return;
    setScreen({ s: "scanning" });
    const frame = await captureFrame();
    if (!frame) { resetToIdle("Camera not ready — try again."); return; }
    try {
      const form = new FormData();
      form.append("frame", frame, "frame.jpg");
      const res = await fetch("/api/wfm/kiosk/identify", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { flashConfirm(json.error ?? "Something went wrong — try again.", false); return; }
      if (!json.match) { flashConfirm("Not recognized — step closer and try again, or contact your supervisor.", false); return; }
      if ((json.kinds ?? []).length === 0) {
        flashConfirm(`Hi ${json.name} — nothing to punch right now.`, false);
        return;
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setScreen({ s: "choice", name: json.name, kinds: json.kinds, ticket: json.ticket, frame, secondsLeft: CHOICE_TIMEOUT_S });
      timerRef.current = setInterval(() => {
        setScreen((cur) => {
          if (cur.s !== "choice") return cur;
          if (cur.secondsLeft <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return { s: "idle", info: "" };
          }
          return { ...cur, secondsLeft: cur.secondsLeft - 1 };
        });
      }, 1000);
    } catch {
      flashConfirm("Network error — try again.", false);
    }
  }

  async function punch(kind: string) {
    if (screen.s !== "choice" || !token) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const { ticket, frame, name } = screen;
    setScreen({ s: "scanning" });
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("ticket", ticket);
      form.append("frame", frame, "frame.jpg");
      const res = await fetch("/api/wfm/kiosk/punch", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { flashConfirm(json.error ?? "Punch failed — try again.", false); return; }
      const time = new Date(json.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      flashConfirm(`${KIND_LABEL[kind]} · ${name} · ${time}`, true);
    } catch {
      flashConfirm("Network error — punch not recorded.", false);
    }
  }

  function flashConfirm(text: string, ok: boolean) {
    setScreen({ s: "confirm", text, ok });
    setTimeout(() => resetToIdle(), ok ? 3000 : 3500);
  }

  async function submitSetup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code");
    if (typeof code !== "string" || !code.trim()) return;
    const tok = code.trim();
    const ok = await validate(tok);
    if (ok) {
      localStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
      void startCamera();
    }
  }

  const S: Record<string, React.CSSProperties> = {
    page: {
      position: "fixed", inset: 0, background: "#0b0f14", color: "#eef2f7",
      display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif",
      userSelect: "none", overflow: "hidden",
    },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", fontSize: 15 },
    stage: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 16, textAlign: "center" },
    bigBtn: {
      fontSize: 22, fontWeight: 800, padding: "22px 44px", borderRadius: 16, border: "none",
      background: "#2563eb", color: "#fff", cursor: "pointer",
    },
  };

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div
          style={{ fontWeight: 700, userSelect: "none", cursor: "default" }}
          onPointerDown={() => {
            if (screen.s === "setup") return;
            holdRef.current = setTimeout(() => setAskUnregister(true), 3000);
          }}
          onPointerUp={() => { if (holdRef.current) clearTimeout(holdRef.current); }}
          onPointerLeave={() => { if (holdRef.current) clearTimeout(holdRef.current); }}
          title="Press and hold for 3 seconds to unregister this device"
        >
          {header.tenant ?? "BPMSquare"}
          {header.site && <span style={{ color: "#8b98a9", fontWeight: 500 }}> · {header.site}</span>}
        </div>
        <div style={{ color: "#8b98a9", fontVariantNumeric: "tabular-nums" }}>{clock}</div>
      </div>

      {/* The camera stays mounted (and running once granted) across every
          screen so a scan is instant — only its visibility changes. */}
      <div style={{ display: screen.s === "setup" ? "none" : "flex", justifyContent: "center" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: "min(64vw, 420px)", borderRadius: 18, transform: "scaleX(-1)",
            border: "2px solid #1d2733", background: "#000",
          }}
        />
      </div>

      <div style={S.stage}>
        {screen.s === "setup" && (
          <form onSubmit={submitSetup} style={{ display: "flex", flexDirection: "column", gap: 14, width: "min(88vw, 380px)" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Set up this kiosk</div>
            <div style={{ fontSize: 14, color: "#8b98a9", lineHeight: 1.5 }}>
              Paste the kiosk code from Settings → Workforce → Kiosks. This is entered once; the tablet stays registered.
            </div>
            <input
              name="code"
              autoComplete="off"
              placeholder="kiosk_…"
              style={{ padding: "14px 16px", fontSize: 16, borderRadius: 12, border: "1px solid #2a3646", background: "#121820", color: "#eef2f7", outline: "none" }}
            />
            {screen.error && <div style={{ color: "#f87171", fontSize: 14 }}>{screen.error}</div>}
            <button type="submit" style={{ ...S.bigBtn, fontSize: 17, padding: "14px 20px" }}>Register kiosk</button>
          </form>
        )}

        {screen.s === "idle" && (
          <>
            <div style={{ fontSize: 26, fontWeight: 800 }}>Punch in / out</div>
            {screen.info && <div style={{ color: "#fbbf24", fontSize: 14, maxWidth: 420 }}>{screen.info}</div>}
            <button style={S.bigBtn} onClick={() => void scan()}>Tap, then look at the camera</button>
          </>
        )}

        {screen.s === "scanning" && <div style={{ fontSize: 22, fontWeight: 700, color: "#8b98a9" }}>One moment…</div>}

        {screen.s === "choice" && (
          <>
            <div style={{ fontSize: 28, fontWeight: 800 }}>Hi {screen.name}</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
              {screen.kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => void punch(k)}
                  style={{ ...S.bigBtn, background: KIND_COLOR[k] ?? "#2563eb", minWidth: 180 }}
                >
                  {KIND_LABEL[k] ?? k}
                </button>
              ))}
            </div>
            <div style={{ color: "#8b98a9", fontSize: 14 }}>
              Not you? Wait {screen.secondsLeft}s or ask your supervisor.
            </div>
          </>
        )}

        {askUnregister && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(6,10,15,.86)", zIndex: 50,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}>
            <div style={{
              background: "#121820", border: "1px solid #2a3646", borderRadius: 16,
              padding: 24, maxWidth: 420, textAlign: "center", display: "flex",
              flexDirection: "column", gap: 14,
            }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Unregister this device?</div>
              <div style={{ color: "#8b98a9", fontSize: 14, lineHeight: 1.5 }}>
                It will stop being{header.site ? ` the ${header.site} kiosk` : " a kiosk"} and ask for a
                code again. Nobody can punch here until a new code is entered. Recorded punches are
                not affected.
              </div>
              <button
                onClick={unregister}
                style={{ ...S.bigBtn, background: "#b91c1c", fontSize: 17, padding: "14px 20px" }}
              >
                Unregister
              </button>
              <button
                onClick={() => setAskUnregister(false)}
                style={{
                  background: "none", border: "1px solid #2a3646", color: "#eef2f7",
                  borderRadius: 12, padding: "12px 18px", fontSize: 15, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {screen.s === "confirm" && (
          <div style={{ fontSize: 24, fontWeight: 800, color: screen.ok ? "#4ade80" : "#f87171", maxWidth: 480, lineHeight: 1.4 }}>
            {screen.ok ? "✓ " : ""}{screen.text}
          </div>
        )}
      </div>
    </div>
  );
}
