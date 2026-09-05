"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

// Cost sheet (BPMSquare Pricing, cost-based step 3): what ONE unit of this
// product consumes -- copper kg, labour hours, salvage kg -- as quantities
// against the cost model's paths. The engine multiplies by the line
// quantity and prices each path through the source ladder. A product with
// no sheet is one bought-in part priced at its cost price.

type Row = { path: string; qty: string; kind: string };
const KINDS = [
  { value: "", label: "(from cost model)" },
  { value: "PURCHASE", label: "Bought-in part" }, { value: "MATERIAL", label: "Material" }, { value: "LABOUR", label: "Labour" },
  { value: "EQUIPMENT", label: "Equipment" }, { value: "SALVAGE_CREDIT", label: "Salvage credit" }, { value: "OVERHEAD", label: "Overhead" },
];
const SUGGESTED_PATHS = ["material.rate_per_unit", "labour.rate_per_hour", "salvage.credit_per_unit", "purchase.unit_cost"];

const inp: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel2, color: c.ink, boxSizing: "border-box", width: "100%" };
const link: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };

export default function ProductCostSheetCard({ productId, initial, initialAsOf, costPrice }: {
  productId: string;
  initial: { path: string; qty: number; kind?: string }[] | null;
  initialAsOf: string | null;
  costPrice: number | null;
}) {
  const [rows, setRows] = useState<Row[]>((initial ?? []).map((r) => ({ path: r.path, qty: String(r.qty), kind: r.kind ?? "" })));
  const [asOf, setAsOf] = useState(initialAsOf ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ rows: Row[]; asOf: string }>({ rows: (initial ?? []).map((r) => ({ path: r.path, qty: String(r.qty), kind: r.kind ?? "" })), asOf: initialAsOf ?? "" });

  async function save() {
    setSaving(true); setError("");
    try {
      const sheet = rows.filter((r) => r.path.trim()).map((r) => ({ path: r.path.trim(), qty: parseFloat(r.qty) || 0, ...(r.kind ? { kind: r.kind } : {}) }));
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cost_sheet: sheet.length ? sheet : null, cost_price_as_of: asOf || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      setSaved({ rows: sheet.map((r) => ({ path: r.path, qty: String(r.qty), kind: r.kind ?? "" })), asOf });
      setRows(sheet.map((r) => ({ path: r.path, qty: String(r.qty), kind: r.kind ?? "" })));
      setEditing(false);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  const ageDays = saved.asOf ? Math.round((Date.now() - Date.parse(saved.asOf)) / 86_400_000) : null;

  return (
    <section style={{ ...cardStyle, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Cost sheet</div>
        {!editing && <button style={link} onClick={() => setEditing(true)}>Edit</button>}
      </div>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 4, lineHeight: 1.45 }}>
        What one unit consumes, for cost-based pricing. Empty means one bought-in part at the cost price.
      </div>

      {!editing ? (
        <div style={{ marginTop: 8 }}>
          {saved.rows.length === 0 ? (
            <div style={{ fontSize: 12, color: c.muted }}>
              Bought-in at {costPrice != null ? `₹${costPrice.toLocaleString("en-IN")}` : "cost price (not set)"}
            </div>
          ) : saved.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span style={{ fontFamily: "monospace", color: c.muted }}>{r.path}</span>
              <span style={{ color: c.ink }}>{r.qty}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: ageDays !== null && ageDays > 30 ? "var(--amberink)" : c.hint, marginTop: 8 }}>
            Cost price as of {saved.asOf || "—"}{ageDays !== null ? ` · ${ageDays} day${ageDays === 1 ? "" : "s"} old` : ""}
            {ageDays !== null && ageDays > 30 ? " · the engine will treat it as stale" : ""}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 64px 110px 20px", gap: 6, alignItems: "center" }}>
              <input list={`paths-${productId}`} style={inp} placeholder="material.rate_per_unit" value={r.path} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} />
              <input type="number" min="0" step="0.01" style={inp} value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <select style={inp} value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button style={{ ...link, color: "var(--err-ink)" }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <datalist id={`paths-${productId}`}>{SUGGESTED_PATHS.map((p) => <option key={p} value={p} />)}</datalist>
          <button style={{ ...link, alignSelf: "flex-start" }} onClick={() => setRows([...rows, { path: "", qty: "1", kind: "" }])}>+ Add a cost line</button>
          <label style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>
            Cost price as of
            <input type="date" style={{ ...inp, marginTop: 3 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
          {error && <div style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button disabled={saving} onClick={save} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6, border: "none", background: c.accent, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
            <button disabled={saving} onClick={() => { setRows(saved.rows); setAsOf(saved.asOf); setEditing(false); setError(""); }} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: `1px solid ${c.line}`, background: "transparent", color: c.muted, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
