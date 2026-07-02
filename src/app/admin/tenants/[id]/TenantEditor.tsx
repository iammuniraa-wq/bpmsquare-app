"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Tenant, TenantFeatures, CompanyInfo } from "@/lib/tenant";
import { c } from "@/lib/theme";

type Props = {
  tenant: Tenant;
  users: { id: string; role: string; created_at: string; user_id: string }[];
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
  const [accentColor, setAccentColor] = useState(tenant.accent_color);
  const [logoUrl, setLogoUrl]         = useState(tenant.logo_url ?? "");
  const [status, setStatus]           = useState(tenant.status);
  const [plan, setPlan]               = useState(tenant.plan);
  const [features, setFeatures]       = useState<TenantFeatures>({ ...tenant.features });
  const [info, setInfo]               = useState<CompanyInfo>({ ...(tenant.company_info ?? {}) });
  const [partners, setPartners]       = useState<{ name: string; logo_url: string }[]>(
    (tenant.company_info?.partners ?? []).map((p) => ({ name: p.name, logo_url: p.logo_url ?? "" }))
  );
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState("");
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  async function uploadPartnerLogo(i: number, file: File) {
    setUploadingIdx(i);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload-logo", { method: "POST", body: fd });
    setUploadingIdx(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Upload failed");
      return;
    }
    const { url } = await res.json();
    setPartnerField(i, "logo_url", url);
  }

  function setInfoField(key: keyof Omit<CompanyInfo, "partners">, val: string) {
    setInfo((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function setPartnerField(i: number, key: "name" | "logo_url", val: string) {
    setPartners((prev) => prev.map((p, idx) => idx === i ? { ...p, [key]: val } : p));
    setSaved(false);
  }

  function addPartner() {
    setPartners((prev) => [...prev, { name: "", logo_url: "" }]);
    setSaved(false);
  }

  function removePartner(i: number) {
    setPartners((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  function toggleFeature(key: keyof TenantFeatures) {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  async function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, accent_color: accentColor, logo_url: logoUrl || null, status, plan, features, company_info: { ...info, partners: partners.filter((p) => p.name.trim()) } }),
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

      {/* Company Info */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Company Info</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#6b7280" }}>
          Shown in the quotation PDF header. Leave blank to use the system default.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {([
            { key: "tagline",          label: "Tagline",                     placeholder: "Professional in Motor Rewindings" },
            { key: "undertaking",      label: "Services (undertaking line)",  placeholder: "Rewinding of LT / HT Large Motors…" },
            { key: "address",          label: "Address",                      placeholder: "Plot No: N3-N4/1, Industrial Estate…" },
            { key: "phone_dir_tech",   label: "Phone — Dir / Tech",           placeholder: "9342681227 / 9538884600" },
            { key: "phone_commercial", label: "Phone — Commercial",           placeholder: "9538884603" },
            { key: "phone_work",       label: "Phone — Work",                 placeholder: "9538884602" },
            { key: "landline",         label: "Landline",                     placeholder: "08394-231687" },
            { key: "email",            label: "Email (primary)",              placeholder: "vikaspioneers@gmail.com" },
            { key: "email2",           label: "Email (secondary)",            placeholder: "vew@vikaspioneers.com" },
            { key: "web",              label: "Website",                      placeholder: "www.vikaspioneers.com" },
            { key: "gstin",            label: "GSTIN",                        placeholder: "29AHHPG0831F1ZN" },
            { key: "iso",              label: "Certification",                placeholder: "ISO 9001:2015" },
            { key: "footer_tagline",   label: "Footer tagline",               placeholder: "Assuring our best services as always!" },
          ] as { key: keyof Omit<CompanyInfo, "partners">; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 3 }}>{label}</label>
              <input
                style={inputStyle}
                value={(info[key] as string) ?? ""}
                placeholder={placeholder}
                onChange={(e) => setInfoField(key, e.target.value)}
              />
            </div>
          ))}

          {/* Channel Partners — dynamic logo list */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 12, color: "#6b7280" }}>Channel partners (with logos)</label>
              <button
                type="button"
                onClick={addPartner}
                style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}
              >
                + Add partner
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {partners.map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 6, alignItems: "center" }}>
                  <input
                    style={inputStyle}
                    value={p.name}
                    placeholder="Partner name (e.g. ABB)"
                    onChange={(e) => setPartnerField(i, "name", e.target.value)}
                  />
                  <div style={{ position: "relative" }}>
                    {p.logo_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 38, border: "1px solid #d1d5db", borderRadius: 8, padding: "0 10px", background: "#f9fafb" }}>
                        <img src={p.logo_url} alt={p.name} style={{ height: 22, maxWidth: 60, objectFit: "contain" }} />
                        <span style={{ fontSize: 11, color: "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.logo_url.split("/").pop()}
                        </span>
                        <label style={{ fontSize: 11, color: "#3b82f6", cursor: "pointer", flexShrink: 0, fontWeight: 500 }}>
                          Change
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: "none" }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPartnerLogo(i, f); e.target.value = ""; }} />
                        </label>
                      </div>
                    ) : (
                      <label style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        height: 38, border: "2px dashed #d1d5db", borderRadius: 8,
                        cursor: uploadingIdx === i ? "wait" : "pointer",
                        fontSize: 12, color: uploadingIdx === i ? "#9ca3af" : "#6b7280",
                        background: "#fafafa",
                      }}>
                        {uploadingIdx === i ? "Uploading…" : "⬆ Upload logo (PNG / JPG / SVG)"}
                        <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: "none" }}
                          disabled={uploadingIdx === i}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPartnerLogo(i, f); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePartner(i)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 16, lineHeight: 1, alignSelf: "center" }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              {partners.length === 0 && (
                <div style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>No partners added yet. Click "+ Add partner" above.</div>
              )}
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
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", background: "#f9fafb", borderRadius: 8,
                fontSize: 12,
              }}>
                <span style={{ color: "#6b7280", fontFamily: "monospace" }}>{u.user_id.slice(0, 16)}…</span>
                <span style={{
                  background: u.role === "admin" ? "#dbeafe" : "#f1f5f9",
                  color: u.role === "admin" ? "#1e40af" : "#475569",
                  borderRadius: 10, padding: "2px 8px", fontWeight: 600,
                }}>
                  {u.role}
                </span>
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
