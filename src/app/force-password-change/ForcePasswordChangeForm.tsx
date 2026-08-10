"use client";

import { useState } from "react";
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

export default function ForcePasswordChangeForm({ branding }: { branding: Branding }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");

    // The server applies the new password itself (via the admin client) and
    // only then clears must_change_password -- this route is the actual
    // source of truth for the change, not a follow-up to a separate
    // client-side call, so the flag can't be cleared without the password
    // genuinely having changed.
    const res = await fetch("/api/auth/complete-password-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(json?.error ?? "Could not set the new password. Try again.");
      return;
    }

    // Refresh the browser's own session so its locally-cached token reflects
    // the credential the server just changed, before navigating onward.
    const supabase = createBrowserSupabase();
    await supabase.auth.refreshSession().catch(() => {});

    setLoading(false);
    setDone(true);
    setTimeout(() => { window.location.href = "/"; }, 1500);
  }

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = "/login";
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
          <div style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>
            You&apos;re using a temporary password
          </div>
        </div>

        {done ? (
          <div style={{
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 9, padding: "16px 14px",
            fontSize: 13.5, color: "#166534", lineHeight: 1.6, textAlign: "center",
          }}>
            Password updated. Taking you to the app…
          </div>
        ) : (
          <>
            <div style={{
              background: "#fffbeb", border: "1px solid #fde68a",
              borderRadius: 9, padding: "12px 14px", marginBottom: 18,
              fontSize: 12.5, color: "#92400e", lineHeight: 1.5,
            }}>
              For security, set your own password before continuing.
            </div>
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
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  background: "none", border: "none", color: c.muted,
                  fontSize: 12.5, cursor: "pointer", textAlign: "center", padding: 4,
                }}
              >
                Not you? Log out
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
