"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Contact } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import { useSalesConfig } from "@/lib/useSalesConfig";

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

interface Props {
  contact: Contact;
  accountAddress?: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
}

export default function ContactEditPanel({ contact, accountAddress }: Props) {
  const router = useRouter();
  const salesCfg = useSalesConfig();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name:         contact.name,
    role:         contact.role         ?? "",
    department:   contact.department   ?? "",
    phone:        contact.phone        ?? "",
    phone2:       contact.phone2       ?? "",
    phone3:       contact.phone3       ?? "",
    email:        contact.email        ?? "",
    email2:       contact.email2       ?? "",
    website:      contact.website      ?? "",
    linkedin_url: contact.linkedin_url ?? "",
    birthday:     contact.birthday     ?? "",
    address_line1: contact.address_line1 ?? "",
    address_line2: contact.address_line2 ?? "",
    city:          contact.city          ?? "",
    state:         contact.state         ?? "",
    postal_code:   contact.postal_code   ?? "",
    country:       contact.country       ?? "",
    territory:     contact.territory     ?? "",
    sales_org:     contact.sales_org     ?? "",
    notes:         contact.notes         ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function copyFromAccount() {
    if (!accountAddress) return;
    setForm((f) => ({
      ...f,
      address_line1: accountAddress.address_line1 ?? "",
      address_line2: accountAddress.address_line2 ?? "",
      city:          accountAddress.city          ?? "",
      state:         accountAddress.state         ?? "",
      postal_code:   accountAddress.postal_code   ?? "",
      country:       accountAddress.country       ?? "",
    }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/contacts/${contact.id}`, {
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
        {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.muted} /> Edit contact</>}
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit contact
      </div>

      {/* Identity */}
      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Role</label>
          <input style={inp} value={form.role} onChange={set("role")} placeholder="e.g. Maintenance Head" />
        </div>
        <div>
          <label style={lbl}>Department</label>
          <input style={inp} value={form.department} onChange={set("department")} placeholder="e.g. Engineering" />
        </div>
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Birthday</label>
          <input style={inp} type="date" value={form.birthday} onChange={set("birthday")} />
        </div>
        <div>
          <label style={lbl}>LinkedIn</label>
          <input style={inp} value={form.linkedin_url} onChange={set("linkedin_url")} placeholder="linkedin.com/in/..." />
        </div>
      </div>

      {/* Phones */}
      <div style={secHead}>Phones</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Primary</label>
          <input style={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98450 12345" />
        </div>
        <div>
          <label style={lbl}>Secondary</label>
          <input style={inp} value={form.phone2} onChange={set("phone2")} placeholder="+91 98450 12346" />
        </div>
      </div>
      <div style={fw}>
        <label style={lbl}>Third</label>
        <input style={inp} value={form.phone3} onChange={set("phone3")} placeholder="+91 98450 12347" />
      </div>

      {/* Emails */}
      <div style={secHead}>Email &amp; web</div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Primary email</label>
          <input style={inp} type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" />
        </div>
        <div>
          <label style={lbl}>Secondary email</label>
          <input style={inp} type="email" value={form.email2} onChange={set("email2")} placeholder="personal@gmail.com" />
        </div>
      </div>
      <div style={fw}>
        <label style={lbl}>Website</label>
        <input style={inp} value={form.website} onChange={set("website")} placeholder="https://company.com" />
      </div>

      {/* Address */}
      <div style={{ ...secHead, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Address</span>
        {accountAddress && (
          <button
            type="button"
            onClick={copyFromAccount}
            style={{
              fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5,
              border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent,
              cursor: "pointer", textTransform: "none", letterSpacing: 0,
            }}
          >
            ↙ Copy from account
          </button>
        )}
      </div>
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
          <input style={inp} value={form.city} onChange={set("city")} />
        </div>
        <div>
          <label style={lbl}>State</label>
          <input style={inp} value={form.state} onChange={set("state")} />
        </div>
      </div>
      <div style={grid2}>
        <div>
          <label style={lbl}>Postal code</label>
          <input style={inp} value={form.postal_code} onChange={set("postal_code")} />
        </div>
        <div>
          <label style={lbl}>Country</label>
          <input style={inp} value={form.country} onChange={set("country")} />
        </div>
      </div>

      {/* Notes */}
      <div style={secHead}>Sales</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={lbl}>Territory</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.territory} onChange={(e) => setForm((f) => ({ ...f, territory: e.target.value }))}>
            <option value="">— None —</option>
            {salesCfg.territories.map((t) => <option key={t} value={t}>{t}</option>)}
            {form.territory && !salesCfg.territories.includes(form.territory) && (
              <option value={form.territory}>{form.territory}</option>
            )}
          </select>
        </div>
        <div>
          <label style={lbl}>Sales org</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.sales_org} onChange={(e) => setForm((f) => ({ ...f, sales_org: e.target.value }))}>
            <option value="">— None —</option>
            {salesCfg.sales_orgs.map((s) => <option key={s} value={s}>{s}</option>)}
            {form.sales_org && !salesCfg.sales_orgs.includes(form.sales_org) && (
              <option value={form.sales_org}>{form.sales_org}</option>
            )}
          </select>
        </div>
      </div>

      <div style={secHead}>Notes</div>
      <div style={fw}>
        <textarea
          style={{ ...inp, minHeight: 70, resize: "vertical" }}
          value={form.notes}
          onChange={set("notes")}
          placeholder="Any notes about this contact…"
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
