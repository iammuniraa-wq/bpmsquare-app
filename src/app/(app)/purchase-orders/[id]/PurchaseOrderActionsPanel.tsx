"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { PurchaseOrder } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

// Status transitions + delete. Field editing (order_date/expected_date/
// notes/terms) moved to ObjectSections -- this stays separate because these
// are real lifecycle actions, not field values.
export default function PurchaseOrderActionsPanel({ po }: { po: PurchaseOrder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function setStatus(status: "sent" | "cancelled") {
    if (status === "cancelled" && !confirm("Cancel this purchase order?")) return;
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to update status"); }
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete draft "${po.ref}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.purchaseOrders);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626" }}>
          {error}
        </div>
      )}

      {po.status === "draft" && (
        <button type="button" disabled={pending} onClick={() => setStatus("sent")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: c.accent, color: "#fff", borderRadius: 7,
          padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
          border: "none", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Mark as sent
        </button>
      )}

      {po.status === "draft" && (
        <button type="button" disabled={pending} onClick={handleDelete} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "#a32d2d", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Delete draft
        </button>
      )}
      {!["draft", "cancelled", "received"].includes(po.status) && (
        <button type="button" disabled={pending} onClick={() => setStatus("cancelled")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "#a32d2d", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Cancel order
        </button>
      )}
    </div>
  );
}
