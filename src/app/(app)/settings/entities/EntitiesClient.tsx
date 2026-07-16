"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { TenantEntity, TenantConfig, TenantTaxConfig, QuoteIdFormat } from "@/lib/constants";
import { DEFAULT_QUOTE_ID_FORMAT } from "@/lib/constants";
import { formatQuoteRef } from "@/lib/quoteRefFormat";
import type { CompanyInfo } from "@/lib/tenant";

// ── Helpers ───────────────────────────────────────────────────────────────────

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [saved, flash];
}

function blankEntity(): TenantEntity {
  return { id: crypto.randomUUID(), name: "", short_name: "", tagline: "", address: "", phone: "", email: "", gstin: "", is_default: false };
}

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  color: c.ink, outline: "none", background: "#fff",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: c.muted, marginBottom: 4,
  textTransform: "uppercase", letterSpacing: 0.4,
};

function Field({ label, value, onChange, placeholder, mono, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean; type?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inp, fontFamily: mono ? "monospace" : "inherit" }}
      />
    </div>
  );
}

// ── LogoUpload ────────────────────────────────────────────────────────────────

function LogoUpload({ currentUrl, onUploaded, label = "Logo", size = 64 }: {
  currentUrl: string; onUploaded: (url: string) => void;
  label?: string; size?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? "Upload failed"); return; }
      onUploaded(json.url);
    } catch {
      setErr("Upload failed");
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Preview */}
        <div style={{ width: size, height: size, flexShrink: 0, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel2, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {currentUrl
            ? <img src={currentUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 4 }} />
            : <span style={{ fontSize: 11, color: c.hint }}>No logo</span>
          }
        </div>
        <div style={{ flex: 1 }}>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: "none" }} onChange={handleFile} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => ref.current?.click()}
              disabled={uploading}
              style={{ fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 7, border: `1px solid ${c.accent}`, color: c.accent, background: "#fff", cursor: uploading ? "wait" : "pointer" }}
            >
              {uploading ? "Uploading…" : currentUrl ? "Replace" : "Upload image"}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={() => onUploaded("")}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 7, border: `1px solid ${c.line}`, color: "#b91c1c", background: "#fff", cursor: "pointer" }}
              >
                Remove
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: c.hint, marginTop: 5 }}>PNG, JPG, WebP or SVG · max 2 MB</div>
          {err && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{err}</div>}
          {/* Also allow direct URL paste */}
          <input
            style={{ ...inp, fontSize: 12, marginTop: 8 }}
            value={currentUrl}
            onChange={(e) => onUploaded(e.target.value)}
            placeholder="…or paste an image URL"
          />
        </div>
      </div>
    </div>
  );
}

// ── PartnerLogos ──────────────────────────────────────────────────────────────

type Partner = { name: string; logo_url?: string };

function PartnerLogos({ partners, onChange }: {
  partners: Partner[];
  onChange: (p: Partner[]) => void;
}) {
  const addPartner = () => onChange([...partners, { name: "", logo_url: "" }]);
  const removePartner = (i: number) => { const arr = [...partners]; arr.splice(i, 1); onChange(arr); };
  const updatePartner = (i: number, patch: Partial<Partner>) => {
    const arr = [...partners];
    arr[i] = { ...arr[i], ...patch };
    onChange(arr);
  };

  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [errs, setErrs] = useState<Record<number, string>>({});

  async function handlePartnerFile(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrs((p) => ({ ...p, [idx]: "" }));
    setUploading(idx);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) { setErrs((p) => ({ ...p, [idx]: json.error ?? "Upload failed" })); return; }
      updatePartner(idx, { logo_url: json.url });
    } catch {
      setErrs((p) => ({ ...p, [idx]: "Upload failed" }));
    } finally {
      setUploading(null);
      const ref = fileRefs.current[idx];
      if (ref) ref.value = "";
    }
  }

  return (
    <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 14, marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>Authorised channel partner logos</div>
          <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Shown in the top-right of the quote letterhead (e.g. ABB, WEG, Siemens)</div>
        </div>
        <button onClick={addPartner} style={{ fontSize: 12, color: c.accent, background: "none", border: `1px solid ${c.accent}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" }}>
          + Add partner
        </button>
      </div>

      {partners.length === 0 && (
        <div style={{ fontSize: 12.5, color: c.hint, padding: "12px 0" }}>No partner logos added yet.</div>
      )}

      {partners.map((partner, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12, padding: "12px", border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel2 }}>
          {/* Logo preview + upload */}
          <div>
            <div style={{ width: 56, height: 36, border: `1px solid ${c.line}`, borderRadius: 6, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6 }}>
              {partner.logo_url
                ? <img src={partner.logo_url} alt={partner.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: 2 }} />
                : <span style={{ fontSize: 9, color: c.hint }}>No logo</span>
              }
            </div>
            <input
              ref={(el) => { fileRefs.current[i] = el; }}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              style={{ display: "none" }}
              onChange={(e) => handlePartnerFile(i, e)}
            />
            <button
              type="button"
              onClick={() => fileRefs.current[i]?.click()}
              disabled={uploading === i}
              style={{ fontSize: 10.5, fontWeight: 600, padding: "4px 8px", borderRadius: 5, border: `1px solid ${c.accent}`, color: c.accent, background: "#fff", cursor: uploading === i ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {uploading === i ? "…" : partner.logo_url ? "Replace" : "Upload"}
            </button>
            {errs[i] && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3, maxWidth: 70 }}>{errs[i]}</div>}
          </div>

          {/* Fields */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Brand name</label>
              <input style={inp} value={partner.name} onChange={(e) => updatePartner(i, { name: e.target.value })} placeholder="e.g. ABB, WEG, Siemens" />
            </div>
            <div>
              <label style={lbl}>Logo URL (or upload above)</label>
              <input style={{ ...inp, fontSize: 12 }} value={partner.logo_url ?? ""} onChange={(e) => updatePartner(i, { logo_url: e.target.value })} placeholder="https://…/logo.png" />
            </div>
          </div>

          <button onClick={() => removePartner(i)} style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 6, color: "#b91c1c", fontSize: 16, cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── EntityCard ────────────────────────────────────────────────────────────────

function EntityCard({ entity, accent, onChange, onRemove, onSetDefault, isDefault }: {
  entity: TenantEntity; accent: string; isDefault: boolean;
  onChange: (updated: TenantEntity) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const [open, setOpen] = useState(!entity.name);
  const set = (key: keyof TenantEntity) => (val: string) => onChange({ ...entity, [key]: val });

  return (
    <div style={{ border: `1px solid ${isDefault ? accent : c.line}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isDefault ? `${accent}0d` : c.panel2 }}
        onClick={() => setOpen((o) => !o)}
      >
        {isDefault && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 5, background: accent, color: "#fff" }}>DEFAULT</span>
        )}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: c.ink }}>
          {entity.name || <span style={{ color: c.hint, fontStyle: "italic" }}>Untitled entity</span>}
        </span>
        {entity.short_name && (
          <span style={{ fontSize: 11, color: c.muted, background: c.line, borderRadius: 4, padding: "2px 7px" }}>{entity.short_name}</span>
        )}
        <span style={{ fontSize: 13, color: c.hint, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
      </div>

      {open && (
        <div style={{ padding: "14px 16px", borderTop: `1px solid ${c.line}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Legal name" value={entity.name} onChange={set("name")} placeholder="e.g. Acme Electrical Works" />
            <Field label="Short name" value={entity.short_name} onChange={set("short_name")} placeholder="e.g. AEW" />
          </div>
          <Field label="Tagline" value={entity.tagline ?? ""} onChange={set("tagline")} placeholder="e.g. Specialists in Motor Rewindings" />
          <Field label="Address" value={entity.address} onChange={set("address")} placeholder="Street, City, State, PIN" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Phone" value={entity.phone ?? ""} onChange={set("phone")} placeholder="+91 98xxx" />
            <Field label="Email" value={entity.email ?? ""} onChange={set("email")} placeholder="info@company.com" />
          </div>
          <Field label="GSTIN / Tax ID" value={entity.gstin ?? ""} onChange={set("gstin")} placeholder="29AXXXXX0000X0XX" mono />

          <div style={{ display: "flex", gap: 10, marginTop: 6, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
            {!isDefault && (
              <button onClick={onSetDefault} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: `1px solid ${accent}`, color: accent, background: "#fff", cursor: "pointer" }}>
                Set as default
              </button>
            )}
            <button onClick={onRemove} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: `1px solid ${c.line}`, color: "#b91c1c", background: "#fff", cursor: "pointer" }}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PhoneRow ──────────────────────────────────────────────────────────────────

function PhoneRow({ phone, onChange, onRemove }: {
  phone: { label: string; number: string };
  onChange: (p: { label: string; number: string }) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 8, marginBottom: 8, alignItems: "end" }}>
      <div>
        <label style={lbl}>Label</label>
        <input style={inp} value={phone.label} onChange={(e) => onChange({ ...phone, label: e.target.value })} placeholder="e.g. Mobile / Dir & Tech" />
      </div>
      <div>
        <label style={lbl}>Number</label>
        <input style={inp} value={phone.number} onChange={(e) => onChange({ ...phone, number: e.target.value })} placeholder="+91 98000 00000" />
      </div>
      <button onClick={onRemove} style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 7, color: "#b91c1c", fontSize: 16, cursor: "pointer", height: 37, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const DEFAULT_TAX: TenantTaxConfig = { label: "GST", rate: 18, inclusive: false };
const DEFAULT_CO: CompanyInfo = {};

export default function EntitiesClient() {
  const [entities, setEntities] = useState<TenantEntity[]>([]);
  const [tax, setTax] = useState<TenantTaxConfig>(DEFAULT_TAX);
  const [quoteIdFormat, setQuoteIdFormat] = useState<QuoteIdFormat>(DEFAULT_QUOTE_ID_FORMAT);
  const [co, setCo] = useState<CompanyInfo>(DEFAULT_CO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useSavedFlash();
  const [accent, setAccent] = useState("#378ADD");

  useEffect(() => {
    const el = document.documentElement;
    const v = getComputedStyle(el).getPropertyValue("--accent").trim();
    if (v) setAccent(v);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/entities").then((r) => r.json()),
      fetch("/api/settings/company-info").then((r) => r.json()),
    ]).then(([cfg, coData]: [TenantConfig, CompanyInfo]) => {
      setEntities(cfg.entities ?? []);
      setTax({ ...DEFAULT_TAX, ...(cfg.tax ?? {}) });
      setQuoteIdFormat({ ...DEFAULT_QUOTE_ID_FORMAT, ...(cfg.quote_id_format ?? {}) });
      setCo(coData ?? {});
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    await Promise.all([
      fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entities, tax, quote_id_format: quoteIdFormat } as Partial<TenantConfig>),
      }),
      fetch("/api/settings/company-info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(co),
      }),
    ]);
    setSaving(false);
    flashSaved();
  };

  const setCoProp = <K extends keyof CompanyInfo>(key: K) => (val: CompanyInfo[K]) =>
    setCo((prev) => ({ ...prev, [key]: val }));

  const phones = co.phones ?? [];
  const addPhone = () => setCo((prev) => ({ ...prev, phones: [...(prev.phones ?? []), { label: "", number: "" }] }));
  const updatePhone = (i: number, p: { label: string; number: string }) =>
    setCo((prev) => { const arr = [...(prev.phones ?? [])]; arr[i] = p; return { ...prev, phones: arr }; });
  const removePhone = (i: number) =>
    setCo((prev) => { const arr = [...(prev.phones ?? [])]; arr.splice(i, 1); return { ...prev, phones: arr }; });

  const partners = co.partners ?? [];
  const setPartners = (p: { name: string; logo_url?: string }[]) => setCo((prev) => ({ ...prev, partners: p }));

  if (loading) return <div style={{ padding: 24, color: c.muted, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600, paddingLeft: 12, borderLeft: `3px solid ${accent}` }}>
            Entities &amp; Tax
          </h1>
          <p style={{ margin: "4px 0 0 12px", fontSize: 12, color: c.muted }}>
            Legal entities, print branding, and tax settings for quotations and PDFs.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#1d9e75", fontWeight: 500, opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>✓ Saved</span>
          <button
            onClick={save} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: accent, color: "#fff", border: "none", cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* ── Company profile (print branding) ── */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: c.ink }}>Company profile</h2>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          Used in print letterheads. Each entity below can override name, address, and GSTIN per-quotation.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="Company name" value={co.name ?? ""} onChange={setCoProp("name")} placeholder="Acme Corporation" />
          <Field label="Tagline" value={co.tagline ?? ""} onChange={setCoProp("tagline")} placeholder="e.g. Engineering excellence since 1990" />
        </div>
        <Field label="Address" value={co.address ?? ""} onChange={setCoProp("address")} placeholder="Street, City, State, PIN" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="Email" value={co.email ?? ""} onChange={setCoProp("email")} placeholder="info@company.com" />
          <Field label="Email 2 (optional)" value={co.email2 ?? ""} onChange={setCoProp("email2")} placeholder="sales@company.com" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="Website" value={co.web ?? ""} onChange={setCoProp("web")} placeholder="www.company.com" />
          <Field label="GSTIN / Tax ID" value={co.gstin ?? ""} onChange={setCoProp("gstin")} placeholder="29AXXXXX0000X0XX" mono />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="ISO / certification" value={co.iso ?? ""} onChange={setCoProp("iso")} placeholder="e.g. ISO 9001:2015" />
          <Field label="Footer tagline" value={co.footer_tagline ?? ""} onChange={setCoProp("footer_tagline")} placeholder="e.g. Assuring our best services as always!" />
        </div>
        <Field label="Scope of work / undertaking (header strip)" value={co.undertaking ?? ""} onChange={setCoProp("undertaking")} placeholder="e.g. Rewinding of LT | HT Large Motors, Transformers & Hydro Gensets" />

        {/* Company logo upload */}
        <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 14, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 12 }}>Company logo</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", alignItems: "start" }}>
            <LogoUpload
              label="Logo image"
              currentUrl={co.logo_url ?? ""}
              onUploaded={setCoProp("logo_url")}
              size={72}
            />
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Logo background colour</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={co.logo_bg ?? "#378ADD"} onChange={(e) => setCoProp("logo_bg")(e.target.value)}
                  style={{ width: 40, height: 37, padding: 2, borderRadius: 7, border: `1px solid ${c.line}`, cursor: "pointer" }} />
                <input style={{ ...inp, flex: 1 }} value={co.logo_bg ?? "#378ADD"} onChange={(e) => setCoProp("logo_bg")(e.target.value)} placeholder="#378ADD" />
              </div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>Used when no logo is uploaded — auto-initials shown on this background.</div>
            </div>
          </div>
        </div>

        {/* Phone numbers */}
        <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 14, marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>Phone numbers</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Shown in the PDF footer as labelled columns (e.g. Dir & Tech · Commercial · Work)</div>
            </div>
            <button onClick={addPhone} style={{ fontSize: 12, color: accent, background: "none", border: `1px solid ${accent}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 500 }}>
              + Add phone
            </button>
          </div>
          {phones.length === 0 && (
            <div style={{ fontSize: 12.5, color: c.hint, marginBottom: 8 }}>No phone numbers added. Click + Add phone to add one.</div>
          )}
          {phones.map((p, i) => (
            <PhoneRow key={i} phone={p} onChange={(v) => updatePhone(i, v)} onRemove={() => removePhone(i)} />
          ))}
        </div>

        {/* Partner logos */}
        <PartnerLogos partners={partners} onChange={setPartners} />
      </section>

      {/* ── Legal entities ── */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: c.ink }}>Legal entities</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
              Add separate entities if you issue quotes from multiple legal entities. The default is pre-selected on new quotations.
            </p>
          </div>
          <button onClick={() => setEntities((prev) => [...prev, blankEntity()])}
            style={{ fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, border: `1px solid ${accent}`, color: accent, background: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
            + Add entity
          </button>
        </div>

        {entities.length === 0 && (
          <div style={{ textAlign: "center", padding: "28px 0", color: c.hint, fontSize: 13 }}>
            No entities yet. When blank, quotations use the company profile above.
          </div>
        )}

        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            accent={accent}
            isDefault={entity.is_default}
            onChange={(updated) => setEntities((prev) => prev.map((e) => e.id === entity.id ? updated : e))}
            onRemove={() => setEntities((prev) => prev.filter((e) => e.id !== entity.id))}
            onSetDefault={() => setEntities((prev) => prev.map((e) => ({ ...e, is_default: e.id === entity.id })))}
          />
        ))}
      </section>

      {/* ── Tax configuration ── */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: c.ink }}>Tax configuration</h2>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          Applied to all quotations. Use GST for India, VAT or MwSt for Europe, or leave blank to exclude tax.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Tax label</label>
            <input value={tax.label} onChange={(e) => setTax((t) => ({ ...t, label: e.target.value }))} placeholder="GST / VAT / MwSt"
              style={inp} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Rate (%)</label>
            <input type="number" min={0} max={100} value={tax.rate}
              onChange={(e) => setTax((t) => ({ ...t, rate: parseFloat(e.target.value) || 0 }))}
              style={inp} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <button role="switch" aria-checked={tax.inclusive} onClick={() => setTax((t) => ({ ...t, inclusive: !t.inclusive }))}
            style={{ width: 40, height: 22, borderRadius: 11, background: tax.inclusive ? accent : "#d1d9e0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: tax.inclusive ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left 0.15s", display: "block" }} />
          </button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>Tax-inclusive pricing</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
              {tax.inclusive ? "Line item rates already include tax — tax is not added on top." : "Tax is added on top of line item rates (exclusive)."}
            </div>
          </div>
        </div>
      </section>

      {/* ── Quote ID format ── */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: c.ink }}>Quote ID format</h2>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          Controls the Quote ID assigned to new quotations. Supported tokens: <code style={{ fontFamily: "monospace" }}>{"{PREFIX}"}</code>{" "}
          <code style={{ fontFamily: "monospace" }}>{"{YYYY}"}</code> <code style={{ fontFamily: "monospace" }}>{"{YY}"}</code>{" "}
          <code style={{ fontFamily: "monospace" }}>{"{MM}"}</code> <code style={{ fontFamily: "monospace" }}>{"{SEQ}"}</code>
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field
            label="Prefix"
            value={quoteIdFormat.prefix}
            onChange={(v) => setQuoteIdFormat((f) => ({ ...f, prefix: v }))}
            placeholder="QT"
          />
          <Field
            label="Template"
            value={quoteIdFormat.template}
            onChange={(v) => setQuoteIdFormat((f) => ({ ...f, template: v }))}
            placeholder="{PREFIX}-{YYYY}-{SEQ}"
            mono
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Sequence digits</label>
            <input
              type="number" min={2} max={6}
              value={quoteIdFormat.seq_digits}
              onChange={(e) => setQuoteIdFormat((f) => ({ ...f, seq_digits: Math.min(6, Math.max(2, parseInt(e.target.value) || 4)) }))}
              style={inp}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Sequence resets</label>
            <select
              value={quoteIdFormat.reset}
              onChange={(e) => setQuoteIdFormat((f) => ({ ...f, reset: e.target.value as QuoteIdFormat["reset"] }))}
              style={inp}
            >
              <option value="yearly">Every year</option>
              <option value="never">Never — keep counting</option>
            </select>
          </div>
        </div>

        <div style={{ paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <label style={lbl}>Example</label>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: c.ink }}>
            {formatQuoteRef(quoteIdFormat, new Date(), 1)}
          </div>
          <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>
            Illustrative only — shows the first quote of the sequence, not the actual next Quote ID.
          </div>
        </div>
      </section>

      <p style={{ fontSize: 11.5, color: c.hint, paddingLeft: 4, lineHeight: 1.7 }}>
        Changes apply to new quotations only — existing quotations retain the settings at time of creation.
      </p>
    </div>
  );
}
