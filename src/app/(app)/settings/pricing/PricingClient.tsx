"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PricingItem, PricingCategory } from "@/lib/types";
import { c } from "@/lib/theme";
import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";

const CAT_TONE: Record<PricingCategory, PillarKey> = {
  labour: "blue", material: "teal", testing: "purple", transport: "amber",
};
export const PRICING_CATEGORY_LABEL: Record<PricingCategory, string> = {
  labour: "Labour", material: "Material", testing: "Testing", transport: "Transport",
};
const CATEGORIES: PricingCategory[] = ["labour", "material", "testing", "transport"];

const inputSt: React.CSSProperties = {
  height: 34, border: `1px solid ${c.line}`, borderRadius: 7,
  padding: "0 9px", fontSize: 12.5, width: "100%", boxSizing: "border-box", color: c.ink,
};

function AddRow({ onAdd }: { onAdd: (item: PricingItem) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ category: "labour" as PricingCategory, description: "", unit: "", rate: "", notes: "" });
  const [err, setErr] = useState("");

  function set(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description || !form.unit) { setErr("Description and unit are required"); return; }
    setErr("");
    startTransition(async () => {
      const res = await fetch("/api/settings/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, rate: parseFloat(form.rate) || 0 }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? "Failed"); return; }
      onAdd(json);
      setForm({ category: "labour", description: "", unit: "", rate: "", notes: "" });
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: c.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
        + Add item
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ background: "#f8fafc", border: `1px solid ${c.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: c.ink }}>New pricing item</div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 110px 100px", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Category</label>
          <select style={{ ...inputSt }} value={form.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{PRICING_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Description *</label>
          <input style={inputSt} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Rewinding — LT Motor up to 50 HP" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Unit *</label>
          <input style={inputSt} value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="per job" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Rate (₹)</label>
          <input style={inputSt} type="number" min="0" value={form.rate} onChange={(e) => set("rate", e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Notes (optional)</label>
        <input style={inputSt} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any extra detail…" />
      </div>
      {err && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{ padding: "7px 20px", borderRadius: 7, background: c.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ padding: "7px 16px", borderRadius: 7, background: "#f1f5f9", color: c.muted, border: "none", fontSize: 13, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemRow({ item, onUpdate, onDelete }: { item: PricingItem; onUpdate: (item: PricingItem) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ description: item.description, unit: item.unit, rate: String(item.rate), notes: item.notes ?? "" });

  function set(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/settings/pricing/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: form.description, unit: form.unit, rate: parseFloat(form.rate) || 0, notes: form.notes || null }),
      });
      const json = await res.json();
      if (res.ok) { onUpdate(json); setEditing(false); }
    });
  }

  function del() {
    if (!window.confirm("Delete this pricing item?")) return;
    startTransition(async () => {
      await fetch(`/api/settings/pricing/${item.id}`, { method: "DELETE" });
      onDelete(item.id);
    });
  }

  if (editing) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px 80px", gap: 10, padding: "10px 0", borderBottom: `1px solid ${c.line}`, alignItems: "center" }}>
        <input style={inputSt} value={form.description} onChange={(e) => set("description", e.target.value)} />
        <input style={inputSt} value={form.unit} onChange={(e) => set("unit", e.target.value)} />
        <input style={{ ...inputSt }} type="number" value={form.rate} onChange={(e) => set("rate", e.target.value)} />
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={save} disabled={pending} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>
            {pending ? "…" : "✓"}
          </button>
          <button onClick={() => setEditing(false)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, background: "#f1f5f9", color: c.muted, border: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px 80px", gap: 12, padding: "10px 0", borderBottom: `1px solid ${c.line}`, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 13, color: c.ink }}>{item.description}</div>
        {item.notes && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{item.notes}</div>}
      </div>
      <div style={{ fontSize: 12.5, color: c.muted }}>{item.unit}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>₹{item.rate.toLocaleString("en-IN")}</div>
      <div style={{ display: "flex", gap: 5 }}>
        <button onClick={() => setEditing(true)} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: c.accentbg, color: c.accent, border: "none", cursor: "pointer" }}>Edit</button>
        <button onClick={del} disabled={pending} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: "#fef2f2", color: "#dc2626", border: "none", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}

export default function PricingClient({ initialItems }: { initialItems: PricingItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);

  const add = (item: PricingItem) => { setItems((p) => [...p, item]); router.refresh(); };
  const update = (item: PricingItem) => setItems((p) => p.map((i) => i.id === item.id ? item : i));
  const remove = (id: string) => setItems((p) => p.filter((i) => i.id !== id));

  return (
    <>
      <AddRow onAdd={add} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {CATEGORIES.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          return (
            <section key={cat} style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Pill label={PRICING_CATEGORY_LABEL[cat]} tone={CAT_TONE[cat]} />
                <span style={{ fontSize: 12, color: c.hint }}>{catItems.length} items</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px 80px", gap: 12, padding: "0 0 6px", borderBottom: `1px solid ${c.line}` }}>
                {["Description", "Unit", "Rate (₹)", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
                ))}
              </div>
              {catItems.length === 0 && (
                <div style={{ padding: "16px 0", fontSize: 12.5, color: c.hint }}>No items yet — add one above.</div>
              )}
              {catItems.map((item) => (
                <ItemRow key={item.id} item={item} onUpdate={update} onDelete={remove} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
