"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { TenantFeatures } from "@/lib/tenant";

const FEATURE_LABELS: { key: keyof TenantFeatures; label: string; premium?: boolean }[] = [
  { key: "leads",        label: "Leads" },
  { key: "pipeline",     label: "Pipeline" },
  { key: "amc",          label: "AMC Contracts" },
  { key: "dispatch",     label: "Dispatch" },
  { key: "invoices",     label: "Invoices" },
  { key: "partners",     label: "Partners" },
  { key: "purchasing",   label: "Inventory & Purchasing" },
  { key: "ai_assistant", label: "AI Assistant", premium: true },
  { key: "db_export",    label: "DB Export",    premium: true },
];

const DEFAULT_FEATURES: TenantFeatures = {
  leads: false, pipeline: false, amc: false, dispatch: false,
  invoices: false, partners: false, ai_assistant: false, db_export: false,
  purchasing: false,
};

const inputStyle: React.CSSProperties = {
  height: 38, border: "1px solid #d1d5db", borderRadius: 8,
  padding: "0 10px", fontSize: 13, width: "100%", boxSizing: "border-box",
  color: "#111827",
};

export default function NewTenantForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName]               = useState("");
  const [slug, setSlug]               = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [accentColor, setAccentColor] = useState("#3b82f6");
  const [logoUrl, setLogoUrl]         = useState("");
  const [plan, setPlan]               = useState<"free" | "pro" | "enterprise">("free");
  const [adminEmail, setAdminEmail]   = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [features, setFeatures]       = useState<TenantFeatures>({ ...DEFAULT_FEATURES });
  const [error, setError]             = useState("");

  function toSlug(val: string) {
    return val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  function toggleFeature(key: keyof TenantFeatures) {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!customDomain.trim()) {
      setError("A custom domain is required — it's the address this tenant's users sign in at (e.g. acme.bpmsquare.com).");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug, accent_color: accentColor,
          logo_url: logoUrl || null, plan, features,
          admin_email: adminEmail || null,
          admin_password: adminPassword || null,
          custom_domain: customDomain || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Failed to create tenant"); return; }
      router.push(`/admin/tenants/${json.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13 }}
        >
          ← Tenants
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>New tenant</h1>
      </div>

      {/* Identity */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Identity</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Company name *</label>
            <input
              required
              style={inputStyle}
              value={name}
              placeholder="Vikas Pioneers"
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug(toSlug(e.target.value));
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Slug (URL key) *</label>
            <input
              required
              style={inputStyle}
              value={slug}
              placeholder="vikas"
              onChange={(e) => setSlug(toSlug(e.target.value))}
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
            Custom domain <span style={{ color: "#9ca3af" }}>(required — the address this tenant&apos;s users sign in at)</span>
          </label>
          <input
            style={inputStyle}
            value={customDomain}
            placeholder="acme.bpmsquare.com"
            required
            onChange={(e) => setCustomDomain(e.target.value.trim().toLowerCase())}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Logo URL</label>
            <input
              style={inputStyle}
              value={logoUrl}
              placeholder="https://…"
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Accent colour</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ width: 38, height: 38, border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", padding: 2 }}
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Plan + first admin */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Plan & first admin</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Plan</label>
            <select style={inputStyle} value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
              Admin email <span style={{ color: "#9ca3af" }}>(sends invite, or links an existing account)</span>
            </label>
            <input
              type="email"
              style={inputStyle}
              value={adminEmail}
              placeholder="admin@company.com"
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
            Initial password <span style={{ color: "#9ca3af" }}>(optional — leave blank to email an invite instead)</span>
          </label>
          <input
            type="text"
            style={{ ...inputStyle, maxWidth: 320 }}
            value={adminPassword}
            placeholder="Set a password the admin can log in with immediately"
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </div>
      </section>

      {/* Feature flags */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Feature flags</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FEATURE_LABELS.map(({ key, label, premium }) => (
            <label key={key} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderRadius: 8,
              background: features[key] ? "#eff6ff" : "#f9fafb",
              border: `1px solid ${features[key] ? "#bfdbfe" : "#e5e7eb"}`,
              cursor: "pointer",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                {premium && (
                  <span style={{ fontSize: 10, background: "#faf5ff", color: "#7e22ce", border: "1px solid #e9d5ff", borderRadius: 10, padding: "1px 7px" }}>
                    Premium
                  </span>
                )}
              </div>
              <input
                type="checkbox"
                checked={features[key]}
                onChange={() => toggleFeature(key)}
                style={{ width: 16, height: 16, cursor: "pointer", accentColor: c.accent }}
              />
            </label>
          ))}
        </div>
      </section>

      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            height: 40, padding: "0 28px",
            background: pending ? "#93c5fd" : c.accent,
            color: "#fff", border: "none", borderRadius: 9,
            fontSize: 13, fontWeight: 500, cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Creating…" : "Create tenant"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          style={{
            height: 40, padding: "0 20px",
            background: "#f1f5f9", color: "#475569",
            border: "none", borderRadius: 9, fontSize: 13, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
