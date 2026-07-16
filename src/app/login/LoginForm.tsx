"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  transition: "border-color .15s",
};

function LoginFormInner({ branding }: { branding: Branding }) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(() =>
    searchParams.get("error") === "wrong_workspace"
      ? `This account doesn't have access to ${branding?.name ?? "this workspace"}. Sign in with an account that belongs here.`
      : ""
  );
  const [resetSent, setResetSent] = useState(false);
  const [mode, setMode]         = useState<"login" | "forgot">("login");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (err) {
      setError("Incorrect email or password. Please try again.");
    } else {
      window.location.href = next;
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      // Route through /auth/callback so the PKCE code gets exchanged server-side
      // (Set-Cookie on the redirect response) instead of client-side in
      // /reset-password's useEffect -- the client-side exchange was unreliable
      // (Supabase kept reporting "code verifier not found in storage" even in
      // the same browser/tab that initiated the request).
      { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` }
    );

    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setResetSent(true);
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

        {/* Logo + brand */}
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
            {mode === "login" ? "Sign in to your workspace" : "Reset your password"}
          </div>
        </div>

        {/* ── FORGOT PASSWORD ── */}
        {mode === "forgot" && (
          resetSent ? (
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 9, padding: "16px 14px",
              fontSize: 13.5, color: "#166534", lineHeight: 1.6, textAlign: "center",
            }}>
              Password reset email sent to <strong>{email}</strong>.<br />
              <span style={{ fontSize: 12.5 }}>Check your inbox and follow the link.</span>
            </div>
          ) : (
            <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={labelStyle}>Email address</label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  style={inputStyle}
                />
              </div>
              {error && <ErrorBox>{error}</ErrorBox>}
              <button type="submit" disabled={loading} style={btnStyle(loading)}>
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )
        )}

        {/* ── LOGIN ── */}
        {mode === "login" && (
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            <button type="submit" disabled={loading} style={btnStyle(loading)}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* Footer links */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: c.hint }}>
          {mode === "login" ? (
            <button
              onClick={() => { setMode("forgot"); setError(""); }}
              style={{ background: "none", border: "none", color: c.accent, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
            >
              Forgot your password?
            </button>
          ) : (
            <button
              onClick={() => { setMode("login"); setError(""); setResetSent(false); }}
              style={{ background: "none", border: "none", color: c.accent, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
            >
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13, color: "#dc2626",
      background: "#fef2f2", border: "1px solid #fecaca",
      borderRadius: 7, padding: "9px 12px",
    }}>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12.5, fontWeight: 600,
  color: c.muted, marginBottom: 6,
};

const btnStyle = (loading: boolean): React.CSSProperties => ({
  width: "100%", height: 46,
  background: loading ? "#93c5fd" : c.accent,
  color: "#fff", border: "none",
  borderRadius: 8, fontSize: 14.5, fontWeight: 600,
  cursor: loading ? "not-allowed" : "pointer",
  transition: "background .15s",
  marginTop: 2,
});

export default function LoginForm({ branding }: { branding: Branding }) {
  return (
    <Suspense>
      <LoginFormInner branding={branding} />
    </Suspense>
  );
}
