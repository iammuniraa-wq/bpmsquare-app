"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES, type WfmConfig, type WfmTypeRules } from "@/lib/constants";
import {
  canonTypeEntry, cleanTypeEntry, customRuleCount, diffTypeRules, formatWeekOff, formatLeaveMode, SAME_AS_EVERYONE, workspaceLeaveText,
  DAY_NAMES, type LeaveMode,
} from "@/lib/wfm/typeRules";
import { call, messageOf } from "./api";
import { typeRulesPayload } from "./logic";
import { TYPE_RULE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

export type RuleLeaveType = { id: string; name: string; category: string; active: boolean; paid_days_per_month?: number | null };

const TABS = ["leave", "days"] as const;
type PanelTab = (typeof TABS)[number];
const TAB_LABEL: Record<PanelTab, string> = { leave: "Leave", days: "Days" };

/**
 * The rules of one employment type (docs/design/wfm-rules-by-type.md, 4.2): a short list of Same as everyone / Custom
 * rows in two tabs. It saves on its own and sends the rules map only. Rules start on the day they are first applied
 * and never reach back into earlier days; later edits keep that start date.
 */
export default function TypeRulesPanel({
  type, isNew, canRemove, saved, allRules, weekOffDays, leaveTypes, typeOptions, people, pending, holidaysFor,
  onLabel, onCode, onRemove, onClose, onApplied,
}: {
  type: { code: string; label: string };
  /** Not stored yet: the name and code can still be edited, and rules wait for the first Save. */
  isNew: boolean;
  canRemove: boolean;
  saved: WfmTypeRules | undefined;
  allRules: Record<string, WfmTypeRules>;
  weekOffDays: number[];
  leaveTypes: readonly RuleLeaveType[];
  typeOptions: readonly { code: string; label: string }[];
  people: number;
  pending: number;
  holidaysFor: number;
  onLabel: (label: string) => void;
  onCode: (code: string) => void;
  onRemove: () => void;
  onClose: () => void;
  onApplied: (next: Record<string, WfmTypeRules>) => void;
}) {
  const { toast } = useFeel();
  const [tab, setTab] = useUrlTab(TABS, "trule");
  const [draft, setDraft] = useState<WfmTypeRules>(() => ({ leave: { ...(saved?.leave ?? {}) }, week_off_days: saved?.week_off_days }));
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = canonTypeEntry(draft) !== canonTypeEntry(saved);
  const customNow = customRuleCount(cleanTypeEntry(draft));
  const active = leaveTypes.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name));
  const hasUnpaidType = active.some((t) => t.category === "unpaid");
  const leaveCount = Object.keys(draft.leave ?? {}).length;
  const tabs = [
    { id: "leave", label: TAB_LABEL.leave, count: leaveCount },
    { id: "days", label: TAB_LABEL.days, count: Array.isArray(draft.week_off_days) ? 1 : 0 },
  ];

  const setLeave = (id: string, mode: LeaveMode | null) =>
    setDraft((d) => {
      const leave = { ...(d.leave ?? {}) };
      if (mode) leave[id] = mode; else delete leave[id];
      return { ...d, leave };
    });
  const toggleDay = (day: number) =>
    setDraft((d) => {
      const cur = d.week_off_days ?? [];
      return { ...d, week_off_days: cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day].sort() };
    });

  const changes = useMemo(
    () => diffTypeRules(type.label, saved, cleanTypeEntry(draft), leaveTypes.map((t) => ({ id: t.id, name: t.name }))),
    [type.label, saved, draft, leaveTypes]
  );
  const startsOn = saved?.effective_from ?? new Date().toLocaleDateString("en-CA");
  const peopleText = `${people} ${people === 1 ? "person" : "people"}`;

  async function apply() {
    setSaving(true); setError(null);
    try {
      const next = { ...allRules };
      const clean = cleanTypeEntry(draft);
      if (clean) next[type.code] = clean; else delete next[type.code];
      const res = await call<WfmConfig>("/api/settings/workforce", "PUT", typeRulesPayload(next));
      toast({ text: `Applied to ${peopleText}. Logged in Change history.`, tone: "success" });
      onApplied(res.type_rules ?? {});
      onClose();
    } catch (e) {
      setError(messageOf(e)); setSaving(false); setReviewing(false);
    }
  }

  const copyFrom = (code: string) => {
    const src = allRules[code];
    if (!src) return;
    setDraft({ leave: { ...(src.leave ?? {}) }, week_off_days: src.week_off_days ? [...src.week_off_days] : undefined });
  };

  const footer = reviewing ? (
    <div className={s.panelFoot}>
      <Button onClick={() => setReviewing(false)} disabled={saving}>Back</Button>
      <Button variant="primary" loading={saving} onClick={() => void apply()}>Apply to {peopleText}</Button>
    </div>
  ) : (
    <div className={s.panelFoot}>
      {canRemove && <Button variant="danger" onClick={onRemove}>Remove type</Button>}
      {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
      {!isNew && <span className={s.panelState}>{dirty ? "Unsaved changes" : "No changes"}</span>}
      <Button onClick={onClose}>Close</Button>
      {!isNew && <Button variant="primary" disabled={!dirty} onClick={() => setReviewing(true)}>Apply to {peopleText}</Button>}
    </div>
  );

  return (
    <SidePanel
      title={`Rules for ${type.label || "new type"}`}
      subtitle={isNew ? "Not saved yet" : `${peopleText} · ${pending} pending leave ${pending === 1 ? "request" : "requests"} · ${customNow} custom ${customNow === 1 ? "rule" : "rules"}`}
      onClose={onClose}
      footer={footer}
    >
      {reviewing ? (
        <div className={s.stack}>
          <div className="bpm-t-label">Review before applying</div>
          {changes.length === 0 ? <div className={s.muted}>Nothing changes.</div> : (
            <ul className={s.review}>
              {changes.map((c) => (
                <li key={c.field}>
                  <strong>{c.field}</strong>
                  <span><span className={s.reviewArrow}>{c.before} &rarr; </span>{c.after}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={s.small}>
            Applies to {peopleText} from {saved?.effective_from ? startsOn : `today (${startsOn})`}. Days before that are not changed.
            Approved leave stays approved.
          </div>
        </div>
      ) : (
        <div className={s.stack}>
          <div className={s.fields}>
            <Field label="Name"><Input value={type.label} onChange={(e) => onLabel(e.target.value)} placeholder="Intern" /></Field>
            {isNew && <Field label="Code"><Input value={type.code} maxLength={40} placeholder="code" onChange={(e) => onCode(e.target.value)} /></Field>}
          </div>

          {isNew ? (
            <div className={s.small}>Save the settings first, then set rules for this type.</div>
          ) : (
            <>
              {saved?.effective_from && (
                <div className={`${s.ruleVal}`}>
                  Applies from {saved.effective_from}
                  <InfoTip label="Applies from">{T.effectiveFrom}</InfoTip>
                </div>
              )}
              <Tabs label={`Rules for ${type.label}`} tabs={tabs} value={tab} onChange={setTab} />

              {tab === "leave" && (
                <div>
                  {active.length === 0 && <div className={s.small}>No leave types yet. Add them under Leave.</div>}
                  {active.map((t) => {
                    if (t.category === "unpaid") {
                      return (
                        <div key={t.id} className={s.rule}>
                          <div className={s.ruleTop}>
                            <span className={s.ruleName}>{t.name}<InfoTip label={t.name}>{T.leaveUnpaidType}</InfoTip></span>
                            <span className={s.chip}>Unpaid, on approval</span>
                          </div>
                        </div>
                      );
                    }
                    const m = draft.leave?.[t.id];
                    const value = !m ? "same" : m.mode;
                    return (
                      <div key={t.id} className={s.rule}>
                        <div className={s.ruleTop}>
                          <span className={s.ruleName}>{t.name}<InfoTip label={t.name}>{T.leaveRow}</InfoTip></span>
                          <span className={s.ruleCtl}>
                            <Select aria-label={`${t.name} for ${type.label}`} value={value}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "same") setLeave(t.id, null);
                                else if (v === "paid") setLeave(t.id, { mode: "paid", paid_days_per_month: 1 });
                                else setLeave(t.id, { mode: v as "off" | "unpaid" });
                              }}>
                              <option value="same">{SAME_AS_EVERYONE}</option>
                              <option value="unpaid">Unpaid</option>
                              <option value="paid">Paid, up to N a month</option>
                              <option value="off">Not offered</option>
                            </Select>
                            {m?.mode === "paid" && (
                              <Input className={s.ruleNum} type="number" min={0} max={31} step="0.5" aria-label={`Paid days a month for ${t.name}`} value={m.paid_days_per_month}
                                onChange={(e) => setLeave(t.id, { mode: "paid", paid_days_per_month: Math.max(0, Math.min(31, Number(e.target.value) || 0)) })} />
                            )}
                          </span>
                        </div>
                        <div className={s.ruleVal}>
                          <span className={m ? s.ruleValCustom : undefined}>{m ? `Custom: ${formatLeaveMode(m)}` : `${SAME_AS_EVERYONE}: ${workspaceLeaveText(t)}`}</span>
                          {m && <button type="button" className={s.linkBtn} onClick={() => setLeave(t.id, null)}>Reset</button>}
                        </div>
                      </div>
                    );
                  })}
                  {!hasUnpaidType && active.length > 0 && (
                    <div className={s.small}>Add an unpaid leave type under Leave to allow leave on approval.</div>
                  )}
                </div>
              )}

              {tab === "days" && (
                <div>
                  <div className={s.rule}>
                    <div className={s.ruleTop}>
                      <span className={s.ruleName}>Weekly off days<InfoTip label="Weekly off days">{T.weekOff}</InfoTip></span>
                      <Select aria-label={`Weekly off days for ${type.label}`} value={Array.isArray(draft.week_off_days) ? "custom" : "same"}
                        onChange={(e) => setDraft((d) => ({ ...d, week_off_days: e.target.value === "custom" ? [...weekOffDays] : undefined }))}>
                        <option value="same">{SAME_AS_EVERYONE}</option>
                        <option value="custom">Custom</option>
                      </Select>
                    </div>
                    {Array.isArray(draft.week_off_days) && (
                      <div className={s.days} role="group" aria-label="Weekly off days">
                        {DAY_NAMES.map((d, i) => (
                          <button key={d} type="button" className={s.pick} aria-pressed={draft.week_off_days!.includes(i)} onClick={() => toggleDay(i)}>{d}</button>
                        ))}
                      </div>
                    )}
                    <div className={s.ruleVal}>
                      <span className={Array.isArray(draft.week_off_days) ? s.ruleValCustom : undefined}>
                        {Array.isArray(draft.week_off_days) ? `Custom: ${formatWeekOff(draft.week_off_days)}` : `${SAME_AS_EVERYONE}: ${formatWeekOff(weekOffDays)}`}
                      </span>
                      {Array.isArray(draft.week_off_days) && (
                        <button type="button" className={s.linkBtn} onClick={() => setDraft((d) => ({ ...d, week_off_days: undefined }))}>Reset</button>
                      )}
                    </div>
                  </div>
                  <div className={s.rule}>
                    <div className={s.ruleVal}>
                      <span>Holidays only for {type.label}: {holidaysFor} this year</span>
                      <InfoTip label="Holidays for this type">{T.holidaysFor}</InfoTip>
                      <Link className={s.linkBtn} href={`${ROUTES.wfmLeave}?tab=holidays`}>Open</Link>
                    </div>
                  </div>
                </div>
              )}

              <div className={s.panelTools}>
                <span className="bpm-label-row">
                  <Select aria-label="Copy rules from" value="" onChange={(e) => { if (e.target.value) copyFrom(e.target.value); }}>
                    <option value="">Copy rules from...</option>
                    {typeOptions.filter((o) => o.code !== type.code && allRules[o.code]).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                  <InfoTip label="Copy rules from">{T.copyFrom}</InfoTip>
                </span>
                <span className="bpm-label-row">
                  <button type="button" className={s.linkBtn} disabled={customNow === 0} onClick={() => setDraft({ leave: {}, week_off_days: undefined })}>Reset all to everyone</button>
                  <InfoTip label="Reset all">{T.resetAll}</InfoTip>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </SidePanel>
  );
}
