"use client";

import { useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import type { WfmTypeRules } from "@/lib/constants";
import { formatLeaveMode, formatWeekOff, workspaceLeaveText } from "@/lib/wfm/typeRules";
import type { RuleLeaveType } from "./TypeRulesPanel";
import { TYPE_RULE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

/**
 * Types as columns, rules as rows (docs/design/wfm-rules-by-type.md, 4.3). A dot follows the workspace, a filled cell is
 * custom; a cell opens that type's panel on the matching tab. On a phone one type shows at a time, picked from a chip row.
 */
export default function TypeRulesCompare({ types, savedCodes, rules, weekOffDays, leaveTypes, onOpen }: {
  types: readonly { code: string; label: string }[];
  savedCodes: readonly string[];
  rules: Record<string, WfmTypeRules>;
  weekOffDays: number[];
  leaveTypes: readonly RuleLeaveType[];
  onOpen: (index: number, tab: "leave" | "days") => void;
}) {
  const [picked, setPicked] = useState(0);
  const columns = types.map((t, i) => ({ ...t, i })).filter((t) => savedCodes.includes(t.code));
  const active = leaveTypes.filter((t) => t.active && t.category !== "unpaid").sort((a, b) => a.name.localeCompare(b.name));
  const shown = columns[Math.min(picked, Math.max(0, columns.length - 1))]?.code;

  const cell = (col: (typeof columns)[number], custom: string | null, tab: "leave" | "days") => (
    <td key={col.code} className={s.cmpType} data-on={col.code === shown}>
      <button type="button" className={s.cmpCell} data-custom={custom !== null} aria-label={`${col.label}: ${custom ?? "Same as everyone"}. Open rules`} onClick={() => onOpen(col.i, tab)}>
        {custom ?? "·"}
      </button>
    </td>
  );

  return (
    <div className={s.cmpWrap}>
      <div className={s.cmpPicker} role="group" aria-label="Employment type">
        {columns.map((col, k) => (
          <button key={col.code} type="button" className={s.pick} aria-pressed={col.code === shown} onClick={() => setPicked(k)}>{col.label}</button>
        ))}
      </div>
      <table className={s.cmp} aria-label="Rules by employment type">
        <thead>
          <tr>
            <th scope="col">
              <span className="bpm-label-row">Rule<InfoTip label="Compare">{T.compare}</InfoTip></span>
            </th>
            <th scope="col">Everyone</th>
            {columns.map((col) => <th key={col.code} scope="col" className={s.cmpType} data-on={col.code === shown}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className={s.cmpGroup}><td colSpan={2 + columns.length}>Leave</td></tr>
          {active.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{workspaceLeaveText(t)}</td>
              {columns.map((col) => cell(col, rules[col.code]?.leave?.[t.id] ? formatLeaveMode(rules[col.code]!.leave![t.id]) : null, "leave"))}
            </tr>
          ))}
          <tr className={s.cmpGroup}><td colSpan={2 + columns.length}>Days</td></tr>
          <tr>
            <td>Weekly off days</td>
            <td>{formatWeekOff(weekOffDays)}</td>
            {columns.map((col) => {
              const w = rules[col.code]?.week_off_days;
              return cell(col, Array.isArray(w) ? formatWeekOff(w).replace(" (every day is a working day)", "") : null, "days");
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
