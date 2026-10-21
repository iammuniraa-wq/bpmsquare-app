"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Quantity breaks (0118, owner decision 2026-09-06): the product's own
// list of "from qty N, rate X" steps, kept here locally or synced from the
// ERP. The Standard Quote add-line panel offers exactly these when a rep
// says "yes, include quantity breaks". A blank rate means the break is
// priced the normal way (engine or list price) at that quantity.

type Row = { from: string; rate: string };

export default function ProductQtyBreaksCard({ productId, initial, uom }: {
  productId: string;
  initial: { from: number; rate: number | null }[] | null;
  uom: string | null;
}) {
  const cur = useCurrency();
  const inr = moneyFormatter(cur, { maximumFractionDigits: 2 });
  const toRows = (b: { from: number; rate: number | null }[] | null) => (b ?? []).map((x) => ({ from: String(x.from), rate: x.rate != null ? String(x.rate) : "" }));
  const [rows, setRows] = useState<Row[]>(toRows(initial));
  const [saved, setSaved] = useState<Row[]>(toRows(initial));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      const breaks = rows
        .map((r) => ({ from: parseFloat(r.from), rate: r.rate.trim() === "" ? null : parseFloat(r.rate) }))
        .filter((b) => Number.isFinite(b.from) && b.from > 0);
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty_breaks: breaks.length ? breaks : null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      const next = toRows((j.qty_breaks as { from: number; rate: number | null }[] | null) ?? null);
      setSaved(next); setRows(next); setEditing(false);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  return (
    <Card
      title="Quantity breaks"
      info="This is the product's price list with its quantity scales, replicated from your ERP or kept here. Quotes use it automatically."
      action={!editing ? <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}
    >
      {!editing ? (
        <div>
          {saved.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.muted }}>None — the quote offers the quantity typed on the line only.</div>
          ) : saved.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 4 }}>
              <span style={{ color: c.muted }}>From {r.from}{uom ? ` ${uom}` : ""}</span>
              <span style={{ color: c.ink }}>{r.rate ? inr(parseFloat(r.rate)) : "priced normally"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 30px", gap: 6, fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span>From qty</span><span>Rate</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 30px", gap: 6, alignItems: "center" }}>
              <Input type="number" min="0" step="any" value={r.from} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <Input type="number" min="0" step="0.01" placeholder="normal" value={r.rate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
              <Button variant="quiet" size="sm" iconOnly aria-label="Remove break" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <div>
            <Button variant="quiet" size="sm" onClick={() => setRows([...rows, { from: rows.length ? String((parseFloat(rows[rows.length - 1].from) || 0) * 5 || 10) : "10", rate: "" }])}>+ Add a break</Button>
          </div>
          {error && <div role="alert" style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Button variant="primary" size="sm" loading={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => { setRows(saved); setEditing(false); setError(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
