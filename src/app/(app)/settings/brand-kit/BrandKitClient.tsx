"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { settingsInput, settingsLabel } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import type { BrandKit } from "@/lib/constants";

type Font = { key: string; label: string };
type Loaded = {
  brand_kit: BrandKit;
  resolved: { primary: string; secondary: string; text: string; fontPairing: string; logoUrl: string | null; tone: "formal" | "warm" };
  fonts: Font[];
};

const hint: React.CSSProperties = { margin: "4px 0 0" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: 0, alignSelf: "flex-start" };

export default function BrandKitClient() {
  const [kit, setKit] = useState<BrandKit>({});
  const [fonts, setFonts] = useState<Font[]>([]);
  const [defaults, setDefaults] = useState<Loaded["resolved"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const { dirty, markSaved } = useSettingsDirty({ kit });

  function apply(json: Loaded) {
    setKit(json.brand_kit);
    setFonts(json.fonts);
    setDefaults(json.resolved);
    markSaved({ kit: json.brand_kit });
  }

  useEffect(() => {
    fetch("/api/settings/brand-kit")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        apply(json);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/brand-kit", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_kit: kit }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      apply(json);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setKit((k) => ({ ...k, logo_url: json.url }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }));
  const links = kit.social_links ?? [];

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />
      <p className="bpm-t-help" style={{ margin: 0 }}>
        Every newsletter uses this kit. Changing it re-brands a design the next time that design is saved; a version already used in a campaign never changes.
      </p>

      <SettingsSection id="bk-logo" title="Logo" defaultOpen summary={kit.logo_url ? "Your own logo" : defaults?.logoUrl ? "The workspace logo" : "None yet"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(kit.logo_url || defaults?.logoUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.logo_url ?? defaults?.logoUrl ?? ""} alt="Logo" style={{ maxHeight: 48, maxWidth: 220, objectFit: "contain", alignSelf: "flex-start" }} />
          )}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} aria-label="Upload a logo" />
          <p className="bpm-t-help" style={hint}>PNG, JPG or WebP, up to 2 MB. Until you add one here, the workspace logo is used.</p>
          {kit.logo_url && <button type="button" style={linkBtn} onClick={() => set({ logo_url: undefined })}>Use the workspace logo instead</button>}
        </div>
      </SettingsSection>

      <SettingsSection id="bk-colours" title="Colours and fonts" defaultOpen summary={`${kit.primary ?? defaults?.primary} · ${kit.secondary ?? defaults?.secondary}`}>
        <div style={grid}>
          {([["primary", "Main colour", "The email header and the intro banner."], ["secondary", "Accent colour", "Buttons and prices."], ["text", "Text colour", "Body words on white. Keep it dark."]] as const).map(([key, label, help]) => (
            <div key={key}>
              <label style={settingsLabel} htmlFor={`bk-${key}`}>{label}</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input id={`bk-${key}`} type="color" value={kit[key] ?? defaults?.[key] ?? ""} onChange={(e) => set({ [key]: e.target.value })} style={{ width: 44, height: 38, padding: 2, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel }} />
                <input aria-label={`${label} as a code`} value={kit[key] ?? ""} placeholder={defaults?.[key]} maxLength={7} onChange={(e) => set({ [key]: e.target.value || undefined })} style={settingsInput} />
              </div>
              <p className="bpm-t-help" style={hint}>{help}</p>
            </div>
          ))}
          <div>
            <label style={settingsLabel} htmlFor="bk-font">Font</label>
            <select id="bk-font" value={kit.font_pairing ?? defaults?.fontPairing} onChange={(e) => set({ font_pairing: e.target.value })} style={{ ...settingsInput, marginTop: 6 }}>
              {fonts.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <p className="bpm-t-help" style={hint}>Only fonts every email program has. Arabic uses Tahoma or Segoe UI next to it.</p>
          </div>
          <div>
            <label style={settingsLabel} htmlFor="bk-tone">Tone for AI writing</label>
            <select id="bk-tone" value={kit.tone ?? "formal"} onChange={(e) => set({ tone: e.target.value as "formal" | "warm" })} style={{ ...settingsInput, marginTop: 6 }}>
              <option value="formal">Formal and courteous</option>
              <option value="warm">Warm and friendly</option>
            </select>
            <p className="bpm-t-help" style={hint}>How drafts and translations sound. You can always rewrite a block.</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection id="bk-footer" title="Footer and social links" summary={kit.footer_address ? kit.footer_address.split("\n")[0] : "No address yet"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={settingsLabel} htmlFor="bk-addr">Address lines</label>
            <textarea id="bk-addr" rows={3} maxLength={400} value={kit.footer_address ?? ""} onChange={(e) => set({ footer_address: e.target.value || undefined })} style={{ ...settingsInput, marginTop: 6, resize: "vertical" }} />
            <p className="bpm-t-help" style={hint}>Shown in the footer above the unsubscribe line, for example your street and phone number.</p>
          </div>
          {links.map((l, i) => (
            <div key={i} style={grid}>
              <input aria-label="Link name" placeholder="LinkedIn" maxLength={20} value={l.label} style={settingsInput} onChange={(e) => set({ social_links: links.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
              <input aria-label="Link address" placeholder="https://…" value={l.url} style={settingsInput} onChange={(e) => set({ social_links: links.map((x, xi) => (xi === i ? { ...x, url: e.target.value } : x)) })} />
              <button type="button" style={linkBtn} onClick={() => set({ social_links: links.filter((_, xi) => xi !== i) })}>Remove</button>
            </div>
          ))}
          {links.length < 6 && <button type="button" style={linkBtn} onClick={() => set({ social_links: [...links, { label: "", url: "" }] })}>+ Add a social link</button>}
          <p className="bpm-t-help" style={hint}>Only https addresses are kept. They appear where a design has a Social block.</p>
        </div>
      </SettingsSection>
    </div>
  );
}
