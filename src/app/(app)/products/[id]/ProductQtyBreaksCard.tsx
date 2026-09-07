"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import { cardStyle } from "@/components/Shell";

// Quantity breaks (0118, owner decision 2026-09-06): the product's own
// list of "from qty N, rate X" steps, kept here locally or synced from the
// ERP. The Standard Quote add-line panel offers exactly these when a rep
// says "yes, include quantity breaks". A blank rate means the break is
// priced the normal way (engine or list price) at that quantity.

type Row = { from: string; rate: string };

const inp: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel2, color: c.ink, boxSizing: "border-box", width: "100%" };
const link: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };

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
        .filter((b) => Number.isFinite(b.from) && b.from > 1);
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
    <section style={{ ...cardStyle, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Quantity breaks</div>
        {!editing && <button style={link} onClick={() => setEditing(true)}>Edit</button>}
      </div>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 4, lineHeight: 1.45 }}>
        Quantities this product is offered at another rate from. Quotes offer these when a rep adds the product. Leave the rate blank to price it normally at that quantity.
      </div>

      {!editing ? (
        <div style={{ marginTop: 8 }}>
          {saved.length === 0 ? (
            <div style={{ fontSize: 12, color: c.muted }}>None — the quote offers the quantity typed on the line only.</div>
          ) : saved.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span style={{ color: c.muted }}>From {r.from}{uom ? ` ${uom}` : ""}</span>
              <span style={{ color: c.ink }}>{r.rate ? inr(parseFloat(r.rate)) : "priced normally"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 20px", gap: 6, fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span>From qty</span><span>Rate ({cur.symbol}, optional)</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 20px", gap: 6, alignItems: "center" }}>
              <input type="number" min="2" step="1" style={inp} value={r.from} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <input type="number" min="0" step="0.01" style={inp} placeholder="normal" value={r.rate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
              <button style={{ ...link, color: "var(--err-ink)" }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button style={{ ...link, alignSelf: "flex-start" }} onClick={() => setRows([...rows, { from: rows.length ? String((parseFloat(rows[rows.length - 1].from) || 0) * 5 || 10) : "10", rate: "" }])}>+ Add a break</button>
          {error && <div style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button disabled={saving} onClick={save} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6, border: "none", background: c.accent, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
            <button disabled={saving} onClick={() => { setRows(saved); setEditing(false); setError(""); }} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: `1px solid ${c.line}`, background: "transparent", color: c.muted, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
