"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

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

export default function NewProductPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", sku: "", category: "", uom: "", description: "",
    list_price: "", cost_price: "", tax_percent: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not create the product"); return; }
      router.push(ROUTES.product(json.id));
    });
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.products} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All products
        </Link>
      </div>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>New product</h1>

      <form onSubmit={handleSubmit} style={{ ...cardStyle, padding: 20 }}>
        <div style={fw}>
          <label style={lbl}>Name *</label>
          <input style={inp} value={form.name} onChange={set("name")} placeholder="e.g. Passenger Elevator 8P (630 kg)" autoFocus />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={fw}>
            <label style={lbl}>SKU</label>
            <input style={inp} value={form.sku} onChange={set("sku")} placeholder="ELV-P8-630" />
          </div>
          <div style={fw}>
            <label style={lbl}>Category</label>
            <input style={inp} value={form.category} onChange={set("category")} placeholder="Elevators" />
          </div>
          <div style={fw}>
            <label style={lbl}>Unit of measure</label>
            <input style={inp} value={form.uom} onChange={set("uom")} placeholder="Nos / Hrs / Job / Yr" />
          </div>
          <div style={fw}>
            <label style={lbl}>Tax %</label>
            <input style={inp} type="number" step="0.01" value={form.tax_percent} onChange={set("tax_percent")} placeholder="18" />
          </div>
          <div style={fw}>
            <label style={lbl}>List price (₹)</label>
            <input style={inp} type="number" step="0.01" value={form.list_price} onChange={set("list_price")} placeholder="External selling price" />
          </div>
          <div style={fw}>
            <label style={lbl}>Cost price (₹)</label>
            <input style={inp} type="number" step="0.01" value={form.cost_price} onChange={set("cost_price")} placeholder="Internal cost" />
          </div>
        </div>
        <div style={fw}>
          <label style={lbl}>Description</label>
          <textarea style={{ ...inp, resize: "vertical" }} rows={3} value={form.description} onChange={set("description")} placeholder="What this product includes" />
        </div>

        {error && <div style={{ color: "var(--redink, #c2402f)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
            background: c.accent, color: "#fff", fontSize: 13.5, fontWeight: 600,
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Creating…" : "Create product"}
        </button>
      </form>
    </div>
  );
}
