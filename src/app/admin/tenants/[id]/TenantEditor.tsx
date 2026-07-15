"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Tenant, TenantFeatures } from "@/lib/tenant";
import { c } from "@/lib/theme";

type Props = {
  tenant: Tenant;
  users: { id: string; role: string; created_at: string; user_id: string; email: string | null; confirmed: boolean }[];
};

const FEATURE_LABELS: { key: keyof TenantFeatures; label: string; premium?: boolean }[] = [
  { key: "leads",        label: "Leads" },
  { key: "pipeline",     label: "Pipeline" },
  { key: "amc",          label: "AMC Contracts" },
  { key: "dispatch",     label: "Dispatch" },
  { key: "invoices",     label: "Invoices" },
  { key: "partners",     label: "Partners" },
  { key: "ai_assistant", label: "AI Assistant", premium: true },
  { key: "db_export",    label: "DB Export",    premium: true },
];

const inputStyle: React.CSSProperties = {
  height: 38, border: "1px solid #d1d5db", borderRadius: 8,
  padding: "0 10px", fontSize: 13, width: "100%", boxSizing: "border-box",
  color: "#111827",
};

export default function TenantEditor({ tenant, users }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName]               = useState(tenant.name);
  const [slug, setSlug]               = useState(tenant.slug);
  const [customDomain, setCustomDomain] = useState(tenant.custom_domain ?? "");
  const [accentColor, setAccentColor] = useState(tenant.accent_color);
  const [logoUrl, setLogoUrl]         = useState(tenant.logo_url ?? "");
  const [status, setStatus]           = useState(tenant.status);
  const [plan, setPlan]               = useState(tenant.plan);
  const [features, setFeatures]       = useState<TenantFeatures>({ ...tenant.features });
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<Record<string, string>>({});

  function toggleFeature(key: keyof TenantFeatures) {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  async function resendInvite(userId: string, email: string) {
    setResendingId(userId);
    setResendResult((prev) => ({ ...prev, [userId]: "" }));
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}/resend-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      setResendResult((prev) => ({ ...prev, [userId]: res.ok ? "Invite resent ✓" : (json.error ?? "Failed to resend") }));
    } catch {
      setResendResult((prev) => ({ ...prev, [userId]: "Failed to resend" }));
    } finally {
      setResendingId(null);
    }
  }

  async function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug, accent_color: accentColor, logo_url: logoUrl || null, status, plan, features,
          custom_domain: customDomain || null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Save failed");
      }
    });
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.push("/admin")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13 }}
        >
          ← Tenants
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>{tenant.name}</h1>
      </div>

      {/* Identity */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Identity</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Name</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Slug (URL key)</label>
            <input style={inputStyle} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
            Custom domain <span style={{ color: "#9ca3af" }}>(optional — dedicated URL for this tenant)</span>
          </label>
          <input
            style={inputStyle}
            value={customDomain}
            placeholder="vikas.bpmsquare.com"
            onChange={(e) => { setCustomDomain(e.target.value.trim().toLowerCase()); setSaved(false); }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Logo URL</label>
            <input style={inputStyle} value={logoUrl} placeholder="https://…" onChange={(e) => setLogoUrl(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Accent colour</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
                style={{ width: 38, height: 38, border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", padding: 2 }} />
              <input style={{ ...inputStyle, flex: 1 }} value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      {/* Status & plan */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Status & Plan</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Status</label>
            <select style={{ ...inputStyle }} value={status} onChange={(e) => setStatus(e.target.value as Tenant["status"])}>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Plan</label>
            <select style={{ ...inputStyle }} value={plan} onChange={(e) => setPlan(e.target.value as Tenant["plan"])}>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
      </section>

      {/* Feature flags */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
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

      {/* Users */}
      {users.length > 0 && (
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#374151" }}>
            Users ({users.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {users.map((u) => (
              <div key={u.id} style={{
                display: "flex", flexDirection: "column", gap: 4,
                padding: "8px 12px", background: "#f9fafb", borderRadius: 8,
                fontSize: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.email ?? `${u.user_id.slice(0, 16)}…`}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{
                      background: u.confirmed ? "#f0fdf4" : "#fffbeb",
                      color: u.confirmed ? "#166534" : "#92400e",
                      borderRadius: 10, padding: "2px 8px", fontWeight: 600,
                    }}>
                      {u.confirmed ? "Active" : "Pending"}
                    </span>
                    <span style={{
                      background: u.role === "admin" ? "#dbeafe" : "#f1f5f9",
                      color: u.role === "admin" ? "#1e40af" : "#475569",
                      borderRadius: 10, padding: "2px 8px", fontWeight: 600,
                    }}>
                      {u.role}
                    </span>
                    {!u.confirmed && u.email && (
                      <button
                        type="button"
                        disabled={resendingId === u.user_id}
                        onClick={() => resendInvite(u.user_id, u.email!)}
                        style={{
                          background: "none", border: `1px solid ${c.accent}`, color: c.accent,
                          borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                          cursor: resendingId === u.user_id ? "not-allowed" : "pointer",
                        }}
                      >
                        {resendingId === u.user_id ? "Sending…" : "Resend invite"}
                      </button>
                    )}
                  </div>
                </div>
                {resendResult[u.user_id] && (
                  <span style={{ fontSize: 11, color: resendResult[u.user_id].includes("✓") ? "#16a34a" : "#dc2626" }}>
                    {resendResult[u.user_id]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Export */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Data export</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#6b7280" }}>
          Download all tenant data across every table. Use for support, migration, or backup.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={`/api/admin/tenants/${tenant.id}/export?format=json`}
            download
            style={{
              height: 36, padding: "0 16px", display: "inline-flex", alignItems: "center",
              background: "#f1f5f9", color: "#374151",
              border: "1px solid #e2e8f0", borderRadius: 8,
              textDecoration: "none", fontSize: 12, fontWeight: 500, gap: 6,
            }}
          >
            ⬇ JSON
          </a>
          <a
            href={`/api/admin/tenants/${tenant.id}/export?format=csv`}
            download
            style={{
              height: 36, padding: "0 16px", display: "inline-flex", alignItems: "center",
              background: "#f1f5f9", color: "#374151",
              border: "1px solid #e2e8f0", borderRadius: 8,
              textDecoration: "none", fontSize: 12, fontWeight: 500, gap: 6,
            }}
          >
            ⬇ CSV
          </a>
        </div>
      </section>

      {/* Save */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={save}
          disabled={pending}
          style={{
            height: 40, padding: "0 24px",
            background: pending ? "#93c5fd" : c.accent,
            color: "#fff", border: "none", borderRadius: 9,
            fontSize: 13, fontWeight: 500, cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "#16a34a" }}>✓ Saved</span>}
        {error && <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>}
      </div>
    </div>
  );
}
