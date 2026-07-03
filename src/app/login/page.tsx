"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { c, g, sh } from "@/lib/theme";
import Logo from "@/components/Logo";
import { Suspense } from "react";
import { Mail } from "@/components/Icons";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  border: `1px solid ${c.line}`,
  borderRadius: 9,
  padding: "0 12px",
  fontSize: 13,
  color: c.ink,
  boxSizing: "border-box",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const hasError = searchParams.get("error") === "auth";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(hasError ? "Login link expired. Please try again." : "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabase();

    // If password entered, use password login
    if (password) {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setLoading(false);
      if (err) { setError(err.message ?? "Login failed. Check your credentials."); return; }
      window.location.href = next;
      return;
    }

    // Otherwise magic link
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    });

    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
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
        borderRadius: 16,
        padding: "34px 30px",
        width: 360,
        maxWidth: "100%",
        textAlign: "center",
        boxShadow: sh.modal,
      }}>
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
          <Logo size={58} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>
          Vevey<span style={{ color: c.accent }}>CRM</span>
        </div>
        <div style={{ fontSize: 12.5, color: c.muted, margin: "5px 0 22px" }}>
          Sign in to your workspace
        </div>

        {sent ? (
          <div style={{
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 10, padding: "16px 14px",
            fontSize: 13.5, color: "#166534", lineHeight: 1.5,
          }}>
            <Mail size={16} color="#166534" style={{ marginRight: 6, verticalAlign: "middle" }} /> Check your email<br />
            <span style={{ fontSize: 12, color: "#15803d" }}>
              A sign-in link has been sent to <strong>{email}</strong>
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <input
              type="password"
              placeholder="Password (optional — or use magic link)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
            />
            {error && (
              <div style={{
                fontSize: 12, color: "#dc2626",
                background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: 7, padding: "8px 10px", marginBottom: 10,
                textAlign: "left",
              }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", height: 44,
                background: loading ? "#93c5fd" : c.accent,
                color: "#fff", border: "none",
                borderRadius: 9, fontSize: 14, fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background .15s",
              }}
            >
              {loading ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}

        <div style={{ fontSize: 11, color: c.hint, marginTop: 16 }}>
          No password required · magic link sent to your email
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
