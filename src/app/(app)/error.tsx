"use client";

import { useEffect } from "react";

// This app had NO error boundary anywhere before this file -- any render
// crash on any page (Nova or classic) took down the whole screen with
// Next's generic redacted "Server Components render" message and no way
// back except a hard reload. This contains a crash to one recoverable
// screen instead, matching the visual language of the other full-screen
// states already used in (app)/layout.tsx (no workspace / suspended).
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", flexDirection: "column", gap: 12,
      background: "#0f1117", color: "#9ca3af", fontFamily: "system-ui",
      textAlign: "center", padding: 24,
    }}>
      <div style={{ fontSize: 18, color: "#e5e7eb", fontWeight: 600 }}>Something went wrong</div>
      <div style={{ fontSize: 13, maxWidth: 420 }}>
        This page hit an error. Try again, or head back to the dashboard if it keeps happening.
      </div>
      {error.digest && (
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>Reference: {error.digest}</div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          onClick={reset}
          style={{
            fontSize: 13, fontWeight: 600, color: "#fff", background: "#3b82f6",
            border: "none", borderRadius: 7, padding: "8px 16px", cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            fontSize: 13, fontWeight: 600, color: "#e5e7eb", background: "transparent",
            border: "1px solid #374151", borderRadius: 7, padding: "8px 16px", textDecoration: "none",
          }}
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
