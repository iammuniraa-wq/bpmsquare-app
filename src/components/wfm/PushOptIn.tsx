"use client";

import { useCallback, useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";

/**
 * Lets an employee turn on notifications for THIS phone.
 *
 * Shown on My Workforce because that is the one screen every employee opens.
 * It removes itself entirely when there is nothing useful to offer -- push
 * unsupported, keys not configured on the server, or already enabled here --
 * rather than sitting there as a permanently-dead card.
 *
 * The browser only lets us ask for permission from a real tap, so this is a
 * button and never an automatic prompt on load. A prompt fired on page load
 * is also the fastest way to get permanently blocked: browsers remember a
 * dismissal, and there is no second chance from the page.
 */

/** The VAPID public key travels as base64url; pushManager.subscribe wants the
 *  raw bytes. Typed as ArrayBuffer rather than Uint8Array because TS's
 *  BufferSource excludes a Uint8Array over a possibly-shared buffer. */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normal);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

type State = "checking" | "unavailable" | "offer" | "busy" | "on" | "blocked" | "error";

export default function PushOptIn() {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState("");

  const check = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unavailable");
      return;
    }
    if (Notification.permission === "denied") { setState("blocked"); return; }

    try {
      const res = await fetch("/api/wfm/push");
      if (!res.ok) { setState("unavailable"); return; }
      const json = await res.json();
      if (!json.configured || !json.public_key) { setState("unavailable"); return; }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setState(existing ? "on" : "offer");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  async function enable() {
    setState("busy");
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") { setState("blocked"); return; }
      if (permission !== "granted") { setState("offer"); return; }

      const keyRes = await fetch("/api/wfm/push");
      const { public_key: publicKey } = await keyRes.json();

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey),
        }));

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const save = await fetch("/api/wfm/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!save.ok) {
        const err = await save.json().catch(() => ({}));
        setMessage(err.error ?? "Could not turn on notifications.");
        setState("error");
        return;
      }
      setState("on");
    } catch {
      setMessage("Could not turn on notifications on this device.");
      setState("error");
    }
  }

  if (state === "checking" || state === "unavailable" || state === "on") return null;

  const box: React.CSSProperties = {
    display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
    padding: "12px 14px", borderRadius: 10, background: c.panel2,
    border: `1px solid ${c.line}`, marginBottom: 14,
  };

  if (state === "blocked") {
    return (
      <div style={box}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Notifications are blocked</div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.5 }}>
            To get a reminder when it&apos;s time to punch out, allow notifications for this site
            in your browser settings, then reload this page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Get a reminder to punch out</div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.5 }}>
          We&apos;ll notify you on this phone once you&apos;ve worked a long day, so you don&apos;t
          forget to punch out. Nothing else is sent.
        </div>
        {message && <div style={{ fontSize: 12, color: statusInk.bad, marginTop: 5 }}>{message}</div>}
      </div>
      <button
        onClick={() => void enable()}
        disabled={state === "busy"}
        style={{
          padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
          background: c.accent, color: "#fff", border: "none",
          cursor: state === "busy" ? "default" : "pointer", opacity: state === "busy" ? 0.6 : 1,
        }}
      >
        {state === "busy" ? "Turning on…" : "Turn on"}
      </button>
    </div>
  );
}
