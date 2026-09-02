"use client";

import { useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { describeCameraError } from "@/lib/wfm/devicePermissions";

/**
 * "Sign in with face" for the login page (opt-in per tenant, client decision
 * 2026-08-21). Captures one camera frame, sends it to /api/auth/face-login,
 * and on a confident match finishes sign-in through the existing /auth/callback
 * (token_hash → session cookies), exactly like a magic link. Shown only when
 * the tenant's branding says face login is enabled.
 */
export default function FaceLoginButton({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (e) {
      setError(describeCameraError(e));
      setOpen(true);
    }
  }

  function cancel() {
    stopCamera();
    setOpen(false);
    setBusy(false);
    setError("");
  }

  async function captureAndSignIn() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setBusy(true);
    setError("");
    try {
      const MAX = 900;
      const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) { setError("Couldn't capture — try again."); setBusy(false); return; }

      const form = new FormData();
      form.append("frame", blob, "frame.jpg");
      const res = await fetch("/api/auth/face-login", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.token_hash) {
        setError(json.error ?? "Face not recognised. Try again, or use your ID and password.");
        setBusy(false);
        return;
      }
      stopCamera();
      // Finish through the existing callback: it verifies the token and sets
      // the session cookies server-side, then lands on the portal.
      const params = new URLSearchParams({ token_hash: json.token_hash, type: "magiclink", next });
      window.location.href = `/auth/callback?${params.toString()}`;
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = {
    width: "100%", height: 44, borderRadius: 8, fontSize: 14, fontWeight: 600,
    border: `1px solid ${c.line}`, background: "#fff", color: c.ink, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 4px" }}>
        <span style={{ flex: 1, height: 1, background: c.line }} />
        <span style={{ fontSize: 12, color: c.hint }}>or</span>
        <span style={{ flex: 1, height: 1, background: c.line }} />
      </div>
      <button type="button" style={btn} onClick={start}>
        <span aria-hidden>☺</span> Sign in with face
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
          onClick={cancel}
        >
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 400, maxWidth: "96vw" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Sign in with face</div>
            <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 12 }}>Look at the camera in good light, then capture.</div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 10, background: "#000", transform: "scaleX(-1)", aspectRatio: "3/4", objectFit: "cover" }} />
            {error && <div style={{ fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...btn, flex: 1, background: "#f4f4f5" }} onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" style={{ ...btn, flex: 2, background: "var(--tenant-accent, #2563eb)", color: "#fff", borderColor: "transparent" }} onClick={captureAndSignIn} disabled={busy}>
                {busy ? "Checking…" : "Capture & sign in"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
