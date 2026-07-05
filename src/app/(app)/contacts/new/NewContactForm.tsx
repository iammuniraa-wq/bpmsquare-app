"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import Link from "next/link";
import type { Account } from "@/lib/types";
import MobileSection from "@/components/MobileSection";

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fieldWrap: React.CSSProperties = { marginBottom: 14 };
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 12px",
};

export default function NewContactForm({ accounts, defaultAccountId }: { accounts: Account[]; defaultAccountId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    account_id: defaultAccountId || accounts[0]?.id || "",
    name: "", role: "",
    phone: "", phone2: "", phone3: "",
    email: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
      <div style={fieldWrap}>
        <label style={label}>Full name *</label>
        <input style={input} value={form.name} onChange={set("name")} required placeholder="e.g. Rajesh Kumar" />
      </div>
      <div style={fieldWrap}>
        <label style={label}>Account *</label>
        <select style={input} value={form.account_id} onChange={set("account_id")} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div style={{ ...fieldWrap, marginBottom: 0 }}>
        <label style={label}>Role / designation</label>
        <input style={input} value={form.role} onChange={set("role")} placeholder="e.g. Purchase Manager" />
      </div>
    </>
  );

  const phoneFields = (
    <>
      <div style={fieldWrap}>
        <label style={label}>Primary phone</label>
        <input style={input} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
      </div>
      <div style={fieldWrap}>
        <label style={label}>Phone 2</label>
        <input style={input} value={form.phone2} onChange={set("phone2")} placeholder="+91 97654 32109" />
      </div>
      <div style={{ ...fieldWrap, marginBottom: 0 }}>
        <label style={label}>Phone 3</label>
        <input style={input} value={form.phone3} onChange={set("phone3")} placeholder="+91 96543 21098" />
      </div>
    </>
  );

  const emailFields = (
    <>
      <div style={fieldWrap}>
        <label style={label}>Primary email</label>
        <input style={input} type="email" value={form.email} onChange={set("email")} placeholder="rajesh@company.com" />
      </div>
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

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Contact</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a person linked to an account</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Desktop ── */}
        <div className="mob-hide" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
          {/* Left col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <p style={sectionTitle}>Identity</p>
              {identityFields}
            </div>
            <div style={cardStyle}>
              <p style={sectionTitle}>Phone numbers</p>
              {phoneFields}
            </div>
          </div>
          {/* Right col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <p style={sectionTitle}>Email addresses</p>
              {emailFields}
            </div>
            {errorBox}
            {submitRow}
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="mob-show" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MobileSection title="Identity" defaultOpen>
            {identityFields}
          </MobileSection>
          <MobileSection title="Phone numbers">
            {phoneFields}
          </MobileSection>
          <MobileSection title="Email addresses">
            {emailFields}
          </MobileSection>
          {errorBox}
          {submitRow}
        </div>
      </form>
    </>
  );
}
