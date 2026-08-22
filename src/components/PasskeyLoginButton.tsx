"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { c } from "@/lib/theme";

/**
 * "Sign in with Face ID / fingerprint" — passkey sign-in on the login page.
 * One tap opens the device's own biometric sheet (real Face ID on iPhone,
 * fingerprint/face on Android); the device signs our challenge and the
 * server finishes through /auth/callback like every other token sign-in.
 * Shown only when the tenant's branding says passkey login is enabled.
 */
export default function PasskeyLoginButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const optRes = await fetch("/api/auth/passkey/login-options", { method: "POST" });
      const options = await optRes.json();
      if (!optRes.ok) { setError(options.error ?? "Passkey sign-in isn't available."); return; }

      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: options });
      } catch (e) {
        const name = (e as { name?: string }).name;
        // NotAllowedError = the person dismissed the sheet -- not an error to shout about.
        if (name !== "NotAllowedError" && name !== "AbortError") {
          setError("This device doesn't have a passkey for this site yet — sign in with your ID once, then add one from Profile → Account Settings.");
        }
        return;
      }

      const verRes = await fetch("/api/auth/passkey/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const json = await verRes.json().catch(() => ({}));
      if (!verRes.ok || !json.token_hash) {
        setError(json.error ?? "Couldn't sign in with this passkey.");
        return;
      }
      const params = new URLSearchParams({ token_hash: json.token_hash, type: "magiclink", next });
      window.location.href = `/auth/callback?${params.toString()}`;
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        style={{
          width: "100%", height: 44, borderRadius: 8, fontSize: 14, fontWeight: 600, marginTop: 10,
          border: `1px solid ${c.line}`, background: "#fff", color: c.ink, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        <span aria-hidden>✦</span> {busy ? "Waiting for your device…" : "Sign in with Face ID / fingerprint"}
      </button>
      {error && (
        <div style={{ fontSize: 12.5, color: "#dc2626", marginTop: 8, lineHeight: 1.45 }}>{error}</div>
      )}
    </>
  );
}
