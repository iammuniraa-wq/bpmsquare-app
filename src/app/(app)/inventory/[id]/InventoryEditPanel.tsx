"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { InventoryItem } from "@/lib/types";
import { Pencil } from "@/components/Icons";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 7,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const fw: React.CSSProperties = { marginBottom: 12 };

export default function InventoryEditPanel({ item }: { item: InventoryItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/suppliers").then((r) => r.json()).then((rows) => setSuppliers(rows.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {});
  }, [open]);

  const [form, setForm] = useState({
    sku: item.sku ?? "",
    name: item.name,
    description: item.description ?? "",
    category: item.category ?? "",
    uom: item.uom,
    supplier_id: item.supplier_id ?? "",
    reorder_level: item.reorder_level != null ? String(item.reorder_level) : "",
    unit_cost: item.unit_cost != null ? String(item.unit_cost) : "",
    notes: item.notes ?? "",
    status: item.status,
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          supplier_id: form.supplier_id || null,
          reorder_level: form.reorder_level || null,
          unit_cost: form.unit_cost || null,
        }),
      });
      if (res.ok) { setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.inventory);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626" }}>
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: c.accentbg, color: c.accent, borderRadius: 7,
            padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${c.accent}40`, cursor: "pointer", width: "100%",
          }}
        >
          <Pencil size={13} color={c.accent} /> Edit item
        </button>
        <button
          type="button"
          onClick={handleDelete}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", color: "#a32d2d", borderRadius: 7,
            padding: "7px 14px", fontSize: 12, fontWeight: 500,
            border: `1px solid #f5c0c0`, cursor: "pointer", width: "100%",
          }}
        >
          Delete item
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} style={{
      background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>
        Edit item
      </div>

      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>
      <div style={fw}>
        <label style={lbl}>SKU</label>
        <input style={inp} value={form.sku} onChange={set("sku")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Status</label>
        <select style={inp} value={form.status} onChange={set("status")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Category</label>
        <input style={inp} value={form.category} onChange={set("category")} />
      </div>
      <div style={fw}>
        <label style={lbl}>UOM</label>
        <select style={inp} value={form.uom} onChange={set("uom")}>
          {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Preferred supplier</label>
        <select style={inp} value={form.supplier_id} onChange={set("supplier_id")}>
          <option value="">— None —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Reorder level</label>
        <input style={inp} type="number" min="0" step="1" value={form.reorder_level} onChange={set("reorder_level")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Unit cost (₹)</label>
        <input style={inp} type="number" min="0" step="0.01" value={form.unit_cost} onChange={set("unit_cost")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Description</label>
        <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={form.description} onChange={set("description")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Notes</label>
        <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={form.notes} onChange={set("notes")} />
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{
          flex: 1, padding: "8px 0", borderRadius: 7, border: "none",
          background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{
          padding: "8px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
          background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
