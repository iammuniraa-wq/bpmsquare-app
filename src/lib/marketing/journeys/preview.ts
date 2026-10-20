import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { readinessProblems } from "./definition";
import type { TenantEnv } from "./env";
import { EVENT_BATCH, eventsAfter } from "./runner";
import { shouldEnrol, type EventLike } from "./rules";
import { resolveSubject } from "./subjects";
import type { JourneyDefinition, JourneyRow } from "./types";

// Before a journey is turned on: who would enter, using the very functions the
// runner enrols with (shouldEnrol, resolveSubject, the once-only key), and the
// guardrail messages built from that list. Reads only.

export type Entrant = { contact_id: string | null; account_id: string | null; contact_name: string; account_name: string; event_at: string };

export type EntryPreview = {
  count: number;
  /** The first ten, for the page. */
  first: Entrant[];
  lookbackDays: number;
  /** True when more events than one pass reads exist, so the count is a floor. */
  atLeast: boolean;
  all: Entrant[];
};

const MAX_PEOPLE = 1000;

/** People who would enter today if the journey were on now: recent matching events, not already in it. */
export async function previewEntrants(admin: SupabaseClient, env: TenantEnv, journey: Pick<JourneyRow, "id" | "definition" | "trigger_name">, now: Date): Promise<EntryPreview> {
  const def = journey.definition;
  const lookback = def.entry.lookback_days;
  const none: EntryPreview = { count: 0, first: [], lookbackDays: lookback, atLeast: false, all: [] };
  if (lookback <= 0 || !def.trigger.event) return none;
  const from = new Date(now.getTime() - lookback * 86_400_000).toISOString();
  const events = await eventsAfter(admin, env.tenantId, { created_at: from, id: "" }, [def.trigger.event], EVENT_BATCH);

  const pseudo = { id: journey.id, status: "live" as const, trigger_name: def.trigger.event, entry_from: from, definition: def };
  const keys = new Set<string>();
  const taken = await admin.from("journey_runs").select("subject_key").eq("tenant_id", env.tenantId).eq("journey_id", journey.id);
  const already = new Set(((taken.data ?? []) as { subject_key: string }[]).map((r) => r.subject_key));
  const all: Entrant[] = [];
  const accountNames = new Map<string, string>();
  for (const ev of events as EventLike[]) {
    if (!shouldEnrol(pseudo, ev).ok) continue;
    const s = await resolveSubject(admin, env.tenantId, def, ev);
    if (!s.key || !s.contact || keys.has(s.key) || already.has(s.key)) continue;
    keys.add(s.key);
    let accountName = accountNames.get(s.contact.account_id);
    if (accountName === undefined) {
      const a = await admin.from("accounts").select("name").eq("id", s.contact.account_id).eq("tenant_id", env.tenantId).maybeSingle();
      accountName = (a.data as { name?: string } | null)?.name ?? "";
      accountNames.set(s.contact.account_id, accountName);
    }
    all.push({ contact_id: s.contact.id, account_id: s.contact.account_id, contact_name: s.contact.name, account_name: accountName, event_at: ev.created_at });
    if (all.length >= MAX_PEOPLE) break;
  }
  return { count: all.length, first: all.slice(0, 10), lookbackDays: lookback, atLeast: events.length >= EVENT_BATCH || all.length >= MAX_PEOPLE, all };
}

// ── Guardrail messages ────────────────────────────────────────────────────────

export type GoLiveCheck = {
  code: "not_ready" | "blast_radius" | "missing_consent" | "several_a_day" | "nobody" | "clear";
  level: "stop" | "confirm" | "warn" | "info";
  text: string;
  count?: number;
};

export type GoLiveInput = {
  problems: string[];
  entrants: number;
  atLeast: boolean;
  blastRadius: number;
  /** How many of the entrants (checked) have no consent for the newsletter topic, and how many were checked. */
  noConsent: number;
  consentChecked: number;
  hasSendStep: boolean;
  /** Entrants already in another live journey or emailed in the last 24 hours. */
  busyToday: number;
};

/** Pure: turns the counts into the messages shown before Turn on. `confirm` ones need a tick before the button works. */
export function buildGoLiveChecks(i: GoLiveInput): GoLiveCheck[] {
  const out: GoLiveCheck[] = [];
  for (const p of i.problems) out.push({ code: "not_ready", level: "stop", text: p });
  if (i.entrants === 0 && i.problems.length === 0) out.push({ code: "nobody", level: "info", text: "Nobody would enter today. People will enter as new events happen." });
  if (i.entrants > i.blastRadius) {
    out.push({ code: "blast_radius", level: "confirm", count: i.entrants, text: `${i.atLeast ? "At least " : ""}${i.entrants} people would enter within five minutes of turning this on (the limit before it asks is ${i.blastRadius}). Check the list, then confirm.` });
  }
  if (i.hasSendStep && i.noConsent > 0) {
    const checked = i.consentChecked < i.entrants ? ` (checked ${i.consentChecked} of ${i.entrants})` : "";
    out.push({ code: "missing_consent", level: "warn", count: i.noConsent, text: `${i.noConsent} of the people who would enter have no consent for this subject${checked}. They would be skipped at the send step, never emailed.` });
  }
  if (i.hasSendStep && i.busyToday > 0) {
    out.push({ code: "several_a_day", level: "warn", count: i.busyToday, text: `${i.busyToday} ${i.busyToday === 1 ? "person is" : "people are"} already in another live journey or had a journey email today. The daily limit holds the second message back until tomorrow.` });
  }
  if (out.every((c) => c.level === "info") && i.problems.length === 0) out.push({ code: "clear", level: "info", text: "Nothing to warn about. Consent is still checked again at every send." });
  return out;
}

const CONSENT_CONCURRENCY = 8;
const CONSENT_LIMIT = 300;

export async function goLiveChecks(
  admin: SupabaseClient, env: TenantEnv, journey: Pick<JourneyRow, "id" | "definition" | "trigger_name">, now: Date,
  deps: { gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision> } = {},
): Promise<{ entry: EntryPreview; checks: GoLiveCheck[]; needsConfirm: boolean }> {
  const def: JourneyDefinition = journey.definition;
  const entry = await previewEntrants(admin, env, journey, now);
  const sendStep = def.steps.find((s) => s.kind === "send_newsletter");
  const gate = deps.gate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "email", topic, admin));

  let noConsent = 0;
  let checked = 0;
  if (sendStep && sendStep.kind === "send_newsletter") {
    const sample = entry.all.filter((e) => e.contact_id).slice(0, CONSENT_LIMIT);
    for (let i = 0; i < sample.length; i += CONSENT_CONCURRENCY) {
      const results = await Promise.all(sample.slice(i, i + CONSENT_CONCURRENCY).map((e) => gate(env.tenantId, e.contact_id as string, sendStep.topic)));
      for (const r of results) { checked++; if (!r.ok) noConsent++; }
    }
  }

  // Who is already busy: sent a journey email in the last day, or sitting in another live journey that still has a send ahead of it.
  let busy = 0;
  if (sendStep && entry.all.length > 0) {
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const ids = new Set(entry.all.map((e) => e.contact_id).filter((x): x is string => !!x));
    const [sentRes, activeRes] = await Promise.all([
      admin.from("journey_run_steps").select("contact_id").eq("tenant_id", env.tenantId).eq("sent", true).gte("at", since),
      admin.from("journey_runs").select("contact_id, journey_id").eq("tenant_id", env.tenantId).eq("status", "active"),
    ]);
    const busyIds = new Set<string>();
    if (!sentRes.error) for (const r of (sentRes.data ?? []) as { contact_id: string | null }[]) if (r.contact_id && ids.has(r.contact_id)) busyIds.add(r.contact_id);
    if (!activeRes.error) for (const r of (activeRes.data ?? []) as { contact_id: string | null; journey_id: string }[]) if (r.contact_id && ids.has(r.contact_id) && r.journey_id !== journey.id) busyIds.add(r.contact_id);
    busy = busyIds.size;
  }

  const checks = buildGoLiveChecks({
    problems: readinessProblems(def), entrants: entry.count, atLeast: entry.atLeast, blastRadius: env.limits.blastRadius,
    noConsent, consentChecked: checked, hasSendStep: !!sendStep, busyToday: busy,
  });
  return { entry, checks, needsConfirm: checks.some((c) => c.level === "confirm") };
}

