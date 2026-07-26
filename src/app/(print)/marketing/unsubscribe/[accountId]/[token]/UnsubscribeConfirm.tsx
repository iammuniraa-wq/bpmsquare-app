"use client";

import { useState } from "react";

export default function UnsubscribeConfirm({ accountId, token }: { accountId: string; token: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function confirm() {
    setState("working");
    try {
      const res = await fetch(`/api/marketing/unsubscribe/${accountId}/${token}`, { method: "POST" });
      if (!res.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <p style={{ color: "#1d9e75", fontWeight: 600 }}>You've been unsubscribed. You won't receive marketing emails from us again.</p>;
  }

  return (
    <>
      <button
        onClick={confirm}
        disabled={state === "working"}
        style={{
          padding: "10px 22px", borderRadius: 8, border: "none", background: "#152233",
          color: "#fff", fontSize: 14, fontWeight: 600, cursor: state === "working" ? "not-allowed" : "pointer",
        }}
      >
        {state === "working" ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
      {state === "error" && <p style={{ color: "#dc2626", marginTop: 12 }}>Something went wrong. Please try again.</p>}
    </>
  );
}
