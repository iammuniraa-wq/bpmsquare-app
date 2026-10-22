"use client";

import { useEffect, useState } from "react";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import InfoTip from "@/components/ui/InfoTip";
import { c } from "@/lib/theme";
import { LIMITS_TIPS } from "@/lib/marketing/limitsTips";
import { MAX_EMAILS_PER_DAY, MAX_WHATSAPP_PER_WEEK, type LimitsSettings } from "@/lib/marketing/limits";

// Settings, Marketing, Consent, Limits: when and how often a message may go out. About six controls, one timezone
// chip. Labels and values only; every explanation sits behind the "i" (bpmsquarecore 6b).

export type LimitsMeta = { timezone: string; source: "workforce" | "default"; modules: { journeys: boolean; whatsapp: boolean } };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 10, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
  border: `1px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : "transparent", color: on ? c.accent : c.ink,
});

export default function LimitsTab() {
  const [s, setS] = useState<LimitsSettings | null>(null);
  const [meta, setMeta] = useState<LimitsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { dirty, markSaved } = useSettingsDirty(s);

  useEffect(() => {
    fetch("/api/settings/marketing-limits")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setS(json.settings); setMeta({ timezone: json.timezone, source: json.source, modules: json.modules });
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
      const res = await fetch("/api/settings/marketing-limits", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
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
  if (!s || !meta) return error ? <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error}</div> : null;
  return (
    <LimitsView
      s={s} meta={meta} set={(patch) => setS((p) => (p ? { ...p, ...patch } : p))}
      header={<SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
    />
  );
}

/** The form itself, with its data passed in, so a test can draw it without a server. */
export function LimitsView({ s, meta, set, header }: { s: LimitsSettings; meta: LimitsMeta; set: (patch: Partial<LimitsSettings>) => void; header?: React.ReactNode }) {
  const num = (v: string, min: number, max: number, fallback: number) => (v === "" ? fallback : Math.max(min, Math.min(max, Math.floor(Number(v) || min))));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      {header}

      <div className="bpm-label-row" style={{ gap: 0 }}>
        <span style={{ fontSize: 13, color: c.muted }}>Timezone</span>
        <span style={{ marginInlineStart: 8, fontSize: 12.5, fontWeight: 600, padding: "3px 10px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--panel2)", color: c.ink }}>
          {meta.timezone}{meta.source === "default" ? " (default)" : ""}
        </span>
        <InfoTip label="Timezone">{meta.source === "workforce" ? LIMITS_TIPS.timezoneWorkforce : LIMITS_TIPS.timezoneDefault}</InfoTip>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "start" }}>
        {meta.modules.journeys && (
          <>
            <Field label="Quiet from" info={LIMITS_TIPS.quiet} style={{ marginBottom: 0 }}>
              <Select value={s.quiet_from_hour} style={{ minHeight: 44 }} onChange={(e) => set({ quiet_from_hour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </Select>
            </Field>
            <Field label="Quiet until" style={{ marginBottom: 0 }}>
              <Select value={s.quiet_to_hour} style={{ minHeight: 44 }} onChange={(e) => set({ quiet_to_hour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </Select>
            </Field>
            <Field label="Emails a day, per person" info={LIMITS_TIPS.perDay} style={{ marginBottom: 0 }}>
              <Input type="number" inputMode="numeric" min={1} max={MAX_EMAILS_PER_DAY} value={s.max_per_day} style={{ minHeight: 44 }} onChange={(e) => set({ max_per_day: num(e.target.value, 1, MAX_EMAILS_PER_DAY, s.max_per_day) })} />
            </Field>
          </>
        )}
        {meta.modules.whatsapp && (
          <Field label="WhatsApp messages a week, per person" info={LIMITS_TIPS.whatsapp} style={{ marginBottom: 0 }}>
            <Input type="number" inputMode="numeric" min={1} max={MAX_WHATSAPP_PER_WEEK} value={s.whatsapp_weekly_cap} style={{ minHeight: 44 }} onChange={(e) => set({ whatsapp_weekly_cap: num(e.target.value, 1, MAX_WHATSAPP_PER_WEEK, s.whatsapp_weekly_cap) })} />
          </Field>
        )}
        {meta.modules.journeys && (
          <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
            <div className="bpm-label-row" style={{ marginBottom: 6 }}>
              <span className="bpm-t-label">No journey emails on</span>
              <InfoTip label="No journey emails on">{LIMITS_TIPS.daysOff}</InfoTip>
            </div>
            <div role="group" aria-label="No journey emails on" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DAY_NAMES.map((name, i) => {
                const on = s.off_weekdays.includes(i);
                return (
                  <button key={name} type="button" aria-pressed={on} style={chip(on)}
                    onClick={() => set({ off_weekdays: on ? s.off_weekdays.filter((d) => d !== i) : [...s.off_weekdays, i].sort() })}>
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
