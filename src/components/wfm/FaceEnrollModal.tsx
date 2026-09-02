"use client";

import { useEffect, useRef, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { describeCameraError } from "@/lib/wfm/devicePermissions";

/**
 * Face enrollment — self-service from the employee's own login (primary
 * path, client decision 2026-08-20), or supervisor-assisted with the
 * employee present (fallback for employees without logins).
 *
 * Order is deliberate: consent BEFORE the camera ever opens. The consent
 * screen is worded to the employee (not the supervisor) and their tap on
 * "I agree" is what unlocks capture — its timestamp lands on the
 * enrollment row server-side. Capture takes up to 3 frames (different
 * angle/expression each helps matching); one good frame is enough to
 * enroll, the server skips unusable ones.
 */

const CONSENT_TEXT = [
  "Your face will be used to identify you when you punch in and out on the attendance kiosk.",
  "The photos taken now are stored securely by your employer's attendance system, and a face template derived from them is held by the matching service. Neither is ever shared beyond that, and neither is used for anything except attendance.",
  "If you leave the company, or withdraw consent (from this screen or through your supervisor), your photos and face template are deleted.",
  "Enrollment is voluntary. If you do not agree, you can continue punching with the regular selfie method.",
];

type Step = "consent" | "capture" | "sending" | "done";

export default function FaceEnrollModal({
  employeeId, employeeName, onClose, onDone, self = false,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onDone: () => void;
  /** Employee enrolling themselves from their own login (the primary path)
   *  vs a supervisor assisting — changes only the copy. */
  self?: boolean;
}) {
  const [step, setStep] = useState<Step>("consent");
  const [frames, setFrames] = useState<Blob[]>([]);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startCapture() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setStep("capture");
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (e) {
      setError(describeCameraError(e));
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const MAX = 900;
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (blob) setFrames((f) => [...f, blob].slice(0, 3));
  }

  async function submit() {
    setStep("sending");
    setError("");
    const form = new FormData();
    form.append("employee_id", employeeId);
    form.append("consent", "true");
    frames.forEach((b, i) => form.append("frames", b, `frame-${i}.jpg`));
    try {
      const res = await fetch("/api/wfm/face/enrollments", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Enrollment failed");
        setStep("capture");
        return;
      }
      stopCamera();
      setStep("done");
    } catch {
      setError("Network error — enrollment not saved.");
      setStep("capture");
    }
  }

  const btn: React.CSSProperties = {
    padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
    border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
  };
  const btnPrimary: React.CSSProperties = {
    ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 14 }}
      onClick={() => { stopCamera(); onClose(); }}
    >
      <div style={{ ...cardStyle, width: 460, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 2 }}>{self ? "Set up face punch" : `Enroll face — ${employeeName}`}</div>

        {step === "consent" && (
          <>
            {!self && (
              <div style={{ fontSize: 12, color: c.hint, marginBottom: 12 }}>
                Hand the device to {employeeName} for this part.
              </div>
            )}
            {CONSENT_TEXT.map((p) => (
              <p key={p.slice(0, 20)} style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55, margin: "0 0 10px" }}>{p}</p>
            ))}
            {error && <div style={{ fontSize: 12.5, color: statusInk.bad, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button style={btnPrimary} onClick={startCapture}>I agree — continue</button>
              <button style={btn} onClick={() => { stopCamera(); onClose(); }}>Cancel</button>
            </div>
          </>
        )}

        {(step === "capture" || step === "sending") && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: "100%", borderRadius: 10, background: "#000", transform: "scaleX(-1)", marginTop: 6 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              {frames.map((_, i) => (
                <span key={i} style={{ fontSize: 11.5, color: statusInk.good, fontWeight: 700 }}>✓ Frame {i + 1}</span>
              ))}
              {frames.length === 0 && (
                <span style={{ fontSize: 11.5, color: c.hint }}>Face the camera straight on, good light. Take up to 3 shots.</span>
              )}
            </div>
            {error && <div style={{ fontSize: 12.5, color: statusInk.bad, marginTop: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button style={btn} onClick={captureFrame} disabled={step === "sending" || frames.length >= 3}>
                📷 Capture ({frames.length}/3)
              </button>
              <button style={btnPrimary} onClick={submit} disabled={step === "sending" || frames.length === 0}>
                {step === "sending" ? "Enrolling…" : "Enroll"}
              </button>
              {frames.length > 0 && step !== "sending" && (
                <button style={btn} onClick={() => setFrames([])}>Retake</button>
              )}
              <button style={{ ...btn, marginLeft: "auto" }} onClick={() => { stopCamera(); onClose(); }} disabled={step === "sending"}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div style={{ fontSize: 13, color: statusInk.good, fontWeight: 600, margin: "12px 0" }}>
              ✓ Enrolled. {self ? "You" : employeeName} can now punch by face at the kiosk.
            </div>
            <button style={btnPrimary} onClick={() => { onDone(); onClose(); }}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
