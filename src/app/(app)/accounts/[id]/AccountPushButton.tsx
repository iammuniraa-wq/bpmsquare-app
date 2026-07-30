"use client";

import { useState } from "react";
import { c } from "@/lib/theme";

// On-demand push of this account to the tenant's configured external
// endpoint (Settings -> Push to external systems). See lib/webhookPush.ts.
export default function AccountPushButton({ accountId }: { accountId: string }) {
  const [state, setState] = useState<"idle" | "pushing" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function push() {
    setState("pushing");
    setError("");
    try {
      const res = await fetch(`/api/accounts/${accountId}/push`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Push failed");
      setState("sent");
      setTimeout(() => setState("idle"), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Push failed");
      setState("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      <button
        onClick={push}
        disabled={state === "pushing"}
        title="Send this account to your configured external system (Settings → Push to external systems)"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 500,
          border: `1px solid ${state === "sent" ? "var(--teal)" : c.line}`,
          background: state === "sent" ? "rgba(29,158,117,.08)" : "var(--panel)",
          color: state === "sent" ? "var(--teal)" : c.muted,
          cursor: state === "pushing" ? "not-allowed" : "pointer",
        }}
      >
        {state === "pushing" ? "Pushing…" : state === "sent" ? "✓ Pushed" : "Push to ERP"}
      </button>
      {error && <span style={{ fontSize: 11, color: "var(--err-ink)" }}>{error}</span>}
    </div>
  );
}
