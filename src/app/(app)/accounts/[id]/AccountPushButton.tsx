"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

// On-demand push of this account to the tenant's configured external
// endpoint (Settings -> Push to external systems). See lib/webhookPush.ts.
//
// Currently mounted NOWHERE: taken off the account header 2026-08-19 (owner:
// "we don't need it here, we will see where we keep it later"). Kept intact
// rather than deleted -- the route behind it is live and this is the working
// UI for it, waiting on a decision about where it belongs.
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
      <Button
        variant="secondary"
        onClick={push}
        loading={state === "pushing"}
        title="Send this account to your configured external system (Settings → Push to external systems)"
      >
        {state === "pushing" ? "Pushing…" : state === "sent" ? "✓ Pushed" : "Push to ERP"}
      </Button>
      {error && <span style={{ fontSize: 11, color: "var(--err-ink)" }}>{error}</span>}
    </div>
  );
}
