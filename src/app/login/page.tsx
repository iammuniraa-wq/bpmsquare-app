"use client";

import { useRouter } from "next/navigation";
import { c, g, sh } from "@/lib/theme";
import { ROUTES, WORKSPACE_NAME } from "@/lib/constants";
import Logo from "@/components/Logo";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  border: `1px solid ${c.line}`,
  borderRadius: 9,
  padding: "0 12px",
  fontSize: 13,
  marginBottom: 10,
  color: c.ink,
};

export default function LoginPage() {
  const router = useRouter();

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    router.push(ROUTES.pipeline);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: g.login,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        onSubmit={signIn}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: "34px 30px",
          width: 360,
          maxWidth: "100%",
          textAlign: "center",
          boxShadow: sh.modal,
        }}
      >
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
          <Logo size={58} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>
          Vevey<span style={{ color: c.accent }}>CRM</span>
        </div>
        <div style={{ fontSize: 12.5, color: c.muted, margin: "5px 0 22px" }}>
          Sign in to the {WORKSPACE_NAME}
        </div>
        <input type="email" defaultValue="admin@vikaspioneers.com" style={inputStyle} />
        <input
          type="password"
          defaultValue="demo-password"
          style={{ ...inputStyle, marginBottom: 16 }}
        />
        <button
          type="submit"
          style={{
            width: "100%",
            height: 44,
            background: c.accent,
            color: "#fff",
            border: "none",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
        <div style={{ fontSize: 11, color: c.hint, marginTop: 16 }}>
          Demo workspace · click Sign in to explore
        </div>
      </form>
    </div>
  );
}
