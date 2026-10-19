"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { settingsInput, settingsLabel } from "@/components/settings/SettingsField";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import {
  computeLeadScore, DEFAULT_RUBRIC,
  type BehaviourRule, type ProfileField, type ProfileRule, type ScoringEvent, type ScoringRubric,
} from "@/lib/marketing/scoring";
import type { SegmentFilter, SegmentOperator } from "@/lib/marketingSegmentation";

/**
 * Settings -> Marketing -> Scoring. The rubric a lead's score is worked out
 * from, in plain words: what people do, who they are, and where the lines are.
 * Every option carries its one-line hint under it, always visible.
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

const hint: React.CSSProperties = { margin: "4px 0 0" };
const card: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const row: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: 0, alignSelf: "flex-start" };
const dangerBtn: React.CSSProperties = { ...linkBtn, color: "#e5484d", fontWeight: 400 };

function Num({ value, onChange, min, max, label, help }: { value: number | undefined; onChange: (n: number | undefined) => void; min: number; max: number; label: string; help: string }) {
  return (
    <div>
      <label style={settingsLabel}>{label}</label>
      <input
        type="number" min={min} max={max} value={value ?? ""} style={{ ...settingsInput, marginTop: 6 }}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
      <p className="bpm-t-help" style={hint}>{help}</p>
    </div>
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

  async function save() {
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
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />

      <p className="bpm-t-help" style={{ margin: 0 }}>
        Scoring rules version {rubric.version}. A lead&apos;s score is added up from these rules, so anyone can see exactly why it is what it is.
        Nothing here is decided by AI.
      </p>

      <SettingsSection id="mk-scoring-behaviour" title="What people do" defaultOpen
        summary={`${rubric.behaviour.length} rules, from clicks and quote views to unsubscribes`}>
        <div style={card}>
          <p className="bpm-t-help" style={{ margin: 0 }}>Each time someone does one of these, their lead earns (or loses) points. Points fade as the action gets older.</p>
          {rubric.behaviour.map((b, i) => (
            <div key={i} style={row}>
              <div style={grid}>
                <div>
                  <label style={settingsLabel}>When someone…</label>
                  <select value={b.event} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => patchBehaviour(i, { event: e.target.value, label: b.label || eventLabel(e.target.value) })}>
                    {events.map((ev) => <option key={ev} value={ev}>{eventLabel(ev)}</option>)}
                  </select>
                  <p className="bpm-t-help" style={hint}>The thing that happened.</p>
                </div>
                <div>
                  <label style={settingsLabel}>Shown as</label>
                  <input value={b.label} maxLength={80} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => patchBehaviour(i, { label: e.target.value })} />
                  <p className="bpm-t-help" style={hint}>The words a salesperson sees next to the points.</p>
                </div>
              </div>
              <div style={grid}>
                <Num label="Points" value={b.points} min={-100} max={100} onChange={(n) => patchBehaviour(i, { points: n ?? 0 })} help="How much it is worth each time. Use a minus number to take points away." />
                <Num label="Fades over (days)" value={b.half_life_days} min={0} max={365} onChange={(n) => patchBehaviour(i, { half_life_days: n && n > 0 ? n : undefined })} help="After this many days it is worth half. Leave empty if it should never fade." />
                <Num label="Counts up to (a week)" value={b.max_per_week} min={0} max={100} onChange={(n) => patchBehaviour(i, { max_per_week: n && n > 0 ? n : undefined })} help="Stops one busy afternoon from running up the score. Leave empty for no limit." />
              </div>
              <button type="button" style={dangerBtn} onClick={() => setRubric((r) => ({ ...r, behaviour: r.behaviour.filter((_, x) => x !== i) }))}>Remove this rule</button>
            </div>
          ))}
          <button type="button" style={linkBtn} onClick={() => setRubric((r) => ({ ...r, behaviour: [...r.behaviour, { event: events[0] ?? "email.clicked", label: eventLabel(events[0] ?? "email.clicked"), points: 5, half_life_days: 14 }] }))}>
            + Add a rule
          </button>
        </div>
      </SettingsSection>

      <SettingsSection id="mk-scoring-profile" title="Who they are" summary={`${rubric.profile.length} rules about the company and the person`}>
        <div style={card}>
          <p className="bpm-t-help" style={{ margin: 0 }}>These add points for the kind of company or person, however recently they were in touch. They never fade.</p>
          {rubric.profile.map((p, ri) => (
            <div key={ri} style={row}>
              <div style={grid}>
                <div>
                  <label style={settingsLabel}>Shown as</label>
                  <input value={p.label} maxLength={80} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => patchProfile(ri, { label: e.target.value })} />
                  <p className="bpm-t-help" style={hint}>The words a salesperson sees next to the points.</p>
                </div>
                <Num label="Points" value={p.points} min={-100} max={100} onChange={(n) => patchProfile(ri, { points: n ?? 0 })} help="Added once when the lead matches." />
                <div>
                  <label style={settingsLabel}>Matches when</label>
                  <select value={p.match} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => patchProfile(ri, { match: e.target.value === "any" ? "any" : "all" })}>
                    <option value="all">every line below is true</option>
                    <option value="any">any one line below is true</option>
                  </select>
                  <p className="bpm-t-help" style={hint}>Use “any one” to list several countries or roles.</p>
                </div>
              </div>
              {p.filters.map((f, fi) => {
                const def = fields.find((x) => x.key === f.field);
                return (
                  <div key={fi} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={f.field} style={{ ...settingsInput, flex: "1 1 160px", width: "auto" }} aria-label="About" onChange={(e) => {
                      const nd = fields.find((x) => x.key === e.target.value);
                      patchFilter(ri, fi, { field: e.target.value, operator: (nd?.operators[0] ?? "equals") as SegmentOperator, value: "" });
                    }}>
                      {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <select value={f.operator} style={{ ...settingsInput, flex: "0 1 130px", width: "auto" }} aria-label="Is" onChange={(e) => patchFilter(ri, fi, { operator: e.target.value as SegmentOperator })}>
                      {(def?.operators ?? [f.operator]).map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o] ?? o}</option>)}
                    </select>
                    {f.operator !== "is_true" && f.operator !== "is_false" && (
                      <input value={f.value} style={{ ...settingsInput, flex: "1 1 160px", width: "auto" }} aria-label="Value" onChange={(e) => patchFilter(ri, fi, { value: e.target.value })} />
                    )}
                    <button type="button" aria-label="Remove this line" style={dangerBtn} onClick={() => patchProfile(ri, { filters: p.filters.filter((_, x) => x !== fi) })}>×</button>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 14 }}>
                <button type="button" style={linkBtn} onClick={() => patchProfile(ri, { filters: [...p.filters, { id: `f${Date.now()}`, field: fields[0]?.key ?? "type", operator: (fields[0]?.operators[0] ?? "equals") as SegmentOperator, value: "" }] })}>+ Add a line</button>
                <button type="button" style={dangerBtn} onClick={() => setRubric((r) => ({ ...r, profile: r.profile.filter((_, x) => x !== ri) }))}>Remove this rule</button>
              </div>
            </div>
          ))}
          <button type="button" style={linkBtn} onClick={() => setRubric((r) => ({ ...r, profile: [...r.profile, { label: "New rule", match: "all", points: 5, filters: [{ id: `f${Date.now()}`, field: fields[0]?.key ?? "type", operator: (fields[0]?.operators[0] ?? "equals") as SegmentOperator, value: "" }] }] }))}>
            + Add a rule
          </button>
        </div>
      </SettingsSection>

      <SettingsSection id="mk-scoring-lines" title="Where the lines are" summary={`Engaged from ${rubric.thresholds.engaged}, ready for sales from ${rubric.thresholds.ready}`}>
        <div style={grid}>
          <Num label="Engaged from" value={rubric.thresholds.engaged} min={1} max={99} onChange={(n) => setRubric((r) => ({ ...r, thresholds: { ...r.thresholds, engaged: n ?? r.thresholds.engaged } }))} help="A lead at or above this score is showing real interest." />
          <Num label="Ready for sales from" value={rubric.thresholds.ready} min={2} max={100} onChange={(n) => setRubric((r) => ({ ...r, thresholds: { ...r.thresholds, ready: n ?? r.thresholds.ready } }))} help="At or above this score a salesperson should call. It must be higher than the line above." />
          <Num label="Look back (days)" value={rubric.window_days} min={7} max={365} onChange={(n) => setRubric((r) => ({ ...r, window_days: n ?? r.window_days }))} help="Anything older than this is ignored, whatever its points." />
        </div>
      </SettingsSection>

      <SettingsSection id="mk-scoring-try" title="Try it on a sample lead" summary="See the score and the reasons before you save" defaultOpen>
        <SamplePreview rubric={rubric} />
      </SettingsSection>
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
    <div>
      <label style={settingsLabel}>{label}</label>
      <input value={profile[key]} style={{ ...settingsInput, marginTop: 6 }} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} />
      <p className="bpm-t-help" style={hint}>{help}</p>
    </div>
  );

  return (
    <div style={card}>
      <p className="bpm-t-help" style={{ margin: 0 }}>Pretend a lead did these things and see what the rules above would make of it. Nothing is saved or sent.</p>
      <div style={grid}>
        {field("Account type", "type", "For example oem, direct or prospect.")}
        {field("Country", "country", "For example Saudi Arabia.")}
        {field("Their role", "contact_role", "For example Purchasing Manager.")}
        <div>
          <label style={settingsLabel}>Has a service contract</label>
          <div style={{ marginTop: 10 }}>
            <input type="checkbox" checked={profile.has_active_amc} aria-label="Has a service contract" onChange={(e) => setProfile((p) => ({ ...p, has_active_amc: e.target.checked }))} style={{ width: 16, height: 16, accentColor: c.accent }} />
          </div>
          <p className="bpm-t-help" style={hint}>An active annual maintenance contract.</p>
        </div>
      </div>
      {rubric.behaviour.filter((b) => b.points !== 0).map((b) => {
        const i = rubric.behaviour.indexOf(b);
        const s = counts[i] ?? { n: 0, days: 1 };
        return (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 220px", fontSize: 13 }}>{b.label}</span>
            <label style={{ ...settingsLabel, fontWeight: 400 }}>times <input type="number" min={0} max={50} value={s.n} style={{ ...settingsInput, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, n: Number(e.target.value) || 0 } }))} /></label>
            <label style={{ ...settingsLabel, fontWeight: 400 }}>days ago <input type="number" min={0} max={365} value={s.days} style={{ ...settingsInput, width: 72, marginLeft: 6 }} onChange={(e) => setCounts((x) => ({ ...x, [i]: { ...s, days: Number(e.target.value) || 0 } }))} /></label>
          </div>
        );
      })}
      <div role="status" aria-live="polite" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: c.ink }}>{result.score}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{result.label}</span>
        </div>
        {result.factors.length === 0 ? (
          <p className="bpm-t-help" style={hint}>No points yet. Add something above.</p>
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
