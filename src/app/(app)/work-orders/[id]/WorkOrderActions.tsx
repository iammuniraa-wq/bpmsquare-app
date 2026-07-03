"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { pillar } from "@/lib/theme";
import type { WorkOrderStatus } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

export default function WorkOrderActions({ id, status }: { id: string; status: WorkOrderStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState("");

  function markComplete() {
    setErr("");
    startTransition(async () => {
      const res = await fetch(`/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (res.ok) router.refresh();
      else setErr("Could not update status");
    });
  }

  function raiseInvoice() {
    setErr("");
    startTransition(async () => {
      const res = await fetch(`/api/work-orders/${id}/invoice`, { method: "POST" });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.invoices);
      else setErr(json.error ?? "Could not raise invoice");
    });
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {(status === "scheduled" || status === "in_progress") && (
        <button
          onClick={markComplete}
          disabled={pending}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, background: pillar.teal.bg, color: pillar.teal.fg, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: pending ? "wait" : "pointer" }}
        >
          {pending ? "Updating…" : "Mark Complete"}
        </button>
      )}
      {status === "completed" && (
        <button
          onClick={raiseInvoice}
          disabled={pending}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, background: pillar.green.bg, color: pillar.green.fg, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: pending ? "wait" : "pointer" }}
        >
          {pending ? "Creating…" : "⊟ Raise Invoice"}
        </button>
      )}
      {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
    </div>
  );
}
