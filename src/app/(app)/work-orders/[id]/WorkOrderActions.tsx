"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkOrderStatus } from "@/lib/types";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";

/** The work order's one primary action: Mark Complete, then Raise Invoice. */
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
      if (res.ok) router.push(ROUTES.invoice(json.id));
      else setErr(json.error ?? "Could not raise invoice");
    });
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {err && <span role="alert" style={{ fontSize: 12, color: "var(--err-ink)" }}>{err}</span>}
      {(status === "scheduled" || status === "in_progress") && (
        <Button variant="primary" onClick={markComplete} loading={pending}>
          {pending ? "Updating…" : "Mark Complete"}
        </Button>
      )}
      {status === "completed" && (
        <Button variant="primary" onClick={raiseInvoice} loading={pending}>
          {pending ? "Creating…" : "Raise Invoice"}
        </Button>
      )}
    </div>
  );
}
