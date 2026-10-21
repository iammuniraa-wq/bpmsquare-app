"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { SettingsField, settingsInput } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import {
  computeLeadScore, DEFAULT_RUBRIC, SCORE_LABEL,
  type BehaviourRule, type ProfileField, type ProfileRule, type ScoringEvent, type ScoringRubric,
} from "@/lib/marketing/scoring";
import { SCORING_TIPS } from "@/lib/marketing/scoringTips";
import type { SegmentFilter, SegmentOperator } from "@/lib/marketingSegmentation";

/**
 * Settings -> Marketing -> Scoring. The rubric a lead's score is worked out from: what people do, who they are
 * (Rules), where the lines are (Thresholds) and a sample lead to try them on. Labels, values and actions only;
 * every explanation sits behind an "i" (docs/design/ux-simplification.md).
 */

const EVENT_LABEL: Record<string, string> = {
  "email.clicked": "Clicks a link in an email",
  "email.opened": "Opens an email",
  "email.interest": "Says they are interested",
  "email.unsubscribed": "Unsubscribes",
  "email.bounced": "Their email address bounces",
  "email.complained": "Marks an email as spam",
  "quote.opened": "Opens a quote you sent",
  "quote.accepted": "Accepts a quote",
  "web.page_viewed": "Visits your website",
  "form.submitted": "Fills in a form",
  "whatsapp.replied": "Replies on WhatsApp",
  "event.attended": "Comes to an event",
  "event.registered": "Signs up for an event",
};
const eventLabel = (name: string) => EVENT_LABEL[name] ?? name;

const OPERATOR_LABEL: Record<string, string> = { equals: "is", contains: "contains", gt: "is more than", lt: "is less than", is_true: "is yes", not_equals: "is not" };

const TABS = [{ id: "rules", label: "Rules" }, { id: "thresholds", label: "Thresholds" }, { id: "try", label: "Try it" }] as const;
const TAB_IDS = TABS.map((t) => t.id);

const stack: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const row: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const wideGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 };
const compactGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 };
const input44: React.CSSProperties = { ...settingsInput, minHeight: 44 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: "0 4px", minHeight: 44, display: "inline-flex", alignItems: "center", alignSelf: "flex-start" };
const dangerBtn: React.CSSProperties = { ...linkBtn, color: "var(--err-ink)", fontWeight: 400 };
const fact: React.CSSProperties = { fontSize: 12.5, color: c.muted, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0 };
const errText: React.CSSProperties = { margin: "6px 0 0", fontSize: 12.5, color: "var(--err-ink)" };

function Num({ value, onChange, min, max, label, help, error }: {
  value: number | undefined; onChange: (n: number | undefined) => void; min: number; max: number; label: string; help: string; error?: string;
}) {
  return (
    <SettingsField label={label} help={help}>
      <input
        type="number" min={min} max={max} value={value ?? ""} aria-label={label} aria-invalid={error ? true : undefined} style={input44}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
      {error && <p role="alert" style={errText}>{error}</p>}
    </SettingsField>
  );
}

export default function ScoringClient() {
  const [rubric, setRubric] = useState<ScoringRubric>(DEFAULT_RUBRIC);
  const [events, setEvents] = useState<string[]>([]);
  const [fields, setFields] = useState<ProfileField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const { dirty, markSaved } = useSettingsDirty({ rubric });

  useEffect(() => {
    fetch("/api/settings/marketing-scoring")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setRubric(json.rubric);
        setEvents(json.events ?? []);
        setFields(json.profile_fields ?? []);
        markSaved({ rubric: json.rubric });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server would quietly put both lines back to their defaults, so the screen says so before it can happen.
  const lineError = rubric.thresholds.ready <= rubric.thresholds.engaged ? "Must be higher than Warm from." : "";

  async function save() {
    if (lineError) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/marketing-scoring", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rubric }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setRubric(json.rubric);
      markSaved({ rubric: json.rubric });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const patchBehaviour = (i: number, p: Partial<BehaviourRule>) =>
    setRubric((r) => ({ ...r, behaviour: r.behaviour.map((b, x) => (x === i ? { ...b, ...p } : b)) }));
  const patchProfile = (i: number, p: Partial<ProfileRule>) =>
    setRubric((r) => ({ ...r, profile: r.profile.map((b, x) => (x === i ? { ...b, ...p } : b)) }));
  const patchFilter = (ri: number, fi: number, p: Partial<SegmentFilter>) =>
    patchProfile(ri, { filters: rubric.profile[ri].filters.map((f, x) => (x === fi ? { ...f, ...p } : f)) });

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <SettingsSave dirty={dirty && !lineError} saving={saving} saved={saved} error={error} onSave={save} />

      <div style={fact} className="bpm-label-row">
        Rules v{rubric.version}
        <InfoTip label="Scoring rules">{SCORING_TIPS.intro}</InfoTip>
      </div>

      <Tabs
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === "thresholds" && lineError ? 1 : undefined }))}
        value={tab} onChange={setTab} label="Scoring"
      />

      {tab === "rules" && (
        <>
          <Card title="What people do" info={SCORING_TIPS.behaviour}>
            <div style={stack}>
              {rubric.behaviour.map((b, i) => (
                <div key={i} style={row}>
                  <div style={wideGrid}>
                    <SettingsField label="When someone…">
                      <select value={b.event} aria-label="When someone…" style={input44} onChange={(e) => patchBehaviour(i, { event: e.target.value, label: b.label || eventLabel(e.target.value) })}>
                        {events.map((ev) => <option key={ev} value={ev}>{eventLabel(ev)}</option>)}
                      </select>
                    </SettingsField>
                    <SettingsField label="Shown as" help={SCORING_TIPS.label}>
                      <input value={b.label} maxLength={80} aria-label="Shown as" style={input44} onChange={(e) => patchBehaviour(i, { label: e.target.value })} />
                    </SettingsField>
                  </div>
                  <div style={compactGrid}>
                    <Num label="Points" value={b.points} min={-100} max={100} onChange={(n) => patchBehaviour(i, { points: n ?? 0 })} help={SCORING_TIPS.points} />
                    <Num label="Fades over (days)" value={b.half_life_days} min={0} max={365} onChange={(n) => patchBehaviour(i, { half_life_days: n && n > 0 ? n : undefined })} help={SCORING_TIPS.fades} />
                    <Num label="Counts up to (a week)" value={b.max_per_week} min={0} max={100} onChange={(n) => patchBehaviour(i, { max_per_week: n && n > 0 ? n : undefined })} help={SCORING_TIPS.cap} />
                  </div>
                  <button type="button" style={dangerBtn} onClick={() => setRubric((r) => ({ ...r, behaviour: r.behaviour.filter((_, x) => x !== i) }))}>Remove this rule</button>
                </div>
              ))}
              <button type="button" style={linkBtn} onClick={() => setRubric((r) => ({ ...r, behaviour: [...r.behaviour, { event: events[0] ?? "email.clicked", label: eventLabel(events[0] ?? "email.clicked"), points: 5, half_life_days: 14 }] }))}>
                + Add a rule
              </button>
            </div>
          </Card>

          <Card title="Who they are" info={SCORING_TIPS.profile}>
            <div style={stack}>
              {rubric.profile.map((p, ri) => (
                <div key={ri} style={row}>
                  <div style={compactGrid}>
                    <SettingsField label="Shown as" help={SCORING_TIPS.label}>
                      <input value={p.label} maxLength={80} aria-label="Shown as" style={input44} onChange={(e) => patchProfile(ri, { label: e.target.value })} />
                    </SettingsField>
                    <Num label="Points" value={p.points} min={-100} max={100} onChange={(n) => patchProfile(ri, { points: n ?? 0 })} help={SCORING_TIPS.profilePoints} />
                    <SettingsField label="Matches when" help={SCORING_TIPS.match}>
                      <select value={p.match} aria-label="Matches when" style={input44} onChange={(e) => patchProfile(ri, { match: e.target.value === "any" ? "any" : "all" })}>
                        <option value="all">every line below is true</option>
                        <option value="any">any one line below is true</option>
                      </select>
                    </SettingsField>
                  </div>
                  {p.filters.map((f, fi) => {
                    const def = fields.find((x) => x.key === f.field);
                    return (
                      <div key={fi} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <select value={f.field} style={{ ...input44, flex: "1 1 160px", width: "auto" }} aria-label="About" onChange={(e) => {
                          const nd = fields.find((x) => x.key === e.target.value);
                          patchFilter(ri, fi, { field: e.target.value, operator: (nd?.operators[0] ?? "equals") as SegmentOperator, value: "" });
                        }}>
                          {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                        <select value={f.operator} style={{ ...input44, flex: "0 1 130px", width: "auto" }} aria-label="Is" onChange={(e) => patchFilter(ri, fi, { operator: e.target.value as SegmentOperator })}>
                          {(def?.operators ?? [f.operator]).map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o] ?? o}</option>)}
                        </select>
                        {f.operator !== "is_true" && f.operator !== "is_false" && (
                          <input value={f.value} style={{ ...input44, flex: "1 1 160px", width: "auto" }} aria-label="Value" onChange={(e) => patchFilter(ri, fi, { value: e.target.value })} />
                        )}
                        <button type="button" aria-label="Remove this line" style={{ ...dangerBtn, minWidth: 44, justifyContent: "center" }} onClick={() => patchProfile(ri, { filters: p.filters.filter((_, x) => x !== fi) })}>×</button>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <button type="button" style={linkBtn} onClick={() => patchProfile(ri, { filters: [...p.filters, { id: `f${Date.now()}`, field: fields[0]?.key ?? "type", operator: (fields[0]?.operators[0] ?? "equals") as SegmentOperator, value: "" }] })}>+ Add a line</button>
                    <button type="button" style={dangerBtn} onClick={() => setRubric((r) => ({ ...r, profile: r.profile.filter((_, x) => x !== ri) }))}>Remove this rule</button>
                  </div>
                </div>
              ))}
              <button type="button" style={linkBtn} onClick={() => setRubric((r) => ({ ...r, profile: [...r.profile, { label: "New rule", match: "all", points: 5, filters: [{ id: `f${Date.now()}`, field: fields[0]?.key ?? "type", operator: (fields[0]?.operators[0] ?? "equals") as SegmentOperator, value: "" }] }] }))}>
                + Add a rule
              </button>
            </div>
          </Card>
        </>
      )}

      {tab === "thresholds" && (
        <Card title="Where the lines are" info={SCORING_TIPS.lines}>
          <div style={stack}>
            <div style={wideGrid}>
              <Num label="Warm from" value={rubric.thresholds.engaged} min={1} max={99} onChange={(n) => setRubric((r) => ({ ...r, thresholds: { ...r.thresholds, engaged: n ?? r.thresholds.engaged } }))} help={SCORING_TIPS.warm} />
              <Num label="Hot from" value={rubric.thresholds.ready} min={2} max={100} onChange={(n) => setRubric((r) => ({ ...r, thresholds: { ...r.thresholds, ready: n ?? r.thresholds.ready } }))} help={SCORING_TIPS.hot} error={lineError} />
              <Num label="Look back (days)" value={rubric.window_days} min={7} max={365} onChange={(n) => setRubric((r) => ({ ...r, window_days: n ?? r.window_days }))} help={SCORING_TIPS.lookback} />
            </div>
            {!lineError && (
              <div style={fact}>
                {SCORE_LABEL.new} under {rubric.thresholds.engaged} · {SCORE_LABEL.engaged} {rubric.thresholds.engaged} to {rubric.thresholds.ready - 1} · {SCORE_LABEL.ready} from {rubric.thresholds.ready}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "try" && (
        <Card title="Try it on a sample lead" info={SCORING_TIPS.tryIt}>
          <SamplePreview rubric={rubric} />
        </Card>
      )}
    </div>
  );
}

function SamplePreview({ rubric }: { rubric: ScoringRubric }) {
  const [counts, setCounts] = useState<Record<number, { n: number; days: number }>>({});
  const [profile, setProfile] = useState({ type: "", country: "", contact_role: "", has_active_amc: false });

  const result = useMemo(() => {
    const now = new Date();
    const evs: ScoringEvent[] = [];
    rubric.behaviour.forEach((b, i) => {
      const s = counts[i];
      if (!s || s.n <= 0) return;
      for (let k = 0; k < Math.min(50, s.n); k++) {
        evs.push({ name: b.event, occurred_at: new Date(now.getTime() - s.days * 86_400_000).toISOString(), payload: b.match ? { ...b.match } : {} });
      }
    });
    return computeLeadScore(rubric, evs, { ...profile, has_active_amc: profile.has_active_amc }, null, now);
  }, [rubric, counts, profile]);

  const field = (label: string, key: "type" | "country" | "contact_role", help: string) => (
    <SettingsField label={label} help={help}>
      <input value={profile[key]} aria-label={label} style={input44} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} />
    </SettingsField>
  );

  return (
    <div style={stack}>
      <div style={wideGrid}>
        {field("Account type", "type", SCORING_TIPS.accountType)}
        {field("Country", "country", SCORING_TIPS.country)}
        {field("Their role", "contact_role", SCORING_TIPS.role)}
        <SettingsField label="Has a service contract" help={SCORING_TIPS.serviceContract}>
          <div style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
            <input type="checkbox" checked={profile.has_active_amc} aria-label="Has a service contract" onChange={(e) => setProfile((p) => ({ ...p, has_active_amc: e.target.checked }))} style={{ width: 20, height: 20, accentColor: c.accent }} />
          </div>
        </SettingsField>
      </div>
      {rubric.behaviour.filter((b) => b.points !== 0).map((b) => {
        const i = rubric.behaviour.indexOf(b);
        const s = counts[i] ?? { n: 0, days: 1 };
        return (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 220px", fontSize: 13 }}>{b.label}</span>
            <label style={{ fontSize: 12.5, color: c.muted }}>times <input type="number" min={0} max={50} value={s.n} style={{ ...input44, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, n: Number(e.target.value) || 0 } }))} /></label>
            <label style={{ fontSize: 12.5, color: c.muted }}>days ago <input type="number" min={0} max={365} value={s.days} style={{ ...input44, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, days: Number(e.target.value) || 0 } }))} /></label>
          </div>
        );
      })}
      <div role="status" aria-live="polite" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: c.ink }}>{result.score}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{result.label}</span>
        </div>
        {result.factors.length === 0 ? (
          <p className="bpm-t-help" style={{ margin: "4px 0 0" }}>No points yet. Add something above.</p>
        ) : (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: c.ink }}>
            {result.factors.map((f, i) => (
              <li key={i}>
                <strong>{f.points > 0 ? `+${f.points}` : f.points}</strong> {f.label}
                <span className="bpm-t-help"> — {f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
