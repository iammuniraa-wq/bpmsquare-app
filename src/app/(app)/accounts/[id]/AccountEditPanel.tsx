"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Account, AccountType } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import { useSalesConfig } from "@/lib/useSalesConfig";

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
const secHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 8px", paddingTop: 12, borderTop: `1px solid ${c.line}` };

export default function AccountEditPanel({ account }: { account: Account }) {
  const router = useRouter();
  const salesCfg = useSalesConfig();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name:  account.name,
    type:  account.type,
    // Address
    address_line1: account.address_line1 ?? "",
    address_line2: account.address_line2 ?? "",
    city:          account.city          ?? "",
    state:         account.state         ?? "",
    postal_code:   account.postal_code   ?? "",
    country:       account.country       ?? "",
    // Communication
    phone:   account.phone   ?? "",
    phone2:  account.phone2  ?? "",
    email:   account.email   ?? "",
    email2:  account.email2  ?? "",
    website: account.website ?? "",
    // Sales
    territory: account.territory ?? "",
    sales_org: account.sales_org ?? "",
    // Business
    industry:       account.industry       ?? "",
    employee_count: account.employee_count ?? "",
    annual_revenue: account.annual_revenue ?? "",
    gstin:          account.gstin          ?? "",
    notes:          account.notes          ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
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

      {/* Identity */}
      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>
      <div style={fw}>
        <label style={lbl}>Type</label>
        <select style={{ ...inp, cursor: "pointer" }} value={form.type} onChange={set("type")}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Address */}
      <div style={secHead}>Address</div>
      <div style={fw}>
        <label style={lbl}>Address line 1</label>
        <input style={inp} value={form.address_line1} onChange={set("address_line1")} placeholder="Street / building" />
      </div>
      <div style={fw}>
        <label style={lbl}>Address line 2</label>
        <input style={inp} value={form.address_line2} onChange={set("address_line2")} placeholder="Area / landmark" />
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>City</label>
          <input style={inp} value={form.city} onChange={set("city")} placeholder="Bengaluru" />
        </div>
        <div>
          <label style={lbl}>State</label>
          <input style={inp} value={form.state} onChange={set("state")} placeholder="Karnataka" />
        </div>
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Postal code</label>
          <input style={inp} value={form.postal_code} onChange={set("postal_code")} placeholder="560001" />
        </div>
        <div>
          <label style={lbl}>Country</label>
          <input style={inp} value={form.country} onChange={set("country")} placeholder="India" />
        </div>
      </div>

      {/* Communication */}
      <div style={secHead}>Communication</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Primary phone</label>
          <input style={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98450 12345" />
        </div>
        <div>
          <label style={lbl}>Secondary phone</label>
          <input style={inp} value={form.phone2} onChange={set("phone2")} placeholder="+91 98450 12346" />
        </div>
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Primary email</label>
          <input style={inp} type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" />
        </div>
        <div>
          <label style={lbl}>Secondary email</label>
          <input style={inp} type="email" value={form.email2} onChange={set("email2")} placeholder="info@company.com" />
        </div>
      </div>
      <div style={fw}>
        <label style={lbl}>Website</label>
        <input style={inp} value={form.website} onChange={set("website")} placeholder="https://company.com" />
      </div>

      {/* Sales */}
      <div style={secHead}>Sales</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Territory</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.territory} onChange={set("territory")}>
            <option value="">— None —</option>
            {salesCfg.territories.map((t) => <option key={t} value={t}>{t}</option>)}
            {form.territory && !salesCfg.territories.includes(form.territory) && (
              <option value={form.territory}>{form.territory}</option>
            )}
          </select>
        </div>
        <div>
          <label style={lbl}>Sales org</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.sales_org} onChange={set("sales_org")}>
            <option value="">— None —</option>
            {salesCfg.sales_orgs.map((s) => <option key={s} value={s}>{s}</option>)}
            {form.sales_org && !salesCfg.sales_orgs.includes(form.sales_org) && (
              <option value={form.sales_org}>{form.sales_org}</option>
            )}
          </select>
        </div>
      </div>

      {/* Business */}
      <div style={secHead}>Business</div>
      <div style={fw}>
        <label style={lbl}>Industry</label>
        <input style={inp} value={form.industry} onChange={set("industry")} placeholder="e.g. Textile Manufacturing" />
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Employees</label>
          <input style={inp} value={form.employee_count} onChange={set("employee_count")} placeholder="250" />
        </div>
        <div>
          <label style={lbl}>Annual revenue</label>
          <input style={inp} value={form.annual_revenue} onChange={set("annual_revenue")} placeholder="₹5 Cr" />
        </div>
      </div>
      <div style={fw}>
        <label style={lbl}>GSTIN</label>
        <input style={inp} value={form.gstin} onChange={set("gstin")} placeholder="27AABCV1234F1Z5" />
      </div>
      <div style={fw}>
        <label style={lbl}>Notes</label>
        <textarea
          style={{ ...inp, minHeight: 70, resize: "vertical" }}
          value={form.notes}
          onChange={set("notes")}
          placeholder="Any notes about this account…"
        />
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
