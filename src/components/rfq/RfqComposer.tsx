"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { UOM_OPTIONS } from "@/lib/constants";
import type { RfqOriginType } from "@/lib/rfq/types";
import { inp, lbl, btnPrimary, btnGhost } from "./rfqUi";

// The one RFQ create form -- the New RFQ page and every "Request quotation"
// dialog (quotes, deals, cases, inspections, work orders, fence projects)
// render this, so an RFQ is born the same way wherever it starts.

export type ComposerLine = {
  product_id?: string | null;
  description: string;
  spec?: string | null;
  uom?: string | null;
  qty?: number | string | null;
};

type Supplier = { id: string; name: string; email: string | null; city: string | null; status: string; ref?: string | null };
type Product = { id: string; name: string; ref: string | null; uom: string | null };

export default function RfqComposer({
  origin, originLabel, initialLines, initialTitle, onCreated, onCancel, compact,
}: {
  origin?: { type: RfqOriginType; id: string | null };
  originLabel?: string | null;
  initialLines?: ComposerLine[];
  initialTitle?: string;
  onCreated: (r: { id: string; ref: string; line_ids: string[]; sent?: { supplier: string; ok: boolean; reason?: string }[] }) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [lines, setLines] = useState<ComposerLine[]>(initialLines?.length ? initialLines : [{ description: "", qty: 1, uom: "Nos" }]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [respondBy, setRespondBy] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "send">(null);
  const [suggested, setSuggested] = useState<{ supplier_id: string; name: string; awarded: number; quoted: number; last_awarded_at: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])).then((d) => setSuppliers(Array.isArray(d) ? d.filter((s: Supplier) => s.status !== "inactive") : [])).catch(() => {});
    fetch("/api/products").then((r) => (r.ok ? r.json() : null)).then((d) => setProducts(Array.isArray(d) ? d : null)).catch(() => {});
  }, []);

  // Suppliers this tenant has asked, heard from or awarded for these products
  // before -- pre-ticks the ones that actually won, once, as a starting point.
  const productKey = [...new Set(lines.map((l) => l.product_id).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!productKey) { setSuggested([]); return; }
    let cancelled = false;
    fetch(`/api/rfqs/suggest-suppliers?product_ids=${productKey}`).then((r) => (r.ok ? r.json() : { suppliers: [] })).then((j) => {
      if (cancelled) return;
      const list = (j.suppliers ?? []) as typeof suggested;
      setSuggested(list);
      setChosen((cs) => (cs.length ? cs : list.filter((s) => s.awarded > 0).slice(0, 3).map((s) => s.supplier_id)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [productKey]);

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return suppliers.filter((s) => !t || `${s.name} ${s.city ?? ""} ${s.email ?? ""}`.toLowerCase().includes(t)).slice(0, 60);
  }, [suppliers, filter]);

  const setLine = (i: number, p: Partial<ComposerLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const toggle = (id: string) => setChosen((cs) => (cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id]));
  const noEmail = chosen.filter((id) => !suppliers.find((s) => s.id === id)?.email);

  async function save(send: boolean) {
    setBusy(send ? "send" : "draft");
    setError(null);
    try {
      const body = {
        title: title.trim() || null,
        origin_type: origin?.type ?? "manual",
        origin_id: origin?.id ?? null,
        respond_by: respondBy || null,
        required_by: requiredBy || null,
        delivery_terms: delivery || null,
        notes_to_supplier: notes || null,
        notes_internal: internal || null,
        lines: lines.filter((l) => l.description.trim() || l.product_id).map((l) => ({ ...l, qty: l.qty === "" ? null : l.qty })),
        supplier_ids: chosen,
        send,
      };
      if (!body.lines.length) throw new Error("Add at least one line.");
      if (send && !chosen.length) throw new Error("Choose at least one supplier to send to.");
      const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not create the RFQ.");
      onCreated(j);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const grid2: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {originLabel && (
        <div style={{ fontSize: 12.5, color: c.muted }}>For <strong style={{ color: c.ink }}>{originLabel}</strong> — the customer and your prices are never shown to suppliers.</div>
      )}
      <div>
        <label style={lbl} htmlFor="rfq-title">Title</label>
        <input id="rfq-title" style={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What you're buying — taken from the first line if left blank" />
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={lbl}>Items to price</span>
          <button type="button" style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }} onClick={() => setLines((ls) => [...ls, { description: "", qty: 1, uom: "Nos" }])}>+ Line</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10, display: "grid", gap: 8, gridTemplateColumns: compact ? "1fr" : "minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {products && products.length > 0 && (
                  <select aria-label={`Line ${i + 1} product`} style={inp} value={l.product_id ?? ""} onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setLine(i, { product_id: p?.id ?? null, description: p ? p.name : l.description, uom: p?.uom ?? l.uom });
                  }}>
                    <option value="">Free-text item (not in the catalog)</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
                  </select>
                )}
                <input aria-label={`Line ${i + 1} description`} style={inp} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" />
                <input aria-label={`Line ${i + 1} specification`} style={inp} value={l.spec ?? ""} onChange={(e) => setLine(i, { spec: e.target.value })} placeholder="Specification, drawing no., grade (optional)" />
              </div>
              <div>
                <label style={lbl}>Qty</label>
                <input aria-label={`Line ${i + 1} quantity`} style={inp} inputMode="decimal" value={l.qty ?? ""} onChange={(e) => setLine(i, { qty: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>UOM</label>
                <select aria-label={`Line ${i + 1} unit`} style={inp} value={l.uom ?? ""} onChange={(e) => setLine(i, { uom: e.target.value })}>
                  {[...new Set([...(l.uom ? [l.uom] : []), ...UOM_OPTIONS])].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ ...btnGhost, padding: "7px 10px", opacity: lines.length === 1 ? 0.4 : 1 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span style={lbl}>Suppliers to ask {chosen.length ? `(${chosen.length})` : ""}</span>
        {suggested.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 0 8px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: c.hint }}>From your history:</span>
            {suggested.map((s) => {
              const on = chosen.includes(s.supplier_id);
              return (
                <button key={s.supplier_id} type="button" onClick={() => toggle(s.supplier_id)} title={s.awarded ? `Won ${s.awarded} time${s.awarded === 1 ? "" : "s"}${s.last_awarded_at ? `, last ${new Date(s.last_awarded_at).toLocaleDateString("en-GB")}` : ""}` : `Quoted ${s.quoted} time${s.quoted === 1 ? "" : "s"}`}
                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : c.panel, color: on ? c.accent : c.ink }}>
                  {on ? "✓ " : ""}{s.name}{s.awarded ? ` · won ${s.awarded}` : s.quoted ? ` · quoted ${s.quoted}` : ""}
                </button>
              );
            })}
          </div>
        )}
        <input style={{ ...inp, marginBottom: 8 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={suppliers.length ? "Search suppliers…" : "No suppliers yet — add them under Master data → Suppliers"} />
        <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
          {shown.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${c.line}`, cursor: "pointer", fontSize: 13, color: c.ink }}>
              <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: c.hint, marginLeft: 6, fontSize: 12 }}>{[s.city, s.email ?? "no email"].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))}
          {!shown.length && <div style={{ padding: 12, fontSize: 12.5, color: c.hint }}>No suppliers match.</div>}
        </div>
        {noEmail.length > 0 && <div style={{ fontSize: 12, color: "var(--amberink)", marginTop: 6 }}>{noEmail.length} chosen supplier{noEmail.length === 1 ? " has" : "s have"} no email — they can be sent the reply link on WhatsApp from the RFQ.</div>}
      </div>

      <div style={grid2}>
        <div><label style={lbl} htmlFor="rfq-rb">Reply by</label><input id="rfq-rb" type="date" style={inp} value={respondBy} onChange={(e) => setRespondBy(e.target.value)} /></div>
        <div><label style={lbl} htmlFor="rfq-req">Needed by</label><input id="rfq-req" type="date" style={inp} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></div>
        <div><label style={lbl} htmlFor="rfq-del">Delivery terms</label><input id="rfq-del" style={inp} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="e.g. DAP Doha" /></div>
      </div>
      <div style={grid2}>
        <div><label style={lbl} htmlFor="rfq-ns">Note to suppliers</label><textarea id="rfq-ns" rows={2} style={{ ...inp, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div><label style={lbl} htmlFor="rfq-ni">Internal note</label><textarea id="rfq-ni" rows={2} style={{ ...inp, resize: "vertical" }} value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Never sent to suppliers" /></div>
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: "var(--redink)", background: "var(--redbg)", padding: "8px 12px", borderRadius: 7 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onCancel && <button type="button" style={btnGhost} onClick={onCancel} disabled={!!busy}>Cancel</button>}
        <button type="button" style={btnGhost} onClick={() => save(false)} disabled={!!busy}>{busy === "draft" ? "Saving…" : "Save as draft"}</button>
        <button type="button" style={{ ...btnPrimary, opacity: chosen.length ? 1 : 0.6 }} onClick={() => save(true)} disabled={!!busy}>{busy === "send" ? "Sending…" : `Send to ${chosen.length || ""} supplier${chosen.length === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  );
}
