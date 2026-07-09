"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

const SUPPLIER_TYPES = [
  { value: "vendor",        label: "Vendor — sells parts / materials" },
  { value: "subcontractor", label: "Subcontractor — provides labour / specialist work" },
  { value: "both",          label: "Both vendor and subcontractor" },
];

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

export default function NewSupplierPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", type: "vendor", city: "", phone: "", email: "", gstin: "", notes: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.supplier(json.id));
      else setError(json.error ?? "Failed to create supplier");
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.suppliers} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All suppliers
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Supplier</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a vendor or subcontractor</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Supplier details</h3>
            <div style={fw}>
              <label style={lbl}>Name *</label>
              <input style={inp} value={form.name} onChange={set("name")} required placeholder="e.g. Bharat Electrical Stores" />
            </div>
            <div style={fw}>
              <label style={lbl}>Type *</label>
              <select style={inp} value={form.type} onChange={set("type")}>
                {SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Phone</label>
                <input style={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
              </div>
              <div>
                <label style={lbl}>City</label>
                <input style={inp} value={form.city} onChange={set("city")} placeholder="e.g. Mumbai" />
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Email</label>
              <input style={inp} type="email" value={form.email} onChange={set("email")} placeholder="contact@supplier.com" />
            </div>
            <div style={fw}>
              <label style={lbl}>GSTIN</label>
              <input style={inp} value={form.gstin} onChange={set("gstin")} placeholder="27AXXXX0000X1ZX" />
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="Payment terms, lead times, contact preferences…" />
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
              {pending ? "Saving…" : "Add Supplier"}
            </button>
            <Link href={ROUTES.suppliers} style={{
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
