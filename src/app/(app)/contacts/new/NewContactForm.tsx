"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import Link from "next/link";
import type { Account } from "@/lib/types";
import MobileSection from "@/components/MobileSection";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

interface CFDef {
  id: string; field_key: string; field_label: string;
  field_type: "text"|"number"|"date"|"select"|"checkbox"|"textarea";
  field_section: string | null;
  options: string[] | null; is_required: boolean;
}

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 14 };
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 12px",
};

export default function NewContactForm({ accounts, defaultAccountId, isAdmin }: { accounts: Account[]; defaultAccountId?: string; isAdmin?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [cfDefs, setCfDefs] = useState<CFDef[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});

  function fetchCFDefs() {
    fetch("/api/settings/custom-fields?object=contact")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCfDefs(data); })
      .catch(() => {});
  }

  useEffect(() => {
    fetchCFDefs();
    const handler = () => fetchCFDefs();
    window.addEventListener("bpm:cf-changed", handler);
    return () => window.removeEventListener("bpm:cf-changed", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState({
    account_id: defaultAccountId || accounts[0]?.id || "",
    name: "", role: "", department: "",
    phone: "", phone2: "", phone3: "",
    email: "", email2: "",
    website: "", linkedin_url: "", birthday: "",
    address_line1: "", address_line2: "",
    city: "", state: "", postal_code: "", country: "",
    notes: "",
    _copyFromAccount: false,
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function copyAddressFromAccount() {
    const acct = accounts.find((a) => a.id === form.account_id);
    if (!acct) return;
    setForm((f) => ({
      ...f,
      address_line1: acct.address_line1 ?? "",
      address_line2: acct.address_line2 ?? "",
      city:          acct.city          ?? "",
      state:         acct.state         ?? "",
      postal_code:   acct.postal_code   ?? "",
      country:       acct.country       ?? "",
    }));
  }

  function cfInputs(section: string) {
    const sfs = cfDefs.filter((f) => f.field_section === section);
    if (sfs.length === 0) return null;
    return (
      <>
        {sfs.map((f) => (
          <div key={f.id} style={fw}>
            <label style={label}>{f.field_label}{f.is_required ? " *" : ""}</label>
            {f.field_type === "select" && f.options ? (
              <select style={input} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))}>
                <option value="">— select —</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.field_type === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: c.ink, marginTop: 4 }}>
                <input type="checkbox" checked={!!(cfValues[f.field_key])} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.checked }))} style={{ width: 15, height: 15 }} />
                {cfValues[f.field_key] ? "Yes" : "No"}
              </label>
            ) : f.field_type === "textarea" ? (
              <textarea style={{ ...input, minHeight: 60, resize: "vertical" }} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))} />
            ) : (
              <input style={input} type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))} />
            )}
          </div>
        ))}
      </>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _copyFromAccount, ...payload } = form;
    startTransition(async () => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, custom_data: Object.keys(cfValues).length > 0 ? cfValues : undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.contacts);
      } else {
        setError(json.error ?? "Failed to create contact");
      }
    });
  }

  const identityFields = (
    <>
      <div style={fw}>
        <label style={label}>Full name *</label>
        <input style={input} value={form.name} onChange={set("name")} required placeholder="e.g. Rajesh Kumar" />
      </div>
      <div style={fw}>
        <label style={label}>Account *</label>
        <select style={input} value={form.account_id} onChange={set("account_id")} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Role / designation</label>
          <input style={input} value={form.role} onChange={set("role")} placeholder="e.g. Purchase Manager" />
        </div>
        <div>
          <label style={label}>Department</label>
          <input style={input} value={form.department} onChange={set("department")} placeholder="e.g. Maintenance" />
        </div>
      </div>
      <div style={fw}>
        <label style={label}>Birthday</label>
        <input style={input} type="date" value={form.birthday} onChange={set("birthday")} />
      </div>
      <div style={fw}>
        <label style={label}>LinkedIn URL</label>
        <input style={input} value={form.linkedin_url} onChange={set("linkedin_url")} placeholder="https://linkedin.com/in/..." />
      </div>
      {cfInputs("Identity")}
    </>
  );

  const phoneFields = (
    <>
      <div style={fw}>
        <label style={label}>Primary phone</label>
        <input style={input} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
      </div>
      <div style={fw}>
        <label style={label}>Secondary phone</label>
        <input style={input} value={form.phone2} onChange={set("phone2")} placeholder="+91 98765 43211" />
      </div>
      <div style={fw}>
        <label style={label}>Third phone</label>
        <input style={input} value={form.phone3} onChange={set("phone3")} placeholder="+91 98765 43212" />
      </div>
      {cfInputs("Phone numbers")}
    </>
  );

  const emailFields = (
    <>
      <div style={fw}>
        <label style={label}>Primary email</label>
        <input style={input} type="email" value={form.email} onChange={set("email")} placeholder="rajesh@company.com" />
      </div>
      <div style={fw}>
        <label style={label}>Secondary email</label>
        <input style={input} type="email" value={form.email2} onChange={set("email2")} placeholder="rajesh.personal@gmail.com" />
      </div>
      <div style={fw}>
        <label style={label}>Website</label>
        <input style={input} value={form.website} onChange={set("website")} placeholder="https://linkedin.com/in/..." />
      </div>
      {cfInputs("Email & web")}
    </>
  );

  const addressFields = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: c.hint }}>Contact&apos;s personal or delivery address</span>
        <button
          type="button"
          onClick={copyAddressFromAccount}
          style={{
            fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
            border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent,
            cursor: "pointer",
          }}
        >
          ↙ Copy from account
        </button>
      </div>
      <div style={fw}>
        <label style={label}>Address line 1</label>
        <input style={input} value={form.address_line1} onChange={set("address_line1")} placeholder="Street / building / flat" />
      </div>
      <div style={fw}>
        <label style={label}>Address line 2</label>
        <input style={input} value={form.address_line2} onChange={set("address_line2")} placeholder="Area / landmark" />
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>City</label>
          <input style={input} value={form.city} onChange={set("city")} placeholder="Bengaluru" />
        </div>
        <div>
          <label style={label}>State</label>
          <input style={input} value={form.state} onChange={set("state")} placeholder="Karnataka" />
        </div>
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Postal code</label>
          <input style={input} value={form.postal_code} onChange={set("postal_code")} placeholder="560001" />
        </div>
        <div>
          <label style={label}>Country</label>
          <input style={input} value={form.country} onChange={set("country")} placeholder="India" />
        </div>
      </div>
      {cfInputs("Address")}
    </>
  );

  const notesField = (
    <>
      <div style={fw}>
        <label style={label}>Notes</label>
        <textarea
          style={{ ...input, minHeight: 80, resize: "vertical" }}
          value={form.notes}
          onChange={set("notes")}
          placeholder="Any notes about this contact…"
        />
      </div>
      {cfInputs("Notes")}
    </>
  );

  const submitRow = (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="submit"
        disabled={pending}
        style={{
          flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
          background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Saving…" : "Create Contact"}
      </button>
      <Link
        href={ROUTES.contacts}
        style={{
          padding: "10px 18px", borderRadius: 8, border: `1px solid ${c.line}`,
          color: c.muted, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center",
        }}
      >
        Cancel
      </Link>
    </div>
  );

  const errorBox = error ? (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
      {error}
    </div>
  ) : null;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.contacts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All contacts
        </Link>
      </div>

      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Contact</h1>
          <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a person linked to an account</p>
        </div>
        <AdaptObjectDrawer objectType="contact" objectLabel="Contact" isAdmin={isAdmin ?? true} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Desktop ── */}
        <div className="mob-hide" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <p style={sectionTitle}>Identity</p>
              {identityFields}
            </div>
            <div style={cardStyle}>
              <p style={sectionTitle}>Address</p>
              {addressFields}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <p style={sectionTitle}>Phone numbers</p>
              {phoneFields}
            </div>
            <div style={cardStyle}>
              <p style={sectionTitle}>Email &amp; web</p>
              {emailFields}
            </div>
            <div style={cardStyle}>
              <p style={sectionTitle}>Notes</p>
              {notesField}
            </div>
            {errorBox}
            {submitRow}
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="mob-show" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MobileSection title="Identity" defaultOpen>{identityFields}</MobileSection>
          <MobileSection title="Phone numbers">{phoneFields}</MobileSection>
          <MobileSection title="Email & web">{emailFields}</MobileSection>
          <MobileSection title="Address">{addressFields}</MobileSection>
          <MobileSection title="Notes">{notesField}</MobileSection>
          {errorBox}
          {submitRow}
        </div>
      </form>
    </>
  );
}
