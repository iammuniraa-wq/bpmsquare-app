"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { SettingsField, settingsInput } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import type { MarketingTopic } from "@/lib/constants";
import { CONSENT_SETTINGS_TIPS, RELAXED_WARNING } from "@/lib/marketing/consentSettingsTips";

type Basis = "consent_required" | "existing_customer";
type Jurisdiction = { code: string; label: string; existing_customer_allowed: boolean; plain: string };

const row: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: 0, alignSelf: "flex-start" };
const dangerBtn: React.CSSProperties = { ...linkBtn, color: "#e5484d", fontWeight: 400 };

export default function ConsentClient() {
  const [topics, setTopics] = useState<MarketingTopic[]>([]);
  const [defaults, setDefaults] = useState<Record<string, Basis>>({});
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [home, setHome] = useState("other");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { dirty, markSaved } = useSettingsDirty({ topics, defaults, home });

  useEffect(() => {
    fetch("/api/settings/marketing-consent")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setTopics(json.topics);
        setDefaults(json.consent_defaults ?? {});
        setJurisdictions(json.jurisdictions);
        setHome(json.workspace_jurisdiction ?? "other");
        markSaved({ topics: json.topics, defaults: json.consent_defaults ?? {}, home: json.workspace_jurisdiction ?? "other" });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/marketing-consent", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics, consent_defaults: defaults, workspace_jurisdiction: home }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setTopics(json.topics);
      setDefaults(json.consent_defaults ?? {});
      setHome(json.workspace_jurisdiction ?? home);
      markSaved({ topics: json.topics, defaults: json.consent_defaults ?? {}, home: json.workspace_jurisdiction ?? home });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const relaxed = jurisdictions.filter((j) => defaults[j.code] === "existing_customer" && j.existing_customer_allowed).length;

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />

      <SettingsSection id="mk-consent-topics" title="Consent topics" info={CONSENT_SETTINGS_TIPS.topics} defaultOpen summary={topics.map((t) => t.label).join(", ")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {topics.map((t, i) => (
            <div key={i} style={row}>
              <div style={grid}>
                <SettingsField label="Name" help={CONSENT_SETTINGS_TIPS.topicName}>
                  <input aria-label={`Name of consent topic ${i + 1}`} value={t.label} maxLength={40} style={settingsInput} onChange={(e) => setTopics((p) => p.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} />
                </SettingsField>
                <SettingsField label="What it covers" help={CONSENT_SETTINGS_TIPS.topicCovers}>
                  <input aria-label={`What consent topic ${i + 1} covers`} value={t.hint} maxLength={160} style={settingsInput} onChange={(e) => setTopics((p) => p.map((x, xi) => (xi === i ? { ...x, hint: e.target.value } : x)))} />
                </SettingsField>
              </div>
              <button type="button" style={dangerBtn} onClick={() => setTopics((p) => p.filter((_, xi) => xi !== i))}>Remove this consent topic</button>
            </div>
          ))}
          {topics.length < 20 && (
            <button type="button" style={linkBtn} onClick={() => setTopics((p) => [...p, { key: "", label: "", hint: "" }])}>+ Add a consent topic</button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection id="mk-consent-home" title="Where you are based" info={CONSENT_SETTINGS_TIPS.home}
        summary={jurisdictions.find((j) => j.code === home)?.label ?? "Not set"}>
        <SettingsField label="Country group" help={CONSENT_SETTINGS_TIPS.homeField}>
          <select value={home} style={settingsInput} aria-label="Where you are based" onChange={(e) => setHome(e.target.value)}>
            {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.label}</option>)}
          </select>
        </SettingsField>
      </SettingsSection>

      <SettingsSection id="mk-consent-defaults" title="When nobody has said yes" info={CONSENT_SETTINGS_TIPS.defaults} defaultOpen
        summary={relaxed === 0 ? "Everyone needs to have said yes first" : `Existing customers can be emailed in ${relaxed} ${relaxed === 1 ? "country group" : "country groups"}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {relaxed > 0 && <p role="status" style={{ margin: 0, padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--amberbg)", color: "var(--amberink)" }}>{RELAXED_WARNING}</p>}
          {jurisdictions.map((j) => {
            const value: Basis = j.existing_customer_allowed && defaults[j.code] === "existing_customer" ? "existing_customer" : "consent_required";
            return (
              <div key={j.code} style={row}>
                <SettingsField label={j.label} help={j.plain}>
                  <select
                    aria-label={`Rule for ${j.label}`} value={value} disabled={!j.existing_customer_allowed}
                    style={settingsInput}
                    onChange={(e) => setDefaults((d) => ({ ...d, [j.code]: e.target.value as Basis }))}
                  >
                    <option value="consent_required">Only people who have said yes</option>
                    {j.existing_customer_allowed && <option value="existing_customer">Also existing customers, about similar products</option>}
                  </select>
                </SettingsField>
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
