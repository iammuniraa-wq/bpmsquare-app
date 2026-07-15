"use client";

import { useState, useEffect } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { c, g, sh } from "@/lib/theme";
import Logo from "@/components/Logo";

type Branding = { name: string; logo_url: string | null } | null;

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  border: `1px solid ${c.line}`,
  borderRadius: 8,
  padding: "0 14px",
  fontSize: 14,
  color: c.ink,
  boxSizing: "border-box",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12.5, fontWeight: 600,
  color: c.muted, marginBottom: 6,
};

export default function ResetPasswordForm({ branding }: { branding: Branding }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);
  const [ready, setReady]       = useState(false);
  const [expired, setExpired]   = useState(false);
  const [debugInfo, setDebugInfo] = useState("");

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));

    // Supabase appends error/error_code/error_description (query or hash) when
    // the link itself was rejected before ever reaching our code -- e.g. the
    // token was already used, expired, or consumed by an email link-scanner
    // that pre-fetched it. Surface this instead of guessing.
    const linkError = url.searchParams.get("error_description") || hashParams.get("error_description")
      || url.searchParams.get("error_code") || hashParams.get("error_code");
    if (linkError) {
      console.error("Reset link rejected by Supabase:", decodeURIComponent(linkError));
      setDebugInfo(decodeURIComponent(linkError));
      setExpired(true);
      return;
    }

    // PKCE flow: Supabase's recovery link lands here as ?code=... (this is the
    // actual format Supabase now sends). Nothing auto-exchanges this -- it has
    // to be done explicitly, unlike the older #access_token= hash flow below.
    const code = url.searchParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          console.error("exchangeCodeForSession failed:", error.message);
          setDebugInfo(error.message);
          setExpired(true);
        } else {
          setReady(true);
          window.history.replaceState({}, "", window.location.pathname);
        }
      });
      return;
    }

    // First try: check if Supabase already exchanged the hash token
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
        return;
      }
      // Second try: listen for PASSWORD_RECOVERY event
      const { data: listener } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          setReady(true);
        }
      });

      // If nothing fires in 6 seconds, the link is expired or invalid
      const timeout = setTimeout(() => {
        setExpired(true);
      }, 6000);

      return () => {
        listener.subscription.unsubscribe();
        clearTimeout(timeout);
      };
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) {
      setError(err.message);
    } else {
      setDone(true);
      setTimeout(() => { window.location.href = "/"; }, 2000);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: g.login,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 14,
        padding: "36px 32px 30px",
        width: 380,
        maxWidth: "100%",
        boxShadow: sh.modal,
      }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            {branding?.logo_url ? (
              <img
                src={branding.logo_url}
                alt={branding.name}
                style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 10 }}
              />
            ) : (
              <Logo size={52} />
            )}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: c.ink }}>
            {branding ? branding.name : <>BPM<span style={{ color: c.accent }}>Square</span></>}
          </div>
          <div style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Set a new password</div>
        </div>

        {done && (
          <div style={{
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 9, padding: "16px 14px",
            fontSize: 13.5, color: "#166534", lineHeight: 1.6, textAlign: "center",
          }}>
            Password updated. Taking you to the app…
          </div>
        )}

        {!done && expired && (
          <div style={{ textAlign: "center" }}>
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca",
              borderRadius: 9, padding: "14px", fontSize: 13.5,
              color: "#dc2626", marginBottom: 16,
            }}>
              This reset link has expired or is invalid.
              {debugInfo && (
                <div style={{ fontSize: 11, color: "#991b1b", marginTop: 6, fontWeight: 400 }}>
                  ({debugInfo})
                </div>
              )}
            </div>
            <a href="/login" style={{
              fontSize: 13.5, fontWeight: 600, color: c.accent, textDecoration: "none",
            }}>
              ← Request a new reset link
            </a>
          </div>
        )}

        {!done && !expired && !ready && (
          <div style={{ textAlign: "center", fontSize: 13.5, color: c.muted, padding: "16px 0" }}>
            Verifying reset link…
          </div>
        )}

        {!done && !expired && ready && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm password</label>
              <input
                type="password"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            {error && (
              <div style={{
                fontSize: 13, color: "#dc2626",
                background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: 7, padding: "9px 12px",
              }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", height: 46,
                background: loading ? "#93c5fd" : c.accent,
                color: "#fff", border: "none",
                borderRadius: 8, fontSize: 14.5, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                marginTop: 2,
              }}
            >
              {loading ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
