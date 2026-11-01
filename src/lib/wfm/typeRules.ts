// Rules by employment type (docs/design/wfm-rules-by-type.md). Pure and client-safe: the Settings panel, the employee
// and supervisor screens and every server enforcement point ask these functions, so a rule means one thing everywhere.
//
// A type inherits the workspace. Only custom rows are stored (WfmConfig.type_rules); a missing type, a missing row or a
// day before the type's `effective_from` resolves to the workspace value exactly as before the feature existed.

import type { WfmConfig, WfmTypeRules } from "@/lib/constants";

export type RuleSource = "workspace" | "type";
export type TypeRuleId = "leave" | "week_off_days";

export type TypeRuleDef = {
  id: TypeRuleId;
  tab: "leave" | "days";
  label: string;
  kind: "leave" | "days";
  /** The slice that ships the row; the panel renders only rows up to the current slice. */
  since: 1 | 2 | 3;
};

export const TYPE_RULES_SLICE = 1;

export const TYPE_RULES: TypeRuleDef[] = [
  { id: "leave", tab: "leave", label: "Leave", kind: "leave", since: 1 },
  { id: "week_off_days", tab: "days", label: "Weekly off days", kind: "days", since: 1 },
];

export const visibleTypeRules = (): TypeRuleDef[] => TYPE_RULES.filter((r) => r.since <= TYPE_RULES_SLICE);

export const SAME_AS_EVERYONE = "Same as everyone";
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The entry that is in force for `date`. `date = null` returns the configured entry whatever its start date (used to
 * display what is saved); every enforcement point passes the day it is judging.
 */
function activeEntry(
  employmentType: string | null | undefined,
  config: Pick<WfmConfig, "type_rules">,
  date: string | null
): WfmTypeRules | null {
  if (!employmentType) return null;
  const entry = config.type_rules?.[employmentType];
  if (!entry || typeof entry !== "object") return null;
  if (date !== null && entry.effective_from && date < entry.effective_from) return null;
  return entry;
}

export type ResolvedTypeRules = {
  week_off_days: number[];
  source: { week_off_days: RuleSource };
};

export function rulesFor(
  employmentType: string | null | undefined,
  config: Pick<WfmConfig, "type_rules" | "week_off_days">,
  date: string | null
): ResolvedTypeRules {
  const entry = activeEntry(employmentType, config, date);
  if (entry && Array.isArray(entry.week_off_days)) {
    return { week_off_days: entry.week_off_days, source: { week_off_days: "type" } };
  }
  return { week_off_days: config.week_off_days, source: { week_off_days: "workspace" } };
}

export type LeaveTypeLike = { id: string; category: string; paid_days_per_month?: number | null };

export type ResolvedLeaveRule = {
  eligible: boolean;
  /** null = no allowance (every day keeps the type's category); 0 = every day unpaid. */
  paid_days_per_month: number | null;
  unpaid: boolean;
  source: RuleSource;
};

export function leaveRuleFor(
  employmentType: string | null | undefined,
  leaveType: LeaveTypeLike,
  config: Pick<WfmConfig, "type_rules">,
  date: string | null
): ResolvedLeaveRule {
  const own = leaveType.paid_days_per_month ?? null;
  const base: ResolvedLeaveRule = {
    eligible: true,
    paid_days_per_month: own,
    unpaid: leaveType.category === "unpaid" || own === 0,
    source: "workspace",
  };
  const rule = activeEntry(employmentType, config, date)?.leave?.[leaveType.id];
  if (!rule || typeof rule !== "object") return base;
  if (rule.mode === "off") return { eligible: false, paid_days_per_month: 0, unpaid: true, source: "type" };
  if (rule.mode === "unpaid") return { eligible: true, paid_days_per_month: 0, unpaid: true, source: "type" };
  if (rule.mode === "paid" && typeof rule.paid_days_per_month === "number" && rule.paid_days_per_month >= 0) {
    const n = rule.paid_days_per_month;
    return { eligible: true, paid_days_per_month: n, unpaid: leaveType.category === "unpaid" || n === 0, source: "type" };
  }
  return base;
}

// ── Wording: one helper for the employee and the supervisor (6b: one meaning per word) ───────────────────────────

export type LeavePayLabel = {
  /** The chip text, or null when nothing needs saying (an ordinary paid type). */
  text: string | null;
  /** Lower-case form for brackets in a dropdown. */
  short: string | null;
  tone: "quiet" | "amber" | "red";
};

export function leavePayLabel(rule: ResolvedLeaveRule, category: string, typeLabel: string): LeavePayLabel {
  if (!rule.eligible) return { text: `Not offered for ${typeLabel}`, short: "not offered", tone: "red" };
  if (category === "unpaid") return { text: "Unpaid, on approval", short: "unpaid, on approval", tone: "quiet" };
  if (rule.source === "type" && rule.unpaid) return { text: `Unpaid for ${typeLabel}`, short: "unpaid", tone: "amber" };
  if (rule.paid_days_per_month !== null && rule.paid_days_per_month > 0) {
    const n = rule.paid_days_per_month;
    return { text: `${n} paid a month`, short: `${n} paid a month`, tone: "quiet" };
  }
  if (rule.unpaid) return { text: "Unpaid", short: "unpaid", tone: "quiet" };
  return { text: null, short: null, tone: "quiet" };
}

// ── Display and diff (panel, Compare, confirm and the change log share them) ────────────────────────────────────

export function formatWeekOff(days: number[]): string {
  if (days.length === 0) return "None (every day is a working day)";
  return [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d] ?? String(d)).join(", ");
}

export type LeaveMode = NonNullable<WfmTypeRules["leave"]>[string];

export function formatLeaveMode(mode: LeaveMode | undefined): string {
  if (!mode) return SAME_AS_EVERYONE;
  if (mode.mode === "off") return "Not offered";
  if (mode.mode === "unpaid") return "Unpaid";
  return mode.paid_days_per_month === 0 ? "Unpaid" : `Paid, up to ${mode.paid_days_per_month} a month`;
}

/** A stored rule value as text; absent = the workspace value. */
export function formatRuleValue(ruleId: TypeRuleId, value: unknown): string {
  if (value === undefined || value === null) return SAME_AS_EVERYONE;
  if (ruleId === "week_off_days") return formatWeekOff(Array.isArray(value) ? (value as number[]) : []);
  return formatLeaveMode(value as LeaveMode);
}

/** How many rows a type has set to Custom (a leave row each, plus weekly off). */
export function customRuleCount(entry: WfmTypeRules | undefined | null): number {
  if (!entry) return 0;
  return Object.keys(entry.leave ?? {}).length + (Array.isArray(entry.week_off_days) ? 1 : 0);
}

export type TypeRuleChange = { field: string; before: string; after: string };

const sameDays = (a: number[], b: number[]) => [...a].sort().join(",") === [...b].sort().join(",");

/**
 * One line per rule that differs, e.g. `Trainee · Sick: Same as everyone -> Not offered`. `leaveTypes` names the leave
 * ids; an id with no name keeps its id so a line is never lost.
 */
export function diffTypeRules(
  typeLabel: string,
  before: WfmTypeRules | undefined | null,
  after: WfmTypeRules | undefined | null,
  leaveTypes: { id: string; name: string }[]
): TypeRuleChange[] {
  const out: TypeRuleChange[] = [];
  const nameOf = (id: string) => leaveTypes.find((l) => l.id === id)?.name ?? id;
  const ids = new Set([...Object.keys(before?.leave ?? {}), ...Object.keys(after?.leave ?? {})]);
  for (const id of ids) {
    const b = formatLeaveMode(before?.leave?.[id]);
    const a = formatLeaveMode(after?.leave?.[id]);
    if (b !== a) out.push({ field: `${typeLabel} · ${nameOf(id)}`, before: b, after: a });
  }
  const bw = Array.isArray(before?.week_off_days) ? before!.week_off_days! : null;
  const aw = Array.isArray(after?.week_off_days) ? after!.week_off_days! : null;
  if ((bw === null) !== (aw === null) || (bw && aw && !sameDays(bw, aw))) {
    out.push({
      field: `${typeLabel} · Weekly off days`,
      before: bw ? formatWeekOff(bw) : SAME_AS_EVERYONE,
      after: aw ? formatWeekOff(aw) : SAME_AS_EVERYONE,
    });
  }
  return out;
}

/** The stored entry for a draft: an entry with no custom row at all is dropped, and with it effective_from. */
export function cleanTypeEntry(entry: WfmTypeRules | undefined | null): WfmTypeRules | null {
  if (!entry) return null;
  const out: WfmTypeRules = {};
  const leave = entry.leave ?? {};
  if (Object.keys(leave).length > 0) out.leave = leave;
  if (Array.isArray(entry.week_off_days)) out.week_off_days = entry.week_off_days;
  if (!out.leave && !out.week_off_days) return null;
  if (entry.effective_from) out.effective_from = entry.effective_from;
  return out;
}

/** What a leave type does for everyone, as the panel and Compare show it as "Same as everyone: ...". */
export function workspaceLeaveText(t: { category: string; paid_days_per_month?: number | null }): string {
  if (t.category === "unpaid") return "Unpaid, on approval";
  const n = t.paid_days_per_month ?? null;
  if (n !== null) return n === 0 ? "Unpaid" : `Paid, up to ${n} a month`;
  return t.category === "half_day" ? "Half-day" : "Paid";
}

/** A canonical form of an entry (no start date, sorted keys) so a draft can be compared with what is saved. */
export function canonTypeEntry(entry: WfmTypeRules | undefined | null): string {
  const clean = cleanTypeEntry(entry);
  if (!clean) return "";
  const leave = Object.fromEntries(Object.entries(clean.leave ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify({ leave, week_off_days: clean.week_off_days ? [...clean.week_off_days].sort() : null });
}
