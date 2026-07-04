"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Account, AccountType } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";

const TYPES: { value: AccountType; label: string }[] = [
  { value: "prospect",     label: "Prospect" },
  { value: "oem",          label: "OEM / Vendor" },
  { value: "direct",       label: "Direct customer" },
  { value: "end_customer", label: "End-customer (under OEM)" },
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
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 };

export default function AccountEditPanel({ account }: { account: Account }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name:  account.name,
    type:  account.type,
    city:  account.city  ?? "",
    phone: account.phone ?? "",
    email: account.email ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setSaved(true); setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          fontSize: 12, fontWeight: 600, color: c.muted,
          background: "none", border: `1px solid ${c.line}`,
          borderRadius: 6, padding: "5px 12px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.muted} /> Edit account</>}
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit account
      </div>
      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Type</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.type} onChange={set("type")}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>City</label>
          <input style={inp} value={form.city} onChange={set("city")} placeholder="e.g. Hosapete" />
        </div>
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Phone</label>
          <input style={inp} value={form.phone} onChange={set("phone")} placeholder="e.g. 98450 12345" />
        </div>
        <div>
          <label style={lbl}>Email</label>
          <input style={inp} type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" />
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{
          padding: "7px 16px", borderRadius: 7, border: "none",
          background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{
          padding: "7px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
          background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
