"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { PurchaseOrderLine } from "@/lib/types";

export default function ReceivePanel({ poId, lines }: { poId: string; lines: PurchaseOrderLine[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const pendingLines = lines.filter((l) => l.qty_received < l.qty_ordered);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = pendingLines
      .map((l) => ({ line_id: l.id, qty_now: parseFloat(qty[l.id] || "0") }))
      .filter((l) => l.qty_now > 0);
    if (payload.length === 0) { setError("Enter a quantity for at least one line"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/purchase-orders/${poId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: payload, note: note || null }),
      });
      if (res.ok) { setQty({}); setNote(""); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to receive"); }
    });
  }

  if (pendingLines.length === 0) return null;

  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
        Receive stock
      </div>
      <form onSubmit={submit}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {pendingLines.map((l) => {
            const remaining = l.qty_ordered - l.qty_received;
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, fontSize: 13, color: c.ink }}>
                  {l.description}
                  <span style={{ color: c.hint, fontSize: 11.5 }}> ({remaining} {l.uom ?? ""} remaining)</span>
                </div>
                <input
                  type="number" min="0" max={remaining} step="any"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                  placeholder="0"
                  style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: 10 }}>
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. delivery reference"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }}
          />
        </div>
        {error && <div style={{ marginBottom: 8, fontSize: 12, color: "#dc2626" }}>{error}</div>}
        <button
          type="submit" disabled={pending}
          style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: pending ? "wait" : "pointer" }}
        >
          {pending ? "Recording…" : "Record receipt"}
        </button>
      </form>
    </section>
  );
}
