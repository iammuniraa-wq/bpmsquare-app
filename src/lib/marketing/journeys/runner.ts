import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENTS } from "@/lib/events/catalog";
import { emitEvent } from "@/lib/events/emit";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { isSchemaPending } from "@/lib/marketing/pending";
import { fillTaskText, waitMs } from "./definition";
import { journeysEnabled, loadTenantEnv, type TenantEnv } from "./env";
import {
  defaultOwnerLookup, loadAccount, loadContact, memberEmail, recentSendTimes, troubleFactsOf, type OwnerLookup,
} from "./facts";
import { resolveSubject } from "./subjects";
import { reasonLabel } from "./reasons";
import { shouldEnrol, triggerSummary, type EventLike } from "./rules";
import { MAX_ATTEMPTS, TROUBLE_RECHECK_MS, backoffMs, capCheck, inTrouble, localParts, timingCheck } from "./safety";
import { sendJourneyNewsletter, type SendStepArgs, type SendStepDeps, type SendStepResult } from "./sendStep";
import { listJourneyRows, type LoadedJourney } from "./store";
import { sendWhatsAppTemplate, type SendArgs as WaSendArgs, type SendDeps as WaSendDeps, type SendOutcome as WaSendOutcome } from "@/lib/marketing/whatsapp/send";
import type { RunRow, StepRow } from "./types";

// The runner (docs/marketing-platform-architecture.md 3.3, shell scope in
// docs/shells/journeys-shell.md). One call to runTenant() does, for one workspace:
//   1. takes that workspace's lock, so two overlapping cron calls cannot both work on it;
//   2. enrols people from new domain_event rows (a cursor per workspace), at most once;
//   3. advances runs whose next step is due, writing one journey_run_steps row per
//      finished step so a retried tick cannot do a step twice.
// It is bounded by a deadline and by per-tick caps, never an unbounded loop.

export type RunnerDeps = {
  now?: () => Date;
  gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  send?: (admin: SupabaseClient, a: SendStepArgs) => Promise<SendStepResult>;
  sendDeps?: SendStepDeps;
  /** WhatsApp: the consent check (channel whatsapp) and the send function, replaceable in tests. */
  waGate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  sendWa?: (admin: SupabaseClient, a: WaSendArgs, d?: WaSendDeps) => Promise<WaSendOutcome>;
  owner?: OwnerLookup;
  /** Epoch ms after which no new run is started. */
  deadline?: number;
};

export const EVENT_BATCH = 500;
export const RUN_BATCH = 200;
const MAX_STEPS_PER_TICK = 6;
const LOCK_MS = 4.5 * 60_000;

export type TenantResult = {
  tenantId: string;
  status: "ran" | "disabled" | "locked" | "pending_migration" | "nothing_live";
  enrolled: number;
  advanced: number;
  sent: number;
  skipped: number;
  errors: number;
};

const empty = (tenantId: string, status: TenantResult["status"]): TenantResult => ({ tenantId, status, enrolled: 0, advanced: 0, sent: 0, skipped: 0, errors: 0 });

// ── Lock ──────────────────────────────────────────────────────────────────────

export async function takeLock(admin: SupabaseClient, tenantId: string, now: Date): Promise<"taken" | "busy" | "pending"> {
  const seed = await admin.from("journey_runner_lock").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  if (seed.error) return isSchemaPending(seed.error) ? "pending" : "busy";
  // Atomic: only one caller's update matches a row whose lock has run out.
  const { data, error } = await admin.from("journey_runner_lock")
    .update({ locked_until: new Date(now.getTime() + LOCK_MS).toISOString(), last_run_at: now.toISOString() })
    .eq("tenant_id", tenantId).lt("locked_until", now.toISOString()).select("tenant_id");
  if (error) return isSchemaPending(error) ? "pending" : "busy";
  return Array.isArray(data) && data.length > 0 ? "taken" : "busy";
}

async function releaseLock(admin: SupabaseClient, tenantId: string, error: string | null) {
  await admin.from("journey_runner_lock").update({ locked_until: new Date(0).toISOString(), last_error: error }).eq("tenant_id", tenantId);
}

// ── Enrolment ─────────────────────────────────────────────────────────────────

type Cursor = { created_at: string; id: string };

async function readCursor(admin: SupabaseClient, tenantId: string): Promise<Cursor | null> {
  const { data } = await admin.from("journey_cursors").select("last_created_at, last_event_id").eq("tenant_id", tenantId).maybeSingle();
  const r = data as { last_created_at: string | null; last_event_id: string | null } | null;
  return r?.last_created_at ? { created_at: r.last_created_at, id: r.last_event_id ?? "" } : null;
}

async function writeCursor(admin: SupabaseClient, tenantId: string, c: Cursor) {
  await admin.from("journey_cursors").upsert({ tenant_id: tenantId, last_created_at: c.created_at, last_event_id: c.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
}

/** Events strictly after the cursor, oldest first. A keyset on (created_at, id): the filter on id happens here because created_at can tie. */
export async function eventsAfter(admin: SupabaseClient, tenantId: string, after: Cursor, names: string[], limit = EVENT_BATCH): Promise<EventLike[]> {
  const { data, error } = await admin.from("domain_event")
    .select("id, name, object_type, object_id, contact_id, account_id, campaign_id, source, depth, payload, created_at")
    .eq("tenant_id", tenantId).in("name", names).gte("created_at", after.created_at)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) {
    if (isSchemaPending(error)) return [];
    throw error;
  }
  // Compared as instants: the database writes "...+00:00" and the code writes "...Z", which do not sort as strings.
  const c = Date.parse(after.created_at);
  return ((data ?? []) as EventLike[]).filter((e) => { const t = Date.parse(e.created_at); return t > c || (t === c && e.id > after.id); });
}

export type EnrolOutcome = "enrolled" | "duplicate" | "no_person" | "no_contact";

/** Puts one person in one journey, once. Used by the runner and by the backfill when a journey is turned on. */
export async function enrolFromEvent(admin: SupabaseClient, env: TenantEnv, journey: LoadedJourney, ev: EventLike, now: Date): Promise<EnrolOutcome> {
  const tenantId = env.tenantId;
  const def = journey.definition;
  const { contact, accountId, key } = await resolveSubject(admin, tenantId, def, ev);
  if (!key) return "no_person";

  const existing = await admin.from("journey_runs").select("id").eq("tenant_id", tenantId).eq("journey_id", journey.id).eq("subject_key", key).maybeSingle();
  if (existing.data) return "duplicate";

  const first = def.steps[0];
  const nobody = !contact;
  const row = {
    tenant_id: tenantId, journey_id: journey.id, journey_version: journey.version, subject_key: key,
    contact_id: contact?.id ?? null, account_id: contact?.account_id ?? accountId,
    trigger_event_id: ev.id, trigger_event_name: ev.name, trigger_payload: { ...triggerSummary(ev), event_at: ev.created_at },
    status: nobody ? "exited" : first ? "active" : "done",
    current_step_id: nobody || !first ? null : first.id,
    next_due_at: nobody || !first ? null : now.toISOString(),
    exit_reason: nobody ? "no_contact" : first ? null : "finished",
    last_note: nobody ? reasonLabel("no_contact") : null, note_reason: nobody ? "no_contact" : null,
    entered_at: now.toISOString(), finished_at: nobody || !first ? now.toISOString() : null,
  };
  const ins = await admin.from("journey_runs").insert(row).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return "duplicate";
    throw ins.error;
  }
  if (!nobody) {
    await emitEvent(tenantId, {
      name: EVENTS.JOURNEY_ENTERED, object_type: "journey", object_id: journey.id, source: "runner", depth: ev.depth + 1,
      contact_id: contact?.id ?? null, account_id: row.account_id, key: `${(ins.data as { id: string }).id}:entered`, payload: { ref: journey.ref },
    }, admin);
  }
  return nobody ? "no_contact" : "enrolled";
}

/** When a journey is turned on: enrol people from recent events that match, through the same rules as the runner. */
export async function backfill(admin: SupabaseClient, env: TenantEnv, journey: LoadedJourney, now: Date): Promise<number> {
  if (!journey.entry_from || !journey.trigger_name) return 0;
  const events = await eventsAfter(admin, env.tenantId, { created_at: journey.entry_from, id: "" }, [journey.trigger_name]);
  const own = await ownCampaignIds(admin, env.tenantId);
  let n = 0;
  for (const ev of events) {
    if (!shouldEnrol({ ...journey, status: "live" }, ev, own).ok) continue;
    const o = await enrolFromEvent(admin, env, journey, ev, now);
    if (o === "enrolled" || o === "no_contact") n++;
  }
  return n;
}

async function ownCampaignIds(admin: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("marketing_campaigns").select("id, journey_id").eq("tenant_id", tenantId);
  if (error) return new Set();
  return new Set(((data ?? []) as { id: string; journey_id?: string | null }[]).filter((r) => !!r.journey_id).map((r) => r.id));
}

async function enrolNew(admin: SupabaseClient, env: TenantEnv, live: LoadedJourney[], deps: Required<Pick<RunnerDeps, "now">> & RunnerDeps, res: TenantResult) {
  const names = [...new Set(live.map((j) => j.trigger_name).filter((n): n is string => !!n))];
  if (names.length === 0) return;
  const floor = live.map((j) => j.entry_from).filter((x): x is string => !!x).sort()[0] ?? new Date(0).toISOString();
  const saved = await readCursor(admin, env.tenantId);
  const after: Cursor = saved && Date.parse(saved.created_at) >= Date.parse(floor) ? saved : { created_at: floor, id: "" };
  const events = await eventsAfter(admin, env.tenantId, after, names);
  if (events.length === 0) return;
  const own = await ownCampaignIds(admin, env.tenantId);
  let last: Cursor = after;
  for (const ev of events) {
    if (deps.deadline && Date.now() > deps.deadline) break;
    for (const j of live) {
      if (!shouldEnrol(j, ev, own).ok) continue;
      try {
        const o = await enrolFromEvent(admin, env, j, ev, deps.now());
        if (o === "enrolled" || o === "no_contact") res.enrolled++;
      } catch (e) {
        res.errors++;
        console.error(`[journeys] could not enrol from ${ev.name} into ${j.id}`, e);
      }
    }
    last = { created_at: ev.created_at, id: ev.id };
  }
  if (last !== after) await writeCursor(admin, env.tenantId, last);
}

// ── Advancing runs ────────────────────────────────────────────────────────────

type Ctx = {
  admin: SupabaseClient;
  env: TenantEnv;
  deps: Required<Pick<RunnerDeps, "now">> & RunnerDeps;
  res: TenantResult;
};

async function patchRun(ctx: Ctx, run: RunRow, patch: Record<string, unknown>) {
  Object.assign(run, patch);
  await ctx.admin.from("journey_runs").update(patch).eq("id", run.id).eq("tenant_id", ctx.env.tenantId);
}

async function recordStep(ctx: Ctx, run: RunRow, step: { id: string; kind: string }, attempt: number, status: StepRow["status"], reason: string, extra: { detail?: string; contact_id?: string | null; recipient_id?: string | null; sent?: boolean } = {}) {
  const { error } = await ctx.admin.from("journey_run_steps").insert({
    tenant_id: ctx.env.tenantId, run_id: run.id, journey_id: run.journey_id, step_id: step.id, step_kind: step.kind, attempt, status, reason,
    detail: extra.detail ?? null, contact_id: extra.contact_id ?? run.contact_id, recipient_id: extra.recipient_id ?? null, sent: extra.sent === true, at: ctx.deps.now().toISOString(),
  });
  // 23505 = the same (run, step, attempt) was already written by a retried tick: that is the point of the index.
  if (error && error.code !== "23505") throw error;
}

async function finishRun(ctx: Ctx, run: RunRow, journey: LoadedJourney, status: "done" | "exited", reason: string) {
  await patchRun(ctx, run, { status, exit_reason: reason, current_step_id: null, next_due_at: null, finished_at: ctx.deps.now().toISOString(), last_note: reasonLabel(reason), note_reason: null });
  await emitEvent(ctx.env.tenantId, {
    name: EVENTS.JOURNEY_EXITED, object_type: "journey", object_id: journey.id, source: "runner", depth: 1,
    contact_id: run.contact_id, account_id: run.account_id, key: `${run.id}:exited`, payload: { ref: journey.ref, reason },
  }, ctx.admin);
}

type StepFlow = "next" | "stop";

async function execSend(ctx: Ctx, run: RunRow, journey: LoadedJourney, step: Extract<LoadedJourney["definition"]["steps"][number], { kind: "send_newsletter" }>, attempt: number): Promise<StepFlow> {
  const { admin, env, deps } = ctx;
  const now = deps.now();
  const contact = run.contact_id ? await loadContact(admin, env.tenantId, run.contact_id) : null;
  if (!contact) { await recordStep(ctx, run, step, attempt, "skipped", "no_contact"); ctx.res.skipped++; return "next"; }
  const account = await loadAccount(admin, env.tenantId, contact.account_id);

  // 1. Consent first, so a refusal is never hidden behind a timing wait. The send path checks it again at the moment of sending.
  const gate = deps.gate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "email", topic, admin));
  const consent = await gate(env.tenantId, contact.id, step.topic);
  if (!consent.ok) {
    await recordStep(ctx, run, step, attempt, "skipped", consent.reason, { contact_id: contact.id });
    ctx.res.skipped++;
    return "next";
  }

  // 2. The rest of the safety rules defer the step; they never drop it.
  const today = localParts(now, env.timezone).dateKey;
  if (journey.definition.entry.pause_when_in_trouble && contact.account_id) {
    const facts = await troubleFactsOf(admin, env.tenantId, contact.account_id, today);
    if (inTrouble(now, facts, env.limits)) { await defer(ctx, run, new Date(now.getTime() + TROUBLE_RECHECK_MS), "account_in_trouble"); return "stop"; }
  }
  const timing = timingCheck(now, env.timezone, env.limits);
  if (!timing.ok) { await defer(ctx, run, timing.resumeAt, timing.reason); return "stop"; }
  const cap = capCheck(now, await recentSendTimes(admin, env.tenantId, contact.id, now), env.limits);
  if (!cap.ok) { await defer(ctx, run, cap.resumeAt, cap.reason); return "stop"; }

  // 3. The one send path.
  const send = deps.send ?? ((c: SupabaseClient, a: SendStepArgs) => sendJourneyNewsletter(c, a, deps.sendDeps));
  const r = await send(admin, { env, journey, step, run, contact, accountName: account?.name ?? "", accountOptedOut: account?.marketing_opt_out === true });
  if (r.status === "sent") {
    await recordStep(ctx, run, step, attempt, "done", r.reason === "already_sent" ? "already_sent" : "sent", { contact_id: contact.id, recipient_id: r.recipientId, sent: true });
    ctx.res.sent++;
    return "next";
  }
  if (r.status === "skipped") {
    await recordStep(ctx, run, step, attempt, "skipped", r.reason, { contact_id: contact.id, recipient_id: r.recipientId });
    ctx.res.skipped++;
    return "next";
  }
  await recordStep(ctx, run, step, attempt, "failed", r.reason, { detail: r.detail, contact_id: contact.id, recipient_id: r.recipientId });
  ctx.res.errors++;
  if (attempt >= MAX_ATTEMPTS) {
    await patchRun(ctx, run, { status: "stalled", last_note: `Stuck at the send: ${r.detail ?? reasonLabel(r.reason)}`, note_reason: r.reason });
  } else {
    await patchRun(ctx, run, { next_due_at: new Date(now.getTime() + backoffMs(attempt)).toISOString(), last_note: `Trying again after a problem: ${r.detail ?? reasonLabel(r.reason)}`, note_reason: r.reason });
  }
  return "stop";
}

/** The WhatsApp step: the same safety rules as the email step, then the one WhatsApp send function (which asks consent again). */
async function execWhatsapp(ctx: Ctx, run: RunRow, journey: LoadedJourney, step: Extract<LoadedJourney["definition"]["steps"][number], { kind: "send_whatsapp" }>, attempt: number): Promise<StepFlow> {
  const { admin, env, deps } = ctx;
  const now = deps.now();
  const contact = run.contact_id ? await loadContact(admin, env.tenantId, run.contact_id) : null;
  if (!contact) { await recordStep(ctx, run, step, attempt, "skipped", "no_contact"); ctx.res.skipped++; return "next"; }
  if (!step.template_id) { await recordStep(ctx, run, step, attempt, "skipped", "no_template", { contact_id: contact.id }); ctx.res.skipped++; return "next"; }
  if (env.features.whatsapp_marketing !== true) { await recordStep(ctx, run, step, attempt, "skipped", "module_off", { contact_id: contact.id }); ctx.res.skipped++; return "next"; }
  const account = await loadAccount(admin, env.tenantId, contact.account_id);

  // 1. Consent first, on the WhatsApp channel and the template's own subject, so a refusal is never hidden behind a wait.
  const { data: tpl, error: tErr } = await admin.from("whatsapp_templates").select("id, topic, category").eq("id", step.template_id).eq("tenant_id", env.tenantId).maybeSingle();
  if (tErr || !tpl) { await recordStep(ctx, run, step, attempt, "skipped", "template_missing", { contact_id: contact.id }); ctx.res.skipped++; return "next"; }
  const template = tpl as { topic: string | null; category: string };
  const gate = deps.waGate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "whatsapp", topic, admin));
  const consent = await gate(env.tenantId, contact.id, template.topic);
  if (!consent.ok) { await recordStep(ctx, run, step, attempt, "skipped", consent.reason, { contact_id: contact.id }); ctx.res.skipped++; return "next"; }

  // 2. The rest defer the step; they never drop it.
  const today = localParts(now, env.timezone).dateKey;
  if (journey.definition.entry.pause_when_in_trouble && template.category === "marketing" && contact.account_id) {
    const facts = await troubleFactsOf(admin, env.tenantId, contact.account_id, today);
    if (inTrouble(now, facts, env.limits)) { await defer(ctx, run, new Date(now.getTime() + TROUBLE_RECHECK_MS), "account_in_trouble"); return "stop"; }
  }
  const timing = timingCheck(now, env.timezone, env.limits);
  if (!timing.ok) { await defer(ctx, run, timing.resumeAt, timing.reason); return "stop"; }
  const cap = capCheck(now, await recentSendTimes(admin, env.tenantId, contact.id, now), env.limits);
  if (!cap.ok) { await defer(ctx, run, cap.resumeAt, cap.reason); return "stop"; }

  // 3. The one WhatsApp send path.
  const send = deps.sendWa ?? sendWhatsAppTemplate;
  const amount = typeof run.trigger_payload?.total === "number" ? Math.round(run.trigger_payload.total as number).toLocaleString("en-US") : null;
  const r = await send(admin, {
    tenantId: env.tenantId, contactId: contact.id, templateId: step.template_id, origin: "journey", journeyId: journey.id, clientRef: `${run.id}:${step.id}`, depth: 1,
    values: {
      contact_name: contact.name.split(" ")[0] || null, account_name: account?.name ?? null, company_name: env.name,
      quote_ref: typeof run.trigger_payload?.ref === "string" ? (run.trigger_payload.ref as string) : null, amount,
    },
  }, { now: deps.now });
  if (r.status === "sent" || r.status === "dry_run") {
    await recordStep(ctx, run, step, attempt, "done", r.reason === "already_sent" ? "already_sent" : r.status === "dry_run" ? "dry_run" : "sent", { contact_id: contact.id, sent: true });
    ctx.res.sent++;
    return "next";
  }
  if (r.status === "skipped") {
    if (r.reason === "weekly_cap" && r.retryAt) { await defer(ctx, run, r.retryAt, "weekly_cap"); return "stop"; }
    await recordStep(ctx, run, step, attempt, "skipped", r.reason, { contact_id: contact.id, detail: r.detail });
    ctx.res.skipped++;
    return "next";
  }
  await recordStep(ctx, run, step, attempt, "failed", r.reason, { detail: r.detail, contact_id: contact.id });
  ctx.res.errors++;
  if (attempt >= MAX_ATTEMPTS) await patchRun(ctx, run, { status: "stalled", last_note: `Stuck at the WhatsApp send: ${r.detail ?? reasonLabel(r.reason)}`, note_reason: r.reason });
  else await patchRun(ctx, run, { next_due_at: new Date(now.getTime() + backoffMs(attempt)).toISOString(), last_note: `Trying again after a problem: ${r.detail ?? reasonLabel(r.reason)}`, note_reason: r.reason });
  return "stop";
}

async function defer(ctx: Ctx, run: RunRow, until: Date, reason: string) {
  await patchRun(ctx, run, { next_due_at: until.toISOString(), last_note: `${reasonLabel(reason)}.`, note_reason: reason });
}

async function execTask(ctx: Ctx, run: RunRow, journey: LoadedJourney, step: Extract<LoadedJourney["definition"]["steps"][number], { kind: "create_task" }>, attempt: number) {
  const { admin, env, deps } = ctx;
  const now = deps.now();
  const contact = run.contact_id ? await loadContact(admin, env.tenantId, run.contact_id) : null;
  const account = run.account_id ? await loadAccount(admin, env.tenantId, run.account_id) : null;
  const owner = run.account_id ? await (deps.owner ?? defaultOwnerLookup)(env.tenantId, run.account_id) : null;
  const title = fillTaskText(step.title, {
    contact_name: contact?.name, account_name: account?.name, quote_ref: typeof run.trigger_payload?.ref === "string" ? (run.trigger_payload.ref as string) : "",
  });
  const due = localParts(new Date(now.getTime() + step.due_in_days * 86_400_000), env.timezone).dateKey;
  const { error } = await admin.from("journey_tasks").upsert({
    tenant_id: env.tenantId, journey_id: journey.id, run_id: run.id, step_id: step.id, account_id: run.account_id, contact_id: run.contact_id,
    owner_user_id: owner, title, due_on: due,
  }, { onConflict: "run_id,step_id", ignoreDuplicates: true });
  if (error) throw error;
  await recordStep(ctx, run, step, attempt, "done", owner ? "done" : "no_owner", { detail: title });
}

async function execNotify(ctx: Ctx, run: RunRow, journey: LoadedJourney, step: Extract<LoadedJourney["definition"]["steps"][number], { kind: "notify_owner" }>, attempt: number) {
  const { admin, env, deps } = ctx;
  const owner = run.account_id ? await (deps.owner ?? defaultOwnerLookup)(env.tenantId, run.account_id) : null;
  const email = owner ? await memberEmail(admin, env.tenantId, owner) : null;
  if (!owner || !email || !run.account_id) {
    await recordStep(ctx, run, step, attempt, "skipped", "no_owner");
    ctx.res.skipped++;
    return;
  }
  const { error } = await admin.from("record_comments").insert({
    tenant_id: env.tenantId, object_type: "accounts", object_id: run.account_id, author_id: null, author_email: null,
    body: `Journey "${journey.name}": ${step.text}`.slice(0, 500), mentions: [email],
  });
  if (error) throw error;
  await recordStep(ctx, run, step, attempt, "done", "done");
}

/** Runs one due run forward until it waits, defers, stops or finishes. */
export async function advanceRun(ctx: Ctx, run: RunRow, journey: LoadedJourney): Promise<void> {
  const steps = journey.definition.steps;
  for (let n = 0; n < MAX_STEPS_PER_TICK; n++) {
    if (!run.current_step_id) { await finishRun(ctx, run, journey, "done", "finished"); return; }
    const index = steps.findIndex((s) => s.id === run.current_step_id);
    if (index < 0) { await finishRun(ctx, run, journey, "exited", "journey_changed"); return; }
    const step = steps[index];
    const next = steps[index + 1] ?? null;

    const { data } = await ctx.admin.from("journey_run_steps").select("attempt, status, at").eq("tenant_id", ctx.env.tenantId).eq("run_id", run.id).eq("step_id", step.id);
    const prior = (data ?? []) as { attempt: number; status: string; at: string }[];
    const finished = prior.some((p) => p.status === "done" || p.status === "skipped");
    const attempt = prior.reduce((m, p) => Math.max(m, p.attempt), 0) + 1;

    let flow: StepFlow = "next";
    let waitUntil: Date | null = null;
    if (finished && step.kind === "wait") {
      // A retried tick finds the wait already scheduled: the clock runs from when it was, not from now.
      const at = prior.find((p) => p.status === "done")?.at;
      const eventAt = index === 0 && typeof run.trigger_payload?.event_at === "string" ? Date.parse(run.trigger_payload.event_at as string) : NaN;
      waitUntil = new Date((Number.isFinite(eventAt) ? eventAt : at ? Date.parse(at) : ctx.deps.now().getTime()) + waitMs(step));
    }
    if (!finished) {
      try {
        switch (step.kind) {
          case "wait": {
            // A wait at the very start counts from the event ("3 days after the quote was sent"), later waits from now.
            const eventAt = index === 0 && typeof run.trigger_payload?.event_at === "string" ? Date.parse(run.trigger_payload.event_at as string) : NaN;
            waitUntil = new Date((Number.isFinite(eventAt) ? eventAt : ctx.deps.now().getTime()) + waitMs(step));
            await recordStep(ctx, run, step, attempt, "done", "scheduled", { detail: `${step.amount} ${step.unit}` });
            break;
          }
          case "send_newsletter": flow = await execSend(ctx, run, journey, step, attempt); break;
          case "send_whatsapp": flow = await execWhatsapp(ctx, run, journey, step, attempt); break;
          case "create_task": await execTask(ctx, run, journey, step, attempt); break;
          case "notify_owner": await execNotify(ctx, run, journey, step, attempt); break;
          case "end": await recordStep(ctx, run, step, attempt, "done", "finished"); break;
        }
      } catch (e) {
        ctx.res.errors++;
        console.error(`[journeys] step ${step.id} of run ${run.id} failed`, e);
        const msg = (e as { message?: string })?.message?.slice(0, 200) ?? "failed";
        await recordStep(ctx, run, step, attempt, "failed", "send_failed", { detail: msg }).catch(() => {});
        if (attempt >= MAX_ATTEMPTS) await patchRun(ctx, run, { status: "stalled", last_note: `Stuck: ${msg}`, note_reason: "send_failed" });
        else await patchRun(ctx, run, { next_due_at: new Date(ctx.deps.now().getTime() + backoffMs(attempt)).toISOString(), last_note: `Trying again after a problem: ${msg}`, note_reason: "send_failed" });
        return;
      }
    }
    if (flow === "stop") return;

    ctx.res.advanced++;
    if (step.kind === "end" || !next) { await finishRun(ctx, run, journey, "done", "finished"); return; }
    if (waitUntil) {
      await patchRun(ctx, run, { current_step_id: next.id, next_due_at: waitUntil.toISOString(), last_note: step.kind === "wait" ? `Waiting ${step.amount} ${step.unit}.` : null, note_reason: null });
      return;
    }
    await patchRun(ctx, run, { current_step_id: next.id, next_due_at: ctx.deps.now().toISOString(), last_note: null, note_reason: null });
  }
}

async function advanceDue(ctx: Ctx, journeys: Map<string, LoadedJourney>) {
  const now = ctx.deps.now();
  const { data, error } = await ctx.admin.from("journey_runs").select("*")
    .eq("tenant_id", ctx.env.tenantId).eq("status", "active").lte("next_due_at", now.toISOString())
    .order("next_due_at", { ascending: true }).limit(RUN_BATCH);
  if (error) {
    if (isSchemaPending(error)) return;
    throw error;
  }
  for (const run of (data ?? []) as RunRow[]) {
    if (ctx.deps.deadline && Date.now() > ctx.deps.deadline) return;
    const journey = journeys.get(run.journey_id);
    if (!journey) continue;
    // Paused is the kill switch: runs stay where they are and keep their place.
    if (journey.status === "archived") { await finishRun(ctx, run, journey, "exited", "journey_archived"); continue; }
    if (journey.status !== "live") continue;
    try {
      await advanceRun(ctx, run, journey);
    } catch (e) {
      ctx.res.errors++;
      console.error(`[journeys] run ${run.id} could not advance`, e);
    }
  }
}

// ── One workspace ─────────────────────────────────────────────────────────────

export async function runTenant(admin: SupabaseClient, tenantId: string, deps: RunnerDeps = {}): Promise<TenantResult> {
  const now = deps.now ?? (() => new Date());
  const d = { ...deps, now };
  const env = await loadTenantEnv(admin, tenantId);
  if (!env || !journeysEnabled(env.features)) return empty(tenantId, "disabled");

  const lock = await takeLock(admin, tenantId, now());
  if (lock === "pending") return empty(tenantId, "pending_migration");
  if (lock === "busy") return empty(tenantId, "locked");

  const res = empty(tenantId, "ran");
  let failure: string | null = null;
  try {
    const all = await listJourneyRows(admin, tenantId, ["live", "paused", "archived"]);
    if (all.missing) { res.status = "pending_migration"; return res; }
    const byId = new Map(all.rows.map((j) => [j.id, j]));
    const live = all.rows.filter((j) => j.status === "live" && !j.invalid && j.trigger_name);
    if (all.rows.length === 0) { res.status = "nothing_live"; return res; }
    const ctx: Ctx = { admin, env, deps: d, res };
    await enrolNew(admin, env, live, d, res);
    await advanceDue(ctx, byId);
  } catch (e) {
    failure = (e as { message?: string })?.message?.slice(0, 300) ?? "failed";
    res.errors++;
    console.error(`[journeys] tick failed for ${tenantId}`, e);
  } finally {
    await releaseLock(admin, tenantId, failure);
  }
  return res;
}

/** Which workspaces to look at, least recently run first, so a large fleet is covered round-robin. */
export async function tenantsToRun(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("tenants").select("id, features").contains("features", { marketing: true, journeys: true });
  if (error) return [];
  const ids = ((data ?? []) as { id: string }[]).map((t) => t.id);
  const { data: locks } = await admin.from("journey_runner_lock").select("tenant_id, last_run_at");
  const lastRun = new Map(((locks ?? []) as { tenant_id: string; last_run_at: string | null }[]).map((l) => [l.tenant_id, l.last_run_at ?? ""]));
  return ids.sort((a, b) => (lastRun.get(a) ?? "").localeCompare(lastRun.get(b) ?? ""));
}
