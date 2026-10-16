"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { PurchaseOrderLine } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
    <Card title="Receive stock">
      <form onSubmit={submit}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {pendingLines.map((l) => {
            const remaining = l.qty_ordered - l.qty_received;
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px", fontSize: 13, color: c.ink }}>
                  {l.description}
                  <span style={{ color: c.hint, fontSize: 11.5 }}> ({remaining} {l.uom ?? ""} remaining)</span>
                </div>
                <Input
                  type="number" min="0" max={remaining} step="any"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                  placeholder="0"
                  aria-label={`Quantity received for ${l.description}`}
                  style={{ width: 100 }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: 10 }}>
          <Input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. delivery reference"
          />
        </div>
        {error && <div role="alert" style={{ marginBottom: 8, fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
        <Button type="submit" variant="primary" loading={pending}>Record receipt</Button>
      </form>
    </Card>
  );
}
