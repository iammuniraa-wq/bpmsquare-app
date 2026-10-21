"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { SettingsField, SettingsRow, settingsInput } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { Toggle } from "@/components/settings/generalShared";
import { HANDOVER_TIPS } from "@/lib/marketing/leads/tips";
import { WEEKDAYS, type HandoverSettings } from "@/lib/marketing/leads/handover";

// Settings, Marketing, Hand-over: what happens to a lead between "someone is interested" and "a salesperson
// has it". Labels and values only; every explanation sits behind the "i" (rule 6b).

export type Person = { user_id: string; label: string };

const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 10, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
  border: `1px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : "transparent", color: on ? c.accent : c.ink,
});

export default function HandoverClient() {
  const [s, setS] = useState<HandoverSettings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [coverage, setCoverage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { dirty, markSaved } = useSettingsDirty(s);

  useEffect(() => {
    fetch("/api/settings/marketing-handover")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setS(json.settings); setPeople(json.people); setCoverage(json.coverage === true);
        markSaved(json.settings);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/marketing-handover", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setS(json.settings); markSaved(json.settings); setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;
  if (!s) return error ? <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error}</div> : null;

  const set = (patch: Partial<HandoverSettings>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));
  return (
    <HandoverView
      s={s} people={people} coverage={coverage} set={set}
      header={<SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
    />
  );
}

/** The screen itself, with its data passed in, so a test can draw it without a server. */
export function HandoverView({ s, people, coverage, set, header }: {
  s: HandoverSettings; people: Person[]; coverage: boolean; set: (patch: Partial<HandoverSettings>) => void; header?: React.ReactNode;
}) {
  const nameOf = (id: string) => people.find((p) => p.user_id === id)?.label ?? "Former member";
  const rota = s.fallback_user_ids;
  const addable = people.filter((p) => !rota.includes(p.user_id));
  const told = [s.overdue_notify.owner ? "owner" : null, s.overdue_notify.team_lead ? "team lead" : null].filter(Boolean).join(" and ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      {header}

      <SettingsSection id="mk-handover-auto" title="Leads by themselves" defaultOpen summary={s.auto_create_leads ? "On" : "Off"}>
        <SettingsRow first label="Make a lead when someone becomes Warm" help={HANDOVER_TIPS.autoCreate}>
          <Toggle on={s.auto_create_leads} accent={c.accent} label="Make a lead when someone becomes Warm" onChange={(v) => set({ auto_create_leads: v })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="mk-handover-time" title="Response time" defaultOpen
        summary={`${s.sla_business_days} working ${s.sla_business_days === 1 ? "day" : "days"}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <SettingsField label="Working days to pick up a lead" help={HANDOVER_TIPS.responseTime}>
            <input
              type="number" min={0} max={30} inputMode="numeric" style={{ ...settingsInput, minHeight: 44 }} aria-label="Working days to pick up a lead"
              value={s.sla_business_days} onChange={(e) => set({ sla_business_days: Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))) })}
            />
          </SettingsField>
          <SettingsField label="Days off" help={HANDOVER_TIPS.daysOff} full>
            <div role="group" aria-label="Days off" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WEEKDAYS.map((name, i) => {
                const on = s.weekly_off.includes(i);
                return (
                  <button key={name} type="button" aria-pressed={on} style={chip(on)}
                    onClick={() => set({ weekly_off: on ? s.weekly_off.filter((d) => d !== i) : [...s.weekly_off, i].sort() })}>
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection id="mk-handover-rota" title="When no team covers it" defaultOpen
        summary={rota.length === 0 ? "The oldest admin" : `${rota.length} ${rota.length === 1 ? "person" : "people"} in turn`}>
        <SettingsField label="People who take new leads in turn" help={HANDOVER_TIPS.fallback} full>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rota.map((id, i) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${c.line}`, borderRadius: 10, padding: "6px 6px 6px 12px" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflowWrap: "anywhere" }}>{i + 1}. {nameOf(id)}</span>
                <button type="button" style={{ ...chip(false), border: "none" }} aria-label={`Remove ${nameOf(id)}`} onClick={() => set({ fallback_user_ids: rota.filter((x) => x !== id) })}>Remove</button>
              </div>
            ))}
            {addable.length > 0 && rota.length < 20 && (
              <select aria-label="Add a person" value="" style={{ ...settingsInput, minHeight: 44 }} onChange={(e) => { if (e.target.value) set({ fallback_user_ids: [...rota, e.target.value] }); }}>
                <option value="">Add a person…</option>
                {addable.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
              </select>
            )}
          </div>
        </SettingsField>
      </SettingsSection>

      <SettingsSection id="mk-handover-overdue" title="When a lead is overdue" defaultOpen summary={told ? `Tell the ${told}` : "Nobody is told"}>
        <SettingsRow first label="Tell the owner" help={HANDOVER_TIPS.overdueOwner}>
          <Toggle on={s.overdue_notify.owner} accent={c.accent} label="Tell the owner" onChange={(v) => set({ overdue_notify: { ...s.overdue_notify, owner: v } })} />
        </SettingsRow>
        <SettingsRow label="Tell the team lead" help={coverage ? HANDOVER_TIPS.overdueLead : HANDOVER_TIPS.overdueLeadOff}>
          <Toggle on={s.overdue_notify.team_lead} accent={c.accent} label="Tell the team lead" onChange={(v) => set({ overdue_notify: { ...s.overdue_notify, team_lead: v } })} />
        </SettingsRow>
        <SettingsRow label="Where they hear" help={HANDOVER_TIPS.overdue}>
          <span style={{ fontSize: 13, color: c.muted }}>Nova inbox</span>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
