"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import ItemTypeBadge from "@/components/products/ItemTypeBadge";

type Candidate = { id: string; ref: string | null; name: string; sku: string | null; item_type: string | null; item_type_label: string | null; uom: string | null; has_cost: boolean };

const BLANK = { qty: "1", uom: "", scrap: "0", kind: "consumed", note: "" };

/** "Add component": a searchable picker over this tenant's products (never the
 *  kit itself, what it already holds, or anything that would make a loop), then
 *  quantity, unit, scrap and kind. */
export default function BomAddComponent({ productId }: { productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || picked) return;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/${productId}/bom/candidates?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults((await res.json()).items ?? []);
      } catch { /* the list just stays as it was */ } finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [open, q, picked, productId]);

  function reset() { setOpen(false); setQ(""); setPicked(null); setForm(BLANK); setError(""); setResults([]); }

  async function add() {
    if (!picked) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/products/${productId}/bom`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component_product_id: picked.id, qty: form.qty, uom: form.uom || picked.uom, scrap_pct: form.scrap || 0, line_kind: form.kind, note: form.note || null }),
      });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not add the component"); return; }
      reset();
      router.refresh();
    } catch { setError("Network error"); } finally { setBusy(false); }
  }

  if (!open) {
    return <div style={{ padding: 14, borderTop: `1px solid ${c.line}` }}><Button onClick={() => setOpen(true)}>+ Add component</Button></div>;
  }

  return (
    <div style={{ padding: 16, borderTop: `1px solid ${c.line}`, background: c.panel2 }}>
      <div className="bpm-t-section" style={{ marginBottom: 10 }}>Add component</div>
      {!picked ? (
        <>
          <Input autoFocus aria-label="Search items" placeholder="Search by name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ marginTop: 8, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, maxHeight: 260, overflowY: "auto" }}>
            {results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>{searching ? "Searching…" : "No items found. Items already in this BOM, and ones that contain it, are left out."}</div>
            ) : results.map((r) => (
              <button key={r.id} type="button" onClick={() => { setPicked(r); setForm({ ...BLANK, uom: r.uom ?? "" }); }}
                style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "none", border: 0, borderBottom: `1px solid ${c.line}`, textAlign: "left", cursor: "pointer", color: c.ink, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                {r.sku && <span style={{ fontFamily: "monospace", fontSize: 11.5, color: c.hint }}>{r.sku}</span>}
                <ItemTypeBadge typeKey={r.item_type} label={r.item_type_label} />
                {!r.has_cost && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>no cost yet</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 13.5 }}>
            <strong>{picked.name}</strong>
            <ItemTypeBadge typeKey={picked.item_type} label={picked.item_type_label} />
            <Button variant="quiet" size="sm" onClick={() => setPicked(null)}>Change</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0 12px" }}>
            <Field label="Quantity" required><Input type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
            <Field label="Unit"><Input value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} /></Field>
            <Field label="Scrap %"><Input type="number" min="0" max="100" step="any" value={form.scrap} onChange={(e) => setForm({ ...form, scrap: e.target.value })} /></Field>
            <Field label="Kind" hint="A tool is used, not consumed, so it adds no material cost">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="consumed">Consumed</option><option value="used">Used (tool)</option>
              </Select>
            </Field>
          </div>
          <Field label="Note" style={{ marginBottom: 12 }}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </>
      )}
      {error && <div role="alert" style={{ margin: "10px 0", background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {picked && <Button variant="primary" loading={busy} onClick={add}>Add to BOM</Button>}
        <Button disabled={busy} onClick={reset}>Cancel</Button>
      </div>
    </div>
  );
}
