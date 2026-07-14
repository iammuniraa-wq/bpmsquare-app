"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import MobileSection from "@/components/MobileSection";
import { ROUTES } from "@/lib/constants";
import Link from "next/link";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { useSalesConfig } from "@/lib/useSalesConfig";

interface CFDef {
  id: string; field_key: string; field_label: string;
  field_type: "text"|"number"|"date"|"select"|"checkbox"|"textarea";
  field_section: string | null;
  options: string[] | null; is_required: boolean;
}

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
const fw: React.CSSProperties = { marginBottom: 14 };
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const sectionHead: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 14px" };

export default function NewAccountPage() {
  const router = useRouter();
  const salesCfg = useSalesConfig();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [cfDefs, setCfDefs] = useState<CFDef[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});

  function fetchCFDefs() {
    fetch("/api/settings/custom-fields?object=account")
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
    // Identity
    name: "", type: "prospect",
    // Address
    address_line1: "", address_line2: "",
    city: "", state: "", postal_code: "", country: "",
    // Communication
    phone: "", phone2: "", email: "", email2: "", website: "",
    // Business
    industry: "", employee_count: "", annual_revenue: "", gstin: "",
    territory: "", sales_org: "",
    // Notes + referral
    notes: "", referred_by_account_id: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Renders custom field inputs for a given section name.
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
    startTransition(async () => {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, custom_data: Object.keys(cfValues).length > 0 ? cfValues : undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.account(json.id));
      } else {
        setError(json.error ?? "Failed to create account");
      }
    });
  }

  const identitySection = (
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
      {cfInputs("Identity")}
    </>
  );

  const addressSection = (
    <>
      <div style={fw}>
        <label style={label}>Address line 1</label>
        <input style={input} value={form.address_line1} onChange={set("address_line1")} placeholder="Street / building / plot" />
      </div>
      <div style={fw}>
        <label style={label}>Address line 2</label>
        <input style={input} value={form.address_line2} onChange={set("address_line2")} placeholder="Area / landmark" />
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>City</label>
          <input style={input} value={form.city} onChange={set("city")} placeholder="e.g. Bengaluru" />
        </div>
        <div>
          <label style={label}>State</label>
          <input style={input} value={form.state} onChange={set("state")} placeholder="e.g. Karnataka" />
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

  const communicationSection = (
    <>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Primary phone</label>
          <input style={input} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
        </div>
        <div>
          <label style={label}>Secondary phone</label>
          <input style={input} value={form.phone2} onChange={set("phone2")} placeholder="+91 98765 43211" />
        </div>
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Primary email</label>
          <input style={input} type="email" value={form.email} onChange={set("email")} placeholder="accounts@company.com" />
        </div>
        <div>
          <label style={label}>Secondary email</label>
          <input style={input} type="email" value={form.email2} onChange={set("email2")} placeholder="info@company.com" />
        </div>
      </div>
      <div style={fw}>
        <label style={label}>Website</label>
        <input style={input} value={form.website} onChange={set("website")} placeholder="https://company.com" />
      </div>
      {cfInputs("Communication")}
    </>
  );

  const businessSection = (
    <>
      <div style={fw}>
        <label style={label}>Industry</label>
        <input style={input} value={form.industry} onChange={set("industry")} placeholder="e.g. Textile Manufacturing" />
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Employees</label>
          <input style={input} value={form.employee_count} onChange={set("employee_count")} placeholder="e.g. 250" />
        </div>
        <div>
          <label style={label}>Annual revenue</label>
          <input style={input} value={form.annual_revenue} onChange={set("annual_revenue")} placeholder="e.g. ₹5 Cr" />
        </div>
      </div>
      <div style={fw}>
        <label style={label}>GSTIN</label>
        <input style={input} value={form.gstin} onChange={set("gstin")} placeholder="27AABCV1234F1Z5" />
      </div>
      <div style={{ ...grid2, ...fw }}>
        <div>
          <label style={label}>Territory</label>
          <select style={input} value={form.territory} onChange={set("territory")}>
            <option value="">— none —</option>
            {salesCfg.territories.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Sales org</label>
          <select style={input} value={form.sales_org} onChange={set("sales_org")}>
            <option value="">— none —</option>
            {salesCfg.sales_orgs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {cfInputs("Business")}
    </>
  );

  const notesSection = (
    <>
      <div style={fw}>
        <label style={label}>Notes</label>
        <textarea
          style={{ ...input, minHeight: 80, resize: "vertical" }}
          value={form.notes}
          onChange={set("notes")}
          placeholder="Any notes about this account…"
        />
      </div>
      <div style={fw}>
        <label style={label}>Referred by account ID</label>
        <input style={input} value={form.referred_by_account_id} onChange={set("referred_by_account_id")} placeholder="UUID of OEM account" />
        <p style={{ fontSize: 11, color: c.hint, margin: "5px 0 0" }}>Set when type is End Customer and an OEM referred them</p>
      </div>
      {cfInputs("Notes")}
    </>
  );

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All accounts
        </Link>
      </div>

      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Account</h1>
          <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a customer, prospect, OEM or end customer</p>
        </div>
        <AdaptObjectDrawer objectType="account" objectLabel="Account" isAdmin={true} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Desktop ── */}
        <div className="mob-hide" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <h3 style={sectionHead}>Identity</h3>
              {identitySection}
            </div>
            <div style={cardStyle}>
              <h3 style={sectionHead}>Address</h3>
              {addressSection}
            </div>
            <div style={cardStyle}>
              <h3 style={sectionHead}>Communication</h3>
              {communicationSection}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={cardStyle}>
              <h3 style={sectionHead}>Business</h3>
              {businessSection}
            </div>
            <div style={cardStyle}>
              <h3 style={sectionHead}>Notes &amp; Referral</h3>
              {notesSection}
            </div>
            {error && <ErrorBox msg={error} />}
            <Actions pending={pending} cancelHref={ROUTES.accounts} label="Create Account" />
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="mob-show" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MobileSection title="Identity" defaultOpen>{identitySection}</MobileSection>
          <MobileSection title="Address">{addressSection}</MobileSection>
          <MobileSection title="Communication">{communicationSection}</MobileSection>
          <MobileSection title="Business">{businessSection}</MobileSection>
          <MobileSection title="Notes & Referral">{notesSection}</MobileSection>
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
