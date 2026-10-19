"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { settingsInput, settingsLabel } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import type { MarketingTopic } from "@/lib/constants";

type Basis = "consent_required" | "existing_customer";
type Jurisdiction = { code: string; label: string; existing_customer_allowed: boolean; plain: string };

const hint: React.CSSProperties = { margin: "4px 0 0" };
const row: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: 0, alignSelf: "flex-start" };
const dangerBtn: React.CSSProperties = { ...linkBtn, color: "#e5484d", fontWeight: 400 };

export default function ConsentClient() {
  const [topics, setTopics] = useState<MarketingTopic[]>([]);
  const [defaults, setDefaults] = useState<Record<string, Basis>>({});
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { dirty, markSaved } = useSettingsDirty({ topics, defaults });

  useEffect(() => {
    fetch("/api/settings/marketing-consent")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setTopics(json.topics);
        setDefaults(json.consent_defaults ?? {});
        setJurisdictions(json.jurisdictions);
        markSaved({ topics: json.topics, defaults: json.consent_defaults ?? {} });
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
        body: JSON.stringify({ topics, consent_defaults: defaults }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setTopics(json.topics);
      setDefaults(json.consent_defaults ?? {});
      markSaved({ topics: json.topics, defaults: json.consent_defaults ?? {} });
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

      <p className="bpm-t-help" style={{ margin: 0 }}>
        Every person&apos;s yes and no is kept as a record, with when and how it was given. Until someone has said yes, nobody is emailed
        unless you choose otherwise below.
      </p>

      <SettingsSection id="mk-consent-topics" title="Topics" defaultOpen summary={topics.map((t) => t.label).join(", ")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="bpm-t-help" style={{ margin: 0 }}>People can agree to some topics and refuse others. A topic people have already answered can be renamed but not removed.</p>
          {topics.map((t, i) => (
            <div key={i} style={row}>
              <div style={grid}>
                <div>
                  <label style={settingsLabel}>Name</label>
                  <input value={t.label} maxLength={40} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => setTopics((p) => p.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} />
                  <p className="bpm-t-help" style={hint}>What people see when they choose.</p>
                </div>
                <div>
                  <label style={settingsLabel}>What it covers</label>
                  <input value={t.hint} maxLength={160} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => setTopics((p) => p.map((x, xi) => (xi === i ? { ...x, hint: e.target.value } : x)))} />
                  <p className="bpm-t-help" style={hint}>One line under the name, so people know what they are agreeing to.</p>
                </div>
              </div>
              <button type="button" style={dangerBtn} onClick={() => setTopics((p) => p.filter((_, xi) => xi !== i))}>Remove this topic</button>
            </div>
          ))}
          {topics.length < 20 && (
            <button type="button" style={linkBtn} onClick={() => setTopics((p) => [...p, { key: "", label: "", hint: "" }])}>+ Add a topic</button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection id="mk-consent-defaults" title="When nobody has said yes" defaultOpen
        summary={relaxed === 0 ? "Everyone needs to have said yes first" : `Existing customers can be emailed in ${relaxed} ${relaxed === 1 ? "country group" : "country groups"}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="bpm-t-help" style={{ margin: 0 }}>
            For a person with no recorded answer, choose whether they can still be emailed. The safe choice is that they cannot. Ask your legal
            adviser before changing it, and keep in mind the rule for each country differs.
          </p>
          {jurisdictions.map((j) => {
            const value: Basis = j.existing_customer_allowed && defaults[j.code] === "existing_customer" ? "existing_customer" : "consent_required";
            return (
              <div key={j.code} style={row}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <label style={settingsLabel} htmlFor={`mk-basis-${j.code}`}>{j.label}</label>
                  </div>
                  <select
                    id={`mk-basis-${j.code}`} value={value} disabled={!j.existing_customer_allowed}
                    style={{ ...settingsInput, flex: "1 1 280px", width: "auto" }}
                    onChange={(e) => setDefaults((d) => ({ ...d, [j.code]: e.target.value as Basis }))}
                  >
                    <option value="consent_required">Only people who have said yes</option>
                    {j.existing_customer_allowed && <option value="existing_customer">Also existing customers, about similar products</option>}
                  </select>
                </div>
                <p className="bpm-t-help" style={{ margin: 0 }}>{j.plain}</p>
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
