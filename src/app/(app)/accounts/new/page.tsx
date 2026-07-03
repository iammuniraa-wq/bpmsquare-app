"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import MobileSection from "@/components/MobileSection";
import { ROUTES } from "@/lib/constants";
import Link from "next/link";

const ACCOUNT_TYPES = [
  { value: "prospect",     label: "Prospect" },
  { value: "direct",       label: "Direct Customer" },
  { value: "oem",          label: "OEM / Dealer" },
  { value: "end_customer", label: "End Customer" },
];

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };

export default function NewAccountPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", type: "prospect", city: "", phone: "", email: "",
    referred_by_account_id: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.account(json.id));
      } else {
        setError(json.error ?? "Failed to create account");
      }
    });
  }

  const companyFields = (
    <>
      <div style={fw}>
        <label style={label}>Company name *</label>
        <input style={input} value={form.name} onChange={set("name")} required placeholder="e.g. Tata Steel Ltd" />
      </div>
      <div style={fw}>
        <label style={label}>Account type *</label>
        <select style={input} value={form.type} onChange={set("type")}>
          {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div style={{ ...fw, marginBottom: 0 }}>
        <label style={label}>City</label>
        <input style={input} value={form.city} onChange={set("city")} placeholder="e.g. Bengaluru" />
      </div>
    </>
  );

  const contactFields = (
    <>
      <div style={fw}>
        <label style={label}>Phone</label>
        <input style={input} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
      </div>
      <div style={{ ...fw, marginBottom: 0 }}>
        <label style={label}>Email</label>
        <input style={input} type="email" value={form.email} onChange={set("email")} placeholder="accounts@company.com" />
      </div>
    </>
  );

  const referralField = (
    <>
      <div style={{ ...fw, marginBottom: 8 }}>
        <label style={label}>Referred by account ID</label>
        <input style={input} value={form.referred_by_account_id} onChange={set("referred_by_account_id")} placeholder="UUID of OEM account" />
      </div>
      <p style={{ fontSize: 11, color: c.hint, margin: 0 }}>Set when type is End Customer and an OEM referred them</p>
    </>
  );

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All accounts
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Account</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a customer, prospect, OEM or end customer</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Desktop layout ── */}
        <div className="mob-hide" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Company details</h3>
            {companyFields}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Contact info</h3>
              {contactFields}
            </div>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 12px" }}>Referral (optional)</h3>
              {referralField}
            </div>
            {error && <ErrorBox msg={error} />}
            <Actions pending={pending} cancelHref={ROUTES.accounts} label="Create Account" />
          </div>
        </div>

        {/* ── Mobile layout ── */}
        <div className="mob-show" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MobileSection title="Company details" defaultOpen>
            {companyFields}
          </MobileSection>
          <MobileSection title="Contact info">
            {contactFields}
          </MobileSection>
          <MobileSection title="Referral (optional)">
            {referralField}
          </MobileSection>
          {error && <ErrorBox msg={error} />}
          <Actions pending={pending} cancelHref={ROUTES.accounts} label="Create Account" />
        </div>
      </form>
    </>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
      {msg}
    </div>
  );
}

function Actions({ pending, cancelHref, label }: { pending: boolean; cancelHref: string; label: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="submit"
        disabled={pending}
        style={{
          flex: 1, padding: "12px 0", borderRadius: 8, border: "none",
          background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Creating…" : label}
      </button>
      <Link
        href={cancelHref}
        style={{
          padding: "12px 18px", borderRadius: 8, border: `1px solid ${c.line}`,
          color: c.muted, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center",
        }}
      >
        Cancel
      </Link>
    </div>
  );
}
