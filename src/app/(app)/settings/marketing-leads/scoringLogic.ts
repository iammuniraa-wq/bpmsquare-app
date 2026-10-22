import type { BehaviourRule, ProfileField, ProfileRule, ScoringRubric } from "@/lib/marketing/scoring";
import type { SegmentFilter, SegmentOperator } from "@/lib/marketingSegmentation";

// What the Scoring tab decides before it draws anything. Pure, so the tests read it without a browser.

export const EVENT_LABEL: Record<string, string> = {
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
export const eventLabel = (name: string): string => EVENT_LABEL[name] ?? name;

export const OPERATOR_LABEL: Record<string, string> = { equals: "is", contains: "contains", gt: "is more than", lt: "is less than", is_true: "is yes", not_equals: "is not" };

export type RuleKind = "behaviour" | "profile";
export type RuleRef = { kind: RuleKind; index: number };
export const KIND_WORD: Record<RuleKind, string> = { behaviour: "What people do", profile: "Who they are" };

/** Rows shown before "Show all": enough to see the shape, few enough for a phone. */
export const COLLAPSED_ROWS = 6;

export type RuleRow = { ref: RuleRef; label: string; kind: string; points: number };

/** Every rule as one row: what people do first, then who they are, in the order the rubric holds them. */
export function ruleRows(rubric: ScoringRubric): RuleRow[] {
  return [
    ...rubric.behaviour.map((b, index): RuleRow => ({ ref: { kind: "behaviour", index }, label: b.label || eventLabel(b.event), kind: KIND_WORD.behaviour, points: b.points })),
    ...rubric.profile.map((p, index): RuleRow => ({ ref: { kind: "profile", index }, label: p.label, kind: KIND_WORD.profile, points: p.points })),
  ];
}

export const pointsWord = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** The server would quietly put both lines back to their defaults, so the screen says so before it can happen. */
export const lineError = (rubric: ScoringRubric): string => (rubric.thresholds.ready <= rubric.thresholds.engaged ? "Must be higher than Warm from." : "");

const firstFilter = (fields: ProfileField[]): SegmentFilter => ({
  id: `f${Date.now()}`, field: fields[0]?.key ?? "type", operator: (fields[0]?.operators[0] ?? "equals") as SegmentOperator, value: "",
});
export const newFilter = firstFilter;

export const newBehaviour = (events: string[]): BehaviourRule => {
  const event = events[0] ?? "email.clicked";
  return { event, label: eventLabel(event), points: 5, half_life_days: 14 };
};
export const newProfile = (fields: ProfileField[]): ProfileRule => ({ label: "New rule", match: "all", points: 5, filters: [firstFilter(fields)] });

export function addRule(rubric: ScoringRubric, kind: RuleKind, events: string[], fields: ProfileField[]): { rubric: ScoringRubric; ref: RuleRef } {
  return kind === "behaviour"
    ? { rubric: { ...rubric, behaviour: [...rubric.behaviour, newBehaviour(events)] }, ref: { kind, index: rubric.behaviour.length } }
    : { rubric: { ...rubric, profile: [...rubric.profile, newProfile(fields)] }, ref: { kind, index: rubric.profile.length } };
}

export function removeRule(rubric: ScoringRubric, ref: RuleRef): ScoringRubric {
  return ref.kind === "behaviour"
    ? { ...rubric, behaviour: rubric.behaviour.filter((_, i) => i !== ref.index) }
    : { ...rubric, profile: rubric.profile.filter((_, i) => i !== ref.index) };
}
