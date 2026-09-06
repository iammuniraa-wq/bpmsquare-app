"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

// Lead -> deal (§4.3). One click; the deal opens.
export default function ConvertLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button
        type="button" disabled={pending} title="Create a deal from this lead"
        onClick={() => startTransition(async () => {
          setError("");
          const res = await fetch(`/api/leads/${leadId}/convert`, { method: "POST" });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) { setError(j.error ?? "Could not convert"); return; }
          router.push(ROUTES.pipelineDetail(j.id));
        })}
        style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: pending ? "wait" : "pointer", whiteSpace: "nowrap" }}
      >
        {pending ? "Converting…" : "→ Deal"}
      </button>
      {error && <span style={{ fontSize: 11, color: "var(--err-ink)" }}>{error}</span>}
    </span>
  );
}
