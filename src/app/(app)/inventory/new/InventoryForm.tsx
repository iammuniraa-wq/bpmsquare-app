"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";

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

export default function InventoryForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    sku: "", name: "", description: "", category: "", uom: "Nos",
    supplier_id: "", reorder_level: "", unit_cost: "", notes: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.inventoryItem(json.id));
      else setError(json.error ?? "Failed to create item");
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.inventory} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All inventory
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Inventory Item</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a stock item to track quantity on hand</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Item details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Name *</label>
                <input style={inp} value={form.name} onChange={set("name")} required placeholder="e.g. Copper winding wire 1.2mm" />
              </div>
              <div>
                <label style={lbl}>SKU</label>
                <input style={inp} value={form.sku} onChange={set("sku")} placeholder="e.g. WW-1.2MM" />
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Description</label>
              <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.description} onChange={set("description")} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Category</label>
                <input style={inp} value={form.category} onChange={set("category")} placeholder="e.g. Winding materials" />
              </div>
              <div>
                <label style={lbl}>UOM</label>
                <select style={inp} value={form.uom} onChange={set("uom")}>
                  {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Preferred supplier</label>
              <select style={inp} value={form.supplier_id} onChange={set("supplier_id")}>
                <option value="">— None —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Reorder level</label>
                <input style={inp} type="number" min="0" step="1" value={form.reorder_level} onChange={set("reorder_level")} placeholder="Alert when stock falls to/below this" />
              </div>
              <div>
                <label style={lbl}>Unit cost (₹)</label>
                <input style={inp} type="number" min="0" step="0.01" value={form.unit_cost} onChange={set("unit_cost")} />
              </div>
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={set("notes")} />
            </div>
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
              {pending ? "Saving…" : "Add Item"}
            </button>
            <Link href={ROUTES.inventory} style={{
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
