"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

export default function AdjustStockPanel({ itemId, uom }: { itemId: string; uom: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [qtyDelta, setQtyDelta] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const delta = parseFloat(qtyDelta);
    if (!delta) { setError("Enter a non-zero quantity"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/inventory/${itemId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty_delta: delta, note: note || null }),
      });
      if (res.ok) { setQtyDelta(""); setNote(""); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to adjust"); }
    });
  }

  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
        Adjust stock
      </div>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "0 0 140px" }}>
          <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Qty change ({uom})</label>
          <input
            type="number" step="any" value={qtyDelta} onChange={(e) => setQtyDelta(e.target.value)}
            placeholder="e.g. -5 or 20"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Reason (optional)</label>
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Physical count correction"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }}
          />
        </div>
        <button
          type="submit" disabled={pending}
          style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: pending ? "wait" : "pointer" }}
        >
          {pending ? "…" : "Apply"}
        </button>
      </form>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626" }}>{error}</div>}
      <div style={{ marginTop: 8, fontSize: 11, color: c.hint }}>
        Use a negative number to reduce stock (e.g. damaged/lost items), positive to add stock not tied to a purchase order.
      </div>
    </section>
  );
}
