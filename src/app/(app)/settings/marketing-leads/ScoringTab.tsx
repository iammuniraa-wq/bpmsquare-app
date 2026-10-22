"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import RowTable from "@/components/settings/RowTable";
import SectionHead from "@/components/settings/SectionHead";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { c } from "@/lib/theme";
import { DEFAULT_RUBRIC, SCORE_LABEL, type BehaviourRule, type ProfileField, type ProfileRule, type ScoringRubric } from "@/lib/marketing/scoring";
import { SCORING_TIPS } from "@/lib/marketing/scoringTips";
import type { SegmentFilter, SegmentOperator } from "@/lib/marketingSegmentation";
import SamplePreview from "./SamplePreview";
import {
  COLLAPSED_ROWS, KIND_WORD, OPERATOR_LABEL, addRule, eventLabel, lineError, newFilter, pointsWord, removeRule, ruleRows,
  type RuleKind, type RuleRef,
} from "./scoringLogic";

// Settings, Marketing, Leads, Scoring: the thresholds in one line of three numbers, then every rule as one row; a row
// opens its panel. Labels, values and actions only; every explanation sits behind the "i" (bpmsquarecore 6b).

const inputH: React.CSSProperties = { minHeight: 44 };
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: c.accent, padding: "0 4px", minHeight: 44, display: "inline-flex", alignItems: "center", alignSelf: "flex-start" };

type Panel = { type: "rule"; ref: RuleRef } | { type: "try" } | null;

function Num({ value, onChange, min, max, label, info, error }: {
  value: number | undefined; onChange: (n: number | undefined) => void; min: number; max: number; label: string; info?: string; error?: string;
}) {
  return (
    <Field label={label} info={info} error={error} style={{ marginBottom: 0 }}>
      <Input
        type="number" inputMode="numeric" min={min} max={max} value={value ?? ""} invalid={!!error} style={inputH}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

export default function ScoringTab() {
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
        setRubric(json.rubric); setEvents(json.events ?? []); setFields(json.profile_fields ?? []);
        markSaved({ rubric: json.rubric });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (lineError(rubric)) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/marketing-scoring", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rubric }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setRubric(json.rubric); markSaved({ rubric: json.rubric }); setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;
  return (
    <ScoringView
      rubric={rubric} events={events} fields={fields} set={setRubric}
      header={<SettingsSave dirty={dirty && !lineError(rubric)} saving={saving} saved={saved} error={error} onSave={save} />}
    />
  );
}

/** The screen itself, with its data passed in, so a test can draw it without a server. */
export function ScoringView({ rubric, events, fields, set, header, openPanel, expanded = false }: {
  rubric: ScoringRubric; events: string[]; fields: ProfileField[]; set: (r: ScoringRubric) => void; header?: React.ReactNode;
  /** Tests open a panel, or the full list, without a click. */
  openPanel?: NonNullable<Panel>; expanded?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(openPanel ?? null);
  const [showAll, setShowAll] = useState(expanded);
  const rows = ruleRows(rubric);
  const shown = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  const err = lineError(rubric);

  const patchBehaviour = (i: number, p: Partial<BehaviourRule>) => set({ ...rubric, behaviour: rubric.behaviour.map((b, x) => (x === i ? { ...b, ...p } : b)) });
  const patchProfile = (i: number, p: Partial<ProfileRule>) => set({ ...rubric, profile: rubric.profile.map((b, x) => (x === i ? { ...b, ...p } : b)) });
  const patchFilter = (ri: number, fi: number, p: Partial<SegmentFilter>) =>
    patchProfile(ri, { filters: rubric.profile[ri].filters.map((f, x) => (x === fi ? { ...f, ...p } : f)) });
  const add = (kind: RuleKind) => {
    const next = addRule(rubric, kind, events, fields);
    set(next.rubric); setPanel({ type: "rule", ref: next.ref });
  };

  const behaviour = panel?.type === "rule" && panel.ref.kind === "behaviour" ? rubric.behaviour[panel.ref.index] : undefined;
  const profile = panel?.type === "rule" && panel.ref.kind === "profile" ? rubric.profile[panel.ref.index] : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 820 }}>
      {header}

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHead title="Where the lines are" info={SCORING_TIPS.lines} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "start" }}>
          <Num label="Warm from" info={SCORING_TIPS.warm} value={rubric.thresholds.engaged} min={1} max={99} onChange={(n) => set({ ...rubric, thresholds: { ...rubric.thresholds, engaged: n ?? rubric.thresholds.engaged } })} />
          <Num label="Hot from" info={SCORING_TIPS.hot} value={rubric.thresholds.ready} min={2} max={100} error={err} onChange={(n) => set({ ...rubric, thresholds: { ...rubric.thresholds, ready: n ?? rubric.thresholds.ready } })} />
          <Num label="Look back (days)" info={SCORING_TIPS.lookback} value={rubric.window_days} min={7} max={365} onChange={(n) => set({ ...rubric, window_days: n ?? rubric.window_days })} />
        </div>
        {!err && (
          <div className="bpm-t-help">{SCORE_LABEL.new} under {rubric.thresholds.engaged} · {SCORE_LABEL.engaged} {rubric.thresholds.engaged} to {rubric.thresholds.ready - 1} · {SCORE_LABEL.ready} from {rubric.thresholds.ready}</div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHead
          title="Rules" info={SCORING_TIPS.intro}
          action={(
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" onClick={() => setPanel({ type: "try" })}>Try on a sample lead</Button>
              <Button size="sm" onClick={() => add("behaviour")}>Add: what people do</Button>
              <Button size="sm" onClick={() => add("profile")}>Add: who they are</Button>
            </div>
          )}
        />
        <div className="bpm-t-help">Rules v{rubric.version}</div>
        <RowTable
          label="Scoring rules" columns={["Rule", "Kind", "Points"]}
          empty={<p style={{ margin: 0, padding: 16, fontSize: 13, color: c.muted }}>No rules yet. Add one with the buttons above.</p>}
          rows={shown.map((r) => ({
            id: `${r.ref.kind}-${r.ref.index}`, openLabel: `${r.label}: edit`, onOpen: () => setPanel({ type: "rule", ref: r.ref }),
            cells: [r.label, r.kind, <strong key="p" style={{ color: r.points < 0 ? "var(--err-ink)" : c.ink }}>{pointsWord(r.points)}</strong>],
          }))}
        />
        {rows.length > COLLAPSED_ROWS && (
          <Button variant="quiet" size="sm" style={{ alignSelf: "flex-start", minHeight: 44 }} aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer rules" : `Show all rules (${rows.length})`}
          </Button>
        )}
      </section>

      {panel?.type === "try" && (
        <SidePanel title="Try it on a sample lead" subtitle="Nothing is saved or sent" onClose={() => setPanel(null)} footer={<Button variant="primary" onClick={() => setPanel(null)}>Close</Button>}>
          <SamplePreview rubric={rubric} />
        </SidePanel>
      )}

      {panel?.type === "rule" && behaviour && (
        <SidePanel
          title={behaviour.label || eventLabel(behaviour.event)} subtitle={KIND_WORD.behaviour} onClose={() => setPanel(null)}
          footer={(
            <>
              <Button variant="danger" onClick={() => { set(removeRule(rubric, panel.ref)); setPanel(null); }}>Remove rule</Button>
              <Button variant="primary" onClick={() => setPanel(null)}>Done</Button>
            </>
          )}
        >
          <Field label="When someone…" style={{ marginBottom: 0 }}>
            <Select value={behaviour.event} style={inputH} onChange={(e) => patchBehaviour(panel.ref.index, { event: e.target.value, label: behaviour.label || eventLabel(e.target.value) })}>
              {events.map((ev) => <option key={ev} value={ev}>{eventLabel(ev)}</option>)}
            </Select>
          </Field>
          <Field label="Shown as" info={SCORING_TIPS.label} style={{ marginBottom: 0 }}>
            <Input value={behaviour.label} maxLength={80} style={inputH} onChange={(e) => patchBehaviour(panel.ref.index, { label: e.target.value })} />
          </Field>
          <Num label="Points" info={SCORING_TIPS.points} value={behaviour.points} min={-100} max={100} onChange={(n) => patchBehaviour(panel.ref.index, { points: n ?? 0 })} />
          <details>
            <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600 }}>More</summary>
            <div style={{ ...grid2, marginTop: 8 }}>
              <Num label="Fades over (days)" info={SCORING_TIPS.fades} value={behaviour.half_life_days} min={0} max={365} onChange={(n) => patchBehaviour(panel.ref.index, { half_life_days: n && n > 0 ? n : undefined })} />
              <Num label="Counts up to (a week)" info={SCORING_TIPS.cap} value={behaviour.max_per_week} min={0} max={100} onChange={(n) => patchBehaviour(panel.ref.index, { max_per_week: n && n > 0 ? n : undefined })} />
            </div>
          </details>
        </SidePanel>
      )}

      {panel?.type === "rule" && profile && (
        <SidePanel
          title={profile.label || "New rule"} subtitle={KIND_WORD.profile} onClose={() => setPanel(null)}
          footer={(
            <>
              <Button variant="danger" onClick={() => { set(removeRule(rubric, panel.ref)); setPanel(null); }}>Remove rule</Button>
              <Button variant="primary" onClick={() => setPanel(null)}>Done</Button>
            </>
          )}
        >
          <Field label="Shown as" info={SCORING_TIPS.label} style={{ marginBottom: 0 }}>
            <Input value={profile.label} maxLength={80} style={inputH} onChange={(e) => patchProfile(panel.ref.index, { label: e.target.value })} />
          </Field>
          <Num label="Points" info={SCORING_TIPS.profilePoints} value={profile.points} min={-100} max={100} onChange={(n) => patchProfile(panel.ref.index, { points: n ?? 0 })} />
          <Field label="Matches when" info={SCORING_TIPS.match} style={{ marginBottom: 0 }}>
            <Select value={profile.match} style={inputH} onChange={(e) => patchProfile(panel.ref.index, { match: e.target.value === "any" ? "any" : "all" })}>
              <option value="all">every line below is true</option>
              <option value="any">any one line below is true</option>
            </Select>
          </Field>
          {profile.filters.map((f, fi) => {
            const def = fields.find((x) => x.key === f.field);
            return (
              <div key={fi} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Select value={f.field} aria-label="About" style={{ ...inputH, flex: "1 1 160px", width: "auto" }} onChange={(e) => {
                  const nd = fields.find((x) => x.key === e.target.value);
                  patchFilter(panel.ref.index, fi, { field: e.target.value, operator: (nd?.operators[0] ?? "equals") as SegmentOperator, value: "" });
                }}>
                  {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </Select>
                <Select value={f.operator} aria-label="Is" style={{ ...inputH, flex: "0 1 130px", width: "auto" }} onChange={(e) => patchFilter(panel.ref.index, fi, { operator: e.target.value as SegmentOperator })}>
                  {(def?.operators ?? [f.operator]).map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o] ?? o}</option>)}
                </Select>
                {f.operator !== "is_true" && f.operator !== "is_false" && (
                  <Input value={f.value} aria-label="Value" style={{ ...inputH, flex: "1 1 160px", width: "auto" }} onChange={(e) => patchFilter(panel.ref.index, fi, { value: e.target.value })} />
                )}
                <button type="button" aria-label="Remove this line" style={{ ...linkBtn, color: "var(--err-ink)", minWidth: 44, justifyContent: "center" }} onClick={() => patchProfile(panel.ref.index, { filters: profile.filters.filter((_, x) => x !== fi) })}>×</button>
              </div>
            );
          })}
          <button type="button" style={linkBtn} onClick={() => patchProfile(panel.ref.index, { filters: [...profile.filters, newFilter(fields)] })}>+ Add a line</button>
        </SidePanel>
      )}
    </div>
  );
}
