"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

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
    <Card title="Adjust stock">
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={`Qty change (${uom})`} style={{ flex: "1 1 140px", marginBottom: 0 }}>
          <Input type="number" step="any" value={qtyDelta} onChange={(e) => setQtyDelta(e.target.value)} placeholder="e.g. -5 or 20" />
        </Field>
        <Field label="Reason (optional)" style={{ flex: "2 1 180px", marginBottom: 0 }}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Physical count correction" />
        </Field>
        <Button type="submit" variant="primary" loading={pending}>Apply</Button>
      </form>
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
      <div style={{ marginTop: 8, fontSize: 11, color: c.hint }}>
        Use a negative number to reduce stock (e.g. damaged/lost items), positive to add stock not tied to a purchase order.
      </div>
    </Card>
  );
}
