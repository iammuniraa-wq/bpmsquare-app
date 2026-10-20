import { MAX_EVENT_DEPTH } from "@/lib/events/catalog";
import type { Condition, JourneyRow } from "./types";

// Who enters a journey. Pure: the runner, the "who would enter" preview and the
// tests all use these same functions, so a preview can never promise something
// the runner would not do.

/** The part of a domain_event row enrolment looks at. */
export type EventLike = {
  id: string;
  name: string;
  object_type: string;
  object_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  campaign_id: string | null;
  source: string;
  depth: number;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export function readField(ev: Pick<EventLike, "object_type" | "payload">, field: string): unknown {
  if (field === "object_type") return ev.object_type;
  if (field.startsWith("payload.")) return (ev.payload ?? {})[field.slice(8)];
  return undefined;
}

export function matchesCondition(c: Condition, ev: Pick<EventLike, "object_type" | "payload">): boolean {
  if (!c) return true;
  const actual = readField(ev, c.field);
  if (actual === undefined || actual === null) return false;
  switch (c.op) {
    case "eq": return String(actual) === String(c.value);
    case "neq": return String(actual) !== String(c.value);
    case "contains": return String(actual).toLowerCase().includes(String(c.value).toLowerCase());
    case "gte": return Number(actual) >= Number(c.value);
    case "lte": return Number(actual) <= Number(c.value);
  }
}

export type EnrolDecision = { ok: true } | { ok: false; reason: "not_live" | "before_start" | "other_event" | "loop_guard" | "own_event" | "condition_not_met" };

/**
 * Should this event enrol a person in this journey?
 * `ownCampaignIds` are the quiet campaigns this journey's own send steps use: an
 * event they produce (email.sent, email.clicked ...) can never start the journey
 * that made it, on top of the depth limit.
 */
export function shouldEnrol(j: Pick<JourneyRow, "id" | "status" | "trigger_name" | "entry_from" | "definition">, ev: EventLike, ownCampaignIds: ReadonlySet<string> = new Set()): EnrolDecision {
  if (j.status !== "live") return { ok: false, reason: "not_live" };
  if (j.trigger_name !== ev.name) return { ok: false, reason: "other_event" };
  if (ev.depth > MAX_EVENT_DEPTH) return { ok: false, reason: "loop_guard" };
  if (ev.object_id === j.id || (ev.campaign_id && ownCampaignIds.has(ev.campaign_id))) return { ok: false, reason: "own_event" };
  if (j.entry_from && Date.parse(ev.created_at) < Date.parse(j.entry_from)) return { ok: false, reason: "before_start" };
  if (!matchesCondition(j.definition.trigger.condition, ev)) return { ok: false, reason: "condition_not_met" };
  return { ok: true };
}

/** One person per run, or one per company when the journey says so. Null when the event names nobody. */
export function subjectKey(oneGroupPerAccount: boolean, contactId: string | null, accountId: string | null): string | null {
  if (oneGroupPerAccount && accountId) return `a:${accountId}`;
  if (contactId) return `c:${contactId}`;
  if (accountId) return `a:${accountId}`;
  return null;
}

/** The references and amounts from the event that later steps need for their words. No names, no addresses. */
export function triggerSummary(ev: Pick<EventLike, "payload" | "object_type" | "object_id">): Record<string, unknown> {
  const p = ev.payload ?? {};
  const out: Record<string, unknown> = { object_type: ev.object_type, object_id: ev.object_id };
  for (const k of ["ref", "total", "stage", "outcome", "amount"]) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
  return out;
}
