"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import type { WfmConfig, WfmTypeRules } from "@/lib/constants";
import { customRuleCount } from "@/lib/wfm/typeRules";
import type { WfmShift } from "@/lib/wfm/types";
import { cleanCode, hhmm, slugCode } from "./logic";
import { More, SwitchRow } from "./parts";
import { WORKFORCE_TIPS as T } from "./tips";
import TypeRulesPanel, { type RuleLeaveType } from "./TypeRulesPanel";
import TypeRulesCompare from "./TypeRulesCompare";
import s from "./workforce.module.css";

/** What the Rules tab shows next to each employment type; all optional, a screen without them still works. */
export type TypeFacts = {
  leaveTypes: RuleLeaveType[];
  people: Record<string, number>;
  pending: Record<string, number>;
  holidays: Record<string, number>;
};
const NO_FACTS: TypeFacts = { leaveTypes: [], people: {}, pending: {}, holidays: {} };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Colombo",
  "Asia/Kathmandu", "Asia/Singapore", "Europe/London", "America/New_York", "UTC",
];

/**
 * How a day is counted and which punches are allowed: the everyday choices, with sign-in, face checks and alternate
 * Saturdays behind one More. Employment types sit in the main area (owner request 2026-11-01: adding Intern or Trainee
 * must be obvious, not hidden). Replaces Attendance rules and Punching & verification, and the employment types that
 * sat on Employment & billing.
 */
export default function RulesTab({ cfg, savedCodes, shifts, onChange, facts = NO_FACTS, onRulesApplied }: {
  cfg: WfmConfig;
  /** Codes already stored: a type that exists keeps its code when renamed, a new one gets its code from its label. */
  savedCodes: readonly string[];
  shifts: readonly WfmShift[];
  onChange: (patch: Partial<WfmConfig>) => void;
  facts?: TypeFacts;
  /** The panel saved the rules map on its own; the screen's saved copy and draft take the stored one. */
  onRulesApplied?: (rules: Record<string, WfmTypeRules>) => void;
}) {
  const [view, setView] = useState<"list" | "compare">("list");
  const [openType, setOpenType] = useState<number | null>(null);
  const rules = cfg.type_rules ?? {};
  const toggleDay = (d: number) =>
    onChange({ week_off_days: cfg.week_off_days.includes(d) ? cfg.week_off_days.filter((x) => x !== d) : [...cfg.week_off_days, d].sort() });
  const punch = (key: keyof WfmConfig["punch_types"], v: boolean) => onChange({ punch_types: { ...cfg.punch_types, [key]: v } });
  const sat = cfg.saturday_rule ?? { enabled: false, short_shift_id: null };

  const setTypeLabel = (i: number, label: string) =>
    onChange({
      employment_types: cfg.employment_types.map((t, j) => {
        if (j !== i) return t;
        if (savedCodes.includes(t.code)) return { ...t, label };
        const others = cfg.employment_types.filter((_, k) => k !== i).map((x) => x.code);
        // A code the person typed stays; one made from the label follows the label.
        const made = t.code === "" || t.code === slugCode(t.label, others);
        return { code: made ? slugCode(label, others) : t.code, label };
      }),
    });
  const setTypeCode = (i: number, raw: string) =>
    onChange({ employment_types: cfg.employment_types.map((t, j) => (j === i && !savedCodes.includes(t.code) ? { ...t, code: cleanCode(raw) } : t)) });

  return (
    <div className={s.card}>
      <div className={s.grid}>
        <Field label="Timezone" info={T.timezone}>
          <Select value={cfg.timezone} onChange={(e) => onChange({ timezone: e.target.value })}>
            {!TIMEZONES.includes(cfg.timezone) && <option value={cfg.timezone}>{cfg.timezone}</option>}
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
        </Field>
        <Field label="Late marks per half-day" info={T.lateMarks}>
          <Input type="number" min={1} value={cfg.late_marks_per_half_day} onChange={(e) => onChange({ late_marks_per_half_day: Math.max(1, parseInt(e.target.value) || 1) })} />
        </Field>

        <Field label="Weekly off days" info={T.weekOff} htmlFor="wf-weekoff" style={{ gridColumn: "1 / -1" }}>
          <div className={s.days} id="wf-weekoff" role="group" aria-label="Weekly off days">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" className={s.pick} aria-pressed={cfg.week_off_days.includes(i)} onClick={() => toggleDay(i)}>{d}</button>
            ))}
          </div>
        </Field>

        <div className={s.full}>
          <SwitchRow label="Take breaks off worked hours" info={T.deductBreaks} checked={cfg.deduct_breaks} onChange={(deduct_breaks) => onChange({ deduct_breaks })} />
          <SwitchRow label="Report by location" info={T.payrollByLocation} checked={cfg.payroll_by_location === true} onChange={(payroll_by_location) => onChange({ payroll_by_location })} />
        </div>

        <Field label="Extra punch types" info={T.punchTypes} htmlFor="wf-punch" style={{ gridColumn: "1 / -1" }}>
          <div id="wf-punch" role="group" aria-label="Extra punch types" style={{ display: "flex", flexWrap: "wrap", gap: "2px 20px" }}>
            <CheckOpt label="Overtime" info={T.overtime} checked={cfg.punch_types.ot} onChange={(v) => punch("ot", v)} />
            <CheckOpt label="Work from home" info={T.workFromHome} checked={cfg.punch_types.mobile_work} onChange={(v) => punch("mobile_work", v)} />
            <CheckOpt label="Site visit" info={T.siteVisit} checked={cfg.punch_types.business_trip} onChange={(v) => punch("business_trip", v)} />
          </div>
        </Field>

        <Field label="Selfie with a punch" info={T.selfie}>
          <Select value={cfg.selfie_mode} onChange={(e) => onChange({ selfie_mode: e.target.value as WfmConfig["selfie_mode"] })}>
            <option value="shift">Check in, check out, breaks, trips</option>
            <option value="all">Every punch</option>
            <option value="off">Never</option>
          </Select>
        </Field>
        {cfg.punch_types.ot && (
          <Field label="Overtime rate per hour" info={T.otRate}>
            <Input type="number" min={0} step="0.01" value={cfg.ot_rate_per_hour} onChange={(e) => onChange({ ot_rate_per_hour: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
        )}
        {cfg.punch_types.ot && (
          <Field label="Minimum overtime per day (minutes)" info={T.otMinimum}>
            <Input type="number" min={0} step="1" value={cfg.ot_min_minutes ?? 0} onChange={(e) => onChange({ ot_min_minutes: Math.max(0, parseInt(e.target.value) || 0) })} />
          </Field>
        )}

        <Field label="Employment types" info={T.employmentTypes} htmlFor="wf-emp-types" style={{ gridColumn: "1 / -1" }}>
          <div className={s.stack} id="wf-emp-types">
            <ListBar>
              <div className={s.seg} role="radiogroup" aria-label="View">
                <button type="button" role="radio" aria-checked={view === "list"} onClick={() => setView("list")}>List</button>
                <button type="button" role="radio" aria-checked={view === "compare"} onClick={() => setView("compare")}>Compare</button>
              </div>
              <Button size="sm" onClick={() => { onChange({ employment_types: [...cfg.employment_types, { code: "", label: "" }] }); setOpenType(cfg.employment_types.length); }}>+ Add type</Button>
            </ListBar>
            {view === "list" ? (
              <SettingsList
                label="Employment types"
                headers={["People", "Rules"]}
                rows={cfg.employment_types.map((t, i) => {
                  const isSaved = savedCodes.includes(t.code);
                  const n = customRuleCount(rules[t.code]);
                  return {
                    key: String(i),
                    label: t.label || "new type",
                    title: <span className={s.typeName}>{t.label || "New type"}{t.code && <span className={s.typeCode}>{t.code}</span>}</span>,
                    cells: [
                      isSaved ? (facts.people[t.code] ?? "") : "",
                      isSaved ? <span key="r" className={`${s.chip} ${n > 0 ? s.chipCustom : ""}`}>{n > 0 ? `${n} custom` : "Same as everyone"}</span> : <span key="r" className={s.chip}>Save to set rules</span>,
                    ],
                  };
                })}
                onOpen={(k) => setOpenType(Number(k))}
              />
            ) : (
              <TypeRulesCompare
                types={cfg.employment_types}
                savedCodes={savedCodes}
                rules={rules}
                weekOffDays={cfg.week_off_days}
                leaveTypes={facts.leaveTypes}
                onOpen={(i) => setOpenType(i)}
              />
            )}
          </div>
        </Field>
      </div>

      <More>
        <div className={s.fields}>
          <Field label="Employee self-service" info={T.selfService}>
            <Select value={cfg.employee_self_service === false ? "off" : "on"} onChange={(e) => onChange({ employee_self_service: e.target.value === "on" })}>
              <option value="on">On</option>
              <option value="off">Off, tablet only</option>
            </Select>
          </Field>
          <Field label="Sign in with" info={T.loginMode}>
            <Select value={cfg.login_mode === "code" ? "code" : "email"} onChange={(e) => onChange({ login_mode: e.target.value as WfmConfig["login_mode"] })}>
              <option value="email">Email address</option>
              <option value="code">User ID</option>
            </Select>
          </Field>
          <Field label="After sign-in, open" info={T.landing}>
            <Select value={cfg.home_landing === "my_workforce" ? "my_workforce" : "dashboard"} onChange={(e) => onChange({ home_landing: e.target.value as WfmConfig["home_landing"] })}>
              <option value="dashboard">Dashboard</option>
              <option value="my_workforce">My Workforce</option>
            </Select>
          </Field>
          <Field label="Face punch" info={T.facePunch}>
            <Select value={cfg.face_punch} onChange={(e) => onChange({ face_punch: e.target.value as WfmConfig["face_punch"] })}>
              <option value="off">Off</option>
              <option value="kiosk">Door tablet</option>
            </Select>
          </Field>
          <Field label="Face sign-in" info={T.faceLogin}>
            <Select value={cfg.face_login ? "on" : "off"} onChange={(e) => onChange({ face_login: e.target.value === "on" })}>
              <option value="off">Off</option>
              <option value="on">On</option>
            </Select>
          </Field>
          <Field label="Check selfies against the face" info={T.faceVerify}>
            <Select value={cfg.face_verification_mode} onChange={(e) => onChange({ face_verification_mode: e.target.value as WfmConfig["face_verification_mode"] })}>
              <option value="off">Off</option>
              <option value="flag_only">Flag a mismatch</option>
            </Select>
          </Field>
          <Field label="Keep selfies for (days)" info={T.selfieRetention}>
            <Input type="number" min={1} value={cfg.selfie_retention_days} onChange={(e) => onChange({ selfie_retention_days: Math.max(1, parseInt(e.target.value) || 1) })} />
          </Field>
        </div>
        <SwitchRow label="Passkey sign-in" info={T.passkey} checked={cfg.passkey_login} onChange={(passkey_login) => onChange({ passkey_login })} />
        <SwitchRow
          label="Alternate Saturdays"
          info={T.saturday}
          checked={sat.enabled === true}
          onChange={(enabled) => onChange({ saturday_rule: { enabled, short_shift_id: sat.short_shift_id ?? null } })}
        />
        {sat.enabled && (
          <Field label="Short-day shift" info={T.saturdayShift}>
            <Select value={sat.short_shift_id ?? ""} onChange={(e) => onChange({ saturday_rule: { enabled: true, short_shift_id: e.target.value || null } })}>
              <option value="">Choose a shift</option>
              {shifts.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} ({hhmm(x.start_time)} to {hhmm(x.end_time)})</option>)}
            </Select>
          </Field>
        )}
      </More>

      {openType !== null && cfg.employment_types[openType] && (() => {
        const t = cfg.employment_types[openType];
        return (
          <TypeRulesPanel
            key={openType}
            type={t}
            isNew={!savedCodes.includes(t.code)}
            canRemove={cfg.employment_types.length > 1}
            saved={rules[t.code]}
            allRules={rules}
            weekOffDays={cfg.week_off_days}
            leaveTypes={facts.leaveTypes}
            typeOptions={cfg.employment_types.filter((x) => savedCodes.includes(x.code))}
            people={facts.people[t.code] ?? 0}
            pending={facts.pending[t.code] ?? 0}
            holidaysFor={facts.holidays[t.code] ?? 0}
            onLabel={(label) => setTypeLabel(openType, label)}
            onCode={(raw) => setTypeCode(openType, raw)}
            onRemove={() => { onChange({ employment_types: cfg.employment_types.filter((_, j) => j !== openType) }); setOpenType(null); }}
            onClose={() => setOpenType(null)}
            onApplied={(next) => onRulesApplied?.(next)}
          />
        );
      })()}
    </div>
  );
}
