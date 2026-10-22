"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import RowTable from "@/components/settings/RowTable";
import SectionHead from "@/components/settings/SectionHead";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { SettingsRow } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { Toggle } from "@/components/settings/generalShared";
import { c } from "@/lib/theme";
import type { MarketingTopic } from "@/lib/constants";
import { CONSENT_SETTINGS_TIPS, RELAXED_WARNING } from "@/lib/marketing/consentSettingsTips";
import { basisOf, basisWord, dropBlankTopic, hiddenRuleCount, topicsFull, visibleRules, type Basis, type Jurisdiction } from "./consentLogic";

// Settings, Marketing, Consent: two lists, one row per thing, a row opens its side panel. Labels, values and
// actions only; every explanation sits behind the "i" (bpmsquarecore 6b).

export type ConsentState = { topics: MarketingTopic[]; defaults: Record<string, Basis>; home: string; trackOpens: boolean };
type Panel = { kind: "rule"; code: string } | { kind: "topic"; index: number } | null;

const relaxedChip: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--amberbg)", color: "var(--amberink)" };
const homeChip: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--panel2)", color: c.muted, border: `1px solid ${c.line}` };

export default function ConsentTab() {
  const [state, setState] = useState<ConsentState>({ topics: [], defaults: {}, home: "other", trackOpens: false });
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [studio, setStudio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { dirty, markSaved } = useSettingsDirty(state);

  const fromServer = (json: { topics: MarketingTopic[]; consent_defaults?: Record<string, Basis>; workspace_jurisdiction?: string; track_opens?: boolean }, home: string): ConsentState => ({
    topics: json.topics, defaults: json.consent_defaults ?? {}, home: json.workspace_jurisdiction ?? home, trackOpens: json.track_opens === true,
  });

  useEffect(() => {
    fetch("/api/settings/marketing-consent")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        const next = fromServer(json, "other");
        setState(next); setJurisdictions(json.jurisdictions); setStudio(json.newsletter_studio === true);
        markSaved(next);
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
        body: JSON.stringify({ topics: state.topics, consent_defaults: state.defaults, workspace_jurisdiction: state.home, track_opens: state.trackOpens }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      const next = fromServer(json, state.home);
      setState(next); markSaved(next); setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;
  return (
    <ConsentView
      state={state} jurisdictions={jurisdictions} studio={studio} set={(patch) => setState((p) => ({ ...p, ...patch }))}
      header={<SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
    />
  );
}

/** The screen itself, with its data passed in, so a test can draw it without a server. */
export function ConsentView({ state, jurisdictions, studio, set, header, openPanel }: {
  state: ConsentState; jurisdictions: Jurisdiction[]; studio: boolean; set: (patch: Partial<ConsentState>) => void; header?: React.ReactNode;
  /** Tests open a panel without a click. */
  openPanel?: NonNullable<Panel>;
}) {
  const [panel, setPanel] = useState<Panel>(openPanel ?? null);
  const [showAll, setShowAll] = useState(false);
  const { topics, defaults, home } = state;

  const rules = visibleRules(jurisdictions, defaults, home, showAll);
  const hidden = hiddenRuleCount(jurisdictions, defaults, home);
  const patchTopic = (i: number, p: Partial<MarketingTopic>) => set({ topics: topics.map((t, x) => (x === i ? { ...t, ...p } : t)) });
  const closePanel = () => {
    if (panel?.kind === "topic") set({ topics: dropBlankTopic(topics, panel.index) });
    setPanel(null);
  };

  const ruleJ = panel?.kind === "rule" ? jurisdictions.find((j) => j.code === panel.code) : undefined;
  const topic = panel?.kind === "topic" ? topics[panel.index] : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 820 }}>
      {header}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, alignItems: "start" }}>
        <Field label="Based in" info={CONSENT_SETTINGS_TIPS.home} style={{ marginBottom: 0 }}>
          <Select value={home} onChange={(e) => set({ home: e.target.value })} style={{ minHeight: 44 }}>
            {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.label}</option>)}
          </Select>
        </Field>
        {studio && (
          <SettingsRow first label="Count newsletter opens" help={CONSENT_SETTINGS_TIPS.opens}>
            <Toggle on={state.trackOpens} accent={c.accent} label="Count newsletter opens" onChange={(v) => set({ trackOpens: v })} />
          </SettingsRow>
        )}
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHead title="Rules by country" info={CONSENT_SETTINGS_TIPS.rules} />
        <RowTable
          label="Rules by country" columns={["Country", "Without a recorded yes"]}
          rows={rules.map((j) => {
            const b = basisOf(j, defaults);
            return {
              id: j.code, openLabel: `${j.label}: edit the rule`, onOpen: () => setPanel({ kind: "rule", code: j.code }),
              cells: [
                <span key="n">{j.label}{j.code === home && <span style={{ ...homeChip, marginInlineStart: 8 }}>Your country</span>}</span>,
                b === "existing_customer" ? <span key="b" style={relaxedChip}>{basisWord(b)}</span> : basisWord(b),
              ],
            };
          })}
        />
        {(hidden > 0 || showAll) && (
          <Button variant="quiet" size="sm" style={{ alignSelf: "flex-start", minHeight: 44 }} aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer countries" : `Show other countries (${hidden})`}
          </Button>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHead
          title="Topics" info={CONSENT_SETTINGS_TIPS.topics}
          action={!topicsFull(topics) && (
            <Button size="sm" onClick={() => { set({ topics: [...topics, { key: "", label: "", hint: "" }] }); setPanel({ kind: "topic", index: topics.length }); }}>Add a topic</Button>
          )}
        />
        <RowTable
          label="Topics" columns={["Topic", "Covers"]}
          rows={topics.map((t, i) => ({
            id: `${t.key || "new"}-${i}`, openLabel: `${t.label || "New topic"}: edit`, onOpen: () => setPanel({ kind: "topic", index: i }),
            cells: [t.label || "New topic", t.hint],
          }))}
        />
      </section>

      {ruleJ && (
        <SidePanel
          title={ruleJ.label} subtitle={ruleJ.code === home ? "Your country" : undefined} onClose={closePanel}
          footer={<Button variant="primary" onClick={closePanel}>Done</Button>}
        >
          <Field label="Without a recorded yes" info={ruleJ.plain} style={{ marginBottom: 0 }}>
            <Select
              value={basisOf(ruleJ, defaults)} disabled={!ruleJ.existing_customer_allowed} style={{ minHeight: 44 }}
              onChange={(e) => set({ defaults: { ...defaults, [ruleJ.code]: e.target.value as Basis } })}
            >
              <option value="consent_required">Only people who have said yes</option>
              {ruleJ.existing_customer_allowed && <option value="existing_customer">Also existing customers, about similar products</option>}
            </Select>
          </Field>
          {basisOf(ruleJ, defaults) === "existing_customer" && <p role="status" style={{ margin: 0, padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--amberbg)", color: "var(--amberink)" }}>{RELAXED_WARNING}</p>}
        </SidePanel>
      )}

      {panel?.kind === "topic" && topic && (
        <SidePanel
          title={topic.label || "New topic"} onClose={closePanel}
          footer={(
            <>
              <Button variant="danger" onClick={() => { set({ topics: topics.filter((_, x) => x !== panel.index) }); setPanel(null); }}>Remove topic</Button>
              <Button variant="primary" onClick={closePanel}>Done</Button>
            </>
          )}
        >
          <Field label="Name" info={CONSENT_SETTINGS_TIPS.topicName} style={{ marginBottom: 0 }}>
            <Input value={topic.label} maxLength={40} style={{ minHeight: 44 }} onChange={(e) => patchTopic(panel.index, { label: e.target.value })} />
          </Field>
          <Field label="Covers" info={CONSENT_SETTINGS_TIPS.topicCovers} style={{ marginBottom: 0 }}>
            <Input value={topic.hint} maxLength={160} style={{ minHeight: 44 }} onChange={(e) => patchTopic(panel.index, { hint: e.target.value })} />
          </Field>
        </SidePanel>
      )}
    </div>
  );
}
