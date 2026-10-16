"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";

// Lead -> deal (§4.3). One click; the deal opens.
export default function ConvertLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <Button
        variant="secondary" size="sm" loading={pending} title="Create a deal from this lead"
        onClick={() => startTransition(async () => {
          setError("");
          const res = await fetch(`/api/leads/${leadId}/convert`, { method: "POST" });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) { setError(j.error ?? "Could not convert"); return; }
          router.push(ROUTES.pipelineDetail(j.id));
        })}
      >
        {pending ? "Converting…" : "→ Deal"}
      </Button>
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--err-ink)" }}>{error}</span>}
    </span>
  );
}
