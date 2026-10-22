"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { SettingsRow } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { Toggle } from "@/components/settings/generalShared";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { HANDOVER_TIPS } from "@/lib/marketing/leads/tips";
import { WEEKDAYS, type HandoverSettings } from "@/lib/marketing/leads/handover";

// Settings, Marketing, Leads, Hand-over: what happens to a lead between "someone is interested" and "a salesperson
// has it", as one short form. Labels and values only; every explanation sits behind the "i" (bpmsquarecore 6b).

export type Person = { user_id: string; label: string };
export type Teams = { in_turn: number; team_lead: number } | null;

const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 10, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
  border: `1px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : "transparent", color: on ? c.accent : c.ink,
});

export default function HandoverTab() {
  const [s, setS] = useState<HandoverSettings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [coverage, setCoverage] = useState(false);
  const [teams, setTeams] = useState<Teams>(null);
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
        setS(json.settings); setPeople(json.people); setCoverage(json.coverage === true); setTeams(json.teams ?? null);
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
  return (
    <HandoverView
      s={s} people={people} coverage={coverage} teams={teams} set={(patch) => setS((prev) => (prev ? { ...prev, ...patch } : prev))}
      header={<SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
    />
  );
}

/** The form itself, with its data passed in, so a test can draw it without a server. */
export function HandoverView({ s, people, coverage, teams, set, header }: {
  s: HandoverSettings; people: Person[]; coverage: boolean; teams: Teams; set: (patch: Partial<HandoverSettings>) => void; header?: React.ReactNode;
}) {
  const nameOf = (id: string) => people.find((p) => p.user_id === id)?.label ?? "Former member";
  const rota = s.fallback_user_ids;
  const addable = people.filter((p) => !rota.includes(p.user_id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      {header}

      <div>
        <SettingsRow first label="Make a lead when someone becomes Warm" help={HANDOVER_TIPS.autoCreate}>
          <Toggle on={s.auto_create_leads} accent={c.accent} label="Make a lead when someone becomes Warm" onChange={(v) => set({ auto_create_leads: v })} />
        </SettingsRow>
        <SettingsRow label="Tell the owner when a lead is overdue" help={HANDOVER_TIPS.overdueOwner}>
          <Toggle on={s.overdue_notify.owner} accent={c.accent} label="Tell the owner when a lead is overdue" onChange={(v) => set({ overdue_notify: { ...s.overdue_notify, owner: v } })} />
        </SettingsRow>
        <SettingsRow label="Tell the team lead when a lead is overdue" help={coverage ? HANDOVER_TIPS.overdueLead : HANDOVER_TIPS.overdueLeadOff}>
          <Toggle on={s.overdue_notify.team_lead} accent={c.accent} label="Tell the team lead when a lead is overdue" onChange={(v) => set({ overdue_notify: { ...s.overdue_notify, team_lead: v } })} />
        </SettingsRow>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "start" }}>
        <Field label="Working days to pick up a lead" info={HANDOVER_TIPS.responseTime} style={{ marginBottom: 0 }}>
          <Input
            type="number" min={0} max={30} inputMode="numeric" style={{ minHeight: 44 }}
            value={s.sla_business_days} onChange={(e) => set({ sla_business_days: Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))) })}
          />
        </Field>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <div className="bpm-label-row" style={{ marginBottom: 6 }}>
            <span className="bpm-t-label">Days off</span>
            <InfoTip label="Days off">{HANDOVER_TIPS.daysOff}</InfoTip>
          </div>
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
        </div>
      </div>

      <Field label="When no team covers it, these people take new leads in turn" info={HANDOVER_TIPS.fallback} style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rota.map((id, i) => (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${c.line}`, borderRadius: 10, padding: "6px 6px 6px 12px" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflowWrap: "anywhere" }}>{i + 1}. {nameOf(id)}</span>
              <button type="button" style={{ ...chip(false), border: "none" }} aria-label={`Remove ${nameOf(id)}`} onClick={() => set({ fallback_user_ids: rota.filter((x) => x !== id) })}>Remove</button>
            </div>
          ))}
          {addable.length > 0 && rota.length < 20 && (
            <Select aria-label="Add a person" value="" style={{ minHeight: 44 }} onChange={(e) => { if (e.target.value) set({ fallback_user_ids: [...rota, e.target.value] }); }}>
              <option value="">Add a person…</option>
              {addable.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
            </Select>
          )}
        </div>
      </Field>

      {coverage && teams && (
        <div className="bpm-label-row" style={{ gap: 8, flexWrap: "wrap", fontSize: 13, color: c.muted }}>
          <span>Teams</span>
          <span style={{ fontWeight: 600, padding: "3px 10px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--panel2)", color: c.ink }}>
            {teams.in_turn} in turn, {teams.team_lead} to the team lead
          </span>
          <Link href={ROUTES.settingsCoverage} style={{ color: c.accent, fontWeight: 600, minHeight: 44, display: "inline-flex", alignItems: "center" }}>Change in Coverage</Link>
        </div>
      )}
    </div>
  );
}

