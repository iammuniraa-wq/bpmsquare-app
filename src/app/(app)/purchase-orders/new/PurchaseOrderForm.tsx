"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

type InventoryOption = { id: string; sku: string | null; name: string; uom: string; unit_cost: number | null };

type Line = {
  id: string;
  inventory_item_id: string | null;
  description: string;
  uom: string;
  qty_ordered: string;
  rate: string;
};

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function newLine(): Line {
  return { id: Math.random().toString(36).slice(2), inventory_item_id: null, description: "", uom: "Nos", qty_ordered: "1", rate: "0" };
}

export default function PurchaseOrderForm({
  suppliers, quotes, cases, items,
}: {
  suppliers: { id: string; name: string }[];
  quotes: { id: string; ref: string }[];
  cases: { id: string; ref: string }[];
  items: InventoryOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickInventoryItem(id: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) { updateLine(id, { inventory_item_id: null }); return; }
    updateLine(id, {
      inventory_item_id: item.id,
      description: item.sku ? `${item.name} (${item.sku})` : item.name,
      uom: item.uom,
      rate: item.unit_cost != null ? String(item.unit_cost) : "0",
    });
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.qty_ordered) || 0) * (parseFloat(l.rate) || 0), 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Supplier is required"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          quote_id: quoteId || null,
          case_id: caseId || null,
          order_date: orderDate || null,
          expected_date: expectedDate || null,
          notes: notes || null,
          terms: terms || null,
          lines: cleanLines.map((l) => ({
            inventory_item_id: l.inventory_item_id,
            description: l.description,
            uom: l.uom,
            qty_ordered: l.qty_ordered,
            rate: l.rate,
          })),
        }),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.purchaseOrder(json.id));
      else setError(json.error ?? "Failed to create purchase order");
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.purchaseOrders} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All purchase orders
        </Link>
      </div>

      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Purchase Order</h1>
          <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Order stock from a supplier</p>
        </div>
        <AdaptObjectDrawer objectType="purchase_order" objectLabel="Purchase Order" isAdmin={true} />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Order details</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Supplier *</label>
                  <select style={inp} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    <option value="">— Select supplier —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Order date</label>
                  <input style={inp} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Linked quote <span style={{ color: c.hint, textTransform: "none", fontWeight: 400 }}>(optional)</span></label>
                  <select style={inp} value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                    <option value="">— None —</option>
                    {quotes.map((q) => <option key={q.id} value={q.id}>{q.ref}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Linked case <span style={{ color: c.hint, textTransform: "none", fontWeight: 400 }}>(optional)</span></label>
                  <select style={inp} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                    <option value="">— None —</option>
                    {cases.map((cs) => <option key={cs.id} value={cs.id}>{cs.ref}</option>)}
                  </select>
                </div>
              </div>
              <div style={fw}>
                <label style={lbl}>Expected delivery date</label>
                <input style={inp} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div style={fw}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Terms</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, delivery conditions…" />
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: 0 }}>Line items</h3>
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, newLine()])}
                  style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                >
                  + Add line
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lines.map((line, idx) => (
                  <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.hint }}>Line {idx + 1}</span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))}
                          style={{ marginLeft: "auto", background: "none", border: "none", color: "#a32d2d", fontSize: 12, cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={fw}>
                      <label style={lbl}>From inventory <span style={{ color: c.hint, textTransform: "none", fontWeight: 400 }}>(optional — autofills below)</span></label>
                      <select style={inp} value={line.inventory_item_id ?? ""} onChange={(e) => pickInventoryItem(line.id, e.target.value)}>
                        <option value="">— Free-text line —</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.sku ? `${i.name} (${i.sku})` : i.name}</option>)}
                      </select>
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Description *</label>
                      <input style={inp} value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being ordered" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={lbl}>UOM</label>
                        <select style={inp} value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
                          {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Qty</label>
                        <input style={inp} type="number" min="0" step="any" value={line.qty_ordered} onChange={(e) => updateLine(line.id, { qty_ordered: e.target.value })} />
                      </div>
                      <div>
                        <label style={lbl}>Rate (₹)</label>
                        <input style={inp} type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, { rate: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                      = {inr((parseFloat(line.qty_ordered) || 0) * (parseFloat(line.rate) || 0))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Total: {inr(total)}</div>
              </div>
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
                {error}
              </div>
            )}
            <button
              type="submit" disabled={pending}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              {pending ? "Saving…" : "Create Purchase Order"}
            </button>
            <Link href={ROUTES.purchaseOrders} style={{
              display: "block", textAlign: "center", padding: "10px 0",
              borderRadius: 8, border: `1px solid ${c.line}`,
              color: c.muted, fontSize: 13, textDecoration: "none",
            }}>
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
