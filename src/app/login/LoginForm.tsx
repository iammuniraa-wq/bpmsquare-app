"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { c, g, sh } from "@/lib/theme";
import Logo from "@/components/Logo";
import { safeInternalPath } from "@/lib/safeRedirect";
import { employeeSyntheticEmail } from "@/lib/wfm/employeeLogin";
import FaceLoginButton from "@/components/FaceLoginButton";
import type { TenantBranding } from "@/lib/tenant";

type Branding = TenantBranding | null;

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
  const next = safeInternalPath(searchParams.get("next"));

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(() => {
    const err = searchParams.get("error");
    if (err === "wrong_workspace") {
      return `This account doesn't have access to ${branding?.name ?? "this workspace"}. Sign in with an account that belongs here.`;
    }
    if (err === "account_locked") {
      return "Your account is locked or outside its validity period. Contact your workspace administrator.";
    }
    return "";
  });
  const [resetSent, setResetSent] = useState(false);
  const [mode, setMode]         = useState<"login" | "forgot">("login");

  const codeLogin = branding?.employee_code_login === true;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");

    // In code-login mode an entry without "@" is an employee ID: resolve it to
    // the same synthetic address the admin-create route stored (pure, no
    // lookup). Anything with "@" is still treated as a real email, so an admin
    // on this same host signs in normally.
    const raw = email.trim();
    let loginEmail = raw;
    if (codeLogin && !raw.includes("@") && branding) {
      const synth = employeeSyntheticEmail(branding.id, raw);
      if (!synth) {
        setLoading(false);
        setError("Enter a valid employee ID or email.");
        return;
      }
      loginEmail = synth;
    }

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    setLoading(false);
    if (err) {
      setError(codeLogin ? "Incorrect ID or password. Please try again." : "Incorrect email or password. Please try again.");
    } else {
      window.location.href = next;
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");

    // Sent by us, not by supabase.auth.resetPasswordForEmail -- that one uses
    // PKCE, so the link only works in the browser that asked for it, which
    // breaks the moment someone requests the reset on a laptop and opens the
    // mail on a phone. Ours carries a token_hash instead, valid anywhere.
    // See api/auth/request-reset for the full reasoning.
    const res = await fetch("/api/auth/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null);

    setLoading(false);
    if (!res || !res.ok) {
      const json = res ? await res.json().catch(() => ({})) : {};
      setError(json.error ?? "Could not send the reset email. Try again in a moment.");
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
              <label style={labelStyle}>{codeLogin ? "User ID" : "Email address"}</label>
              <input
                type={codeLogin ? "text" : "email"}
                placeholder={codeLogin ? "Your user ID" : "you@company.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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
            {branding?.employee_face_login && <FaceLoginButton next={next} />}
          </form>
        )}

        {/* Footer links */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: c.hint }}>
          {mode === "login" ? (
            // In User ID mode there is no email to reset against and employees
            // don't self-reset -- a supervisor resets them from the Employees
            // screen -- so the email-based "Forgot password" is hidden here.
            codeLogin ? (
              <span style={{ fontSize: 12.5, color: c.hint }}>Forgot your password? Ask your supervisor to reset it.</span>
            ) : (
            <button
              onClick={() => { setMode("forgot"); setError(""); }}
              style={{ background: "none", border: "none", color: c.accent, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
            >
              Forgot your password?
            </button>
            )
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
