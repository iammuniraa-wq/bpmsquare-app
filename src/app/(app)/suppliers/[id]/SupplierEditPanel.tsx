"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Supplier } from "@/lib/types";
import { Pencil } from "@/components/Icons";
import { ROUTES } from "@/lib/constants";

const SUPPLIER_TYPES = [
  { value: "vendor",        label: "Vendor" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "both",          label: "Both" },
];

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

export default function SupplierEditPanel({ supplier }: { supplier: Supplier }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name:   supplier.name,
    type:   supplier.type,
    city:   supplier.city   ?? "",
    phone:  supplier.phone  ?? "",
    email:  supplier.email  ?? "",
    gstin:  supplier.gstin  ?? "",
    notes:  supplier.notes  ?? "",
    status: supplier.status,
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete "${supplier.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/suppliers/${supplier.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.suppliers);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
          <Pencil size={13} color={c.accent} /> Edit supplier
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
          Delete supplier
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} style={{
      background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>
        Edit supplier
      </div>

      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>
      <div style={fw}>
        <label style={lbl}>Type</label>
        <select style={inp} value={form.type} onChange={set("type")}>
          {SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Status</label>
        <select style={inp} value={form.status} onChange={set("status")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div style={fw}>
        <label style={lbl}>Phone</label>
        <input style={inp} value={form.phone} onChange={set("phone")} />
      </div>
      <div style={fw}>
        <label style={lbl}>City</label>
        <input style={inp} value={form.city} onChange={set("city")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Email</label>
        <input style={inp} type="email" value={form.email} onChange={set("email")} />
      </div>
      <div style={fw}>
        <label style={lbl}>GSTIN</label>
        <input style={inp} value={form.gstin} onChange={set("gstin")} />
      </div>
      <div style={fw}>
        <label style={lbl}>Notes</label>
        <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={set("notes")} />
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
