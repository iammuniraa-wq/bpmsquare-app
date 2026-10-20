import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { resolveRecipientLanguage } from "@/lib/newsletter/language";
import { loadVersion, sendableLanguages } from "@/lib/newsletter/server";
import { resolveOutbound } from "@/lib/emailOutputRules";
import { decrypt } from "@/lib/encryption";
import { normalisePhone } from "@/lib/marketing/whatsapp/phone";
import { whatsappOutputFor } from "@/lib/marketing/whatsapp/rules";
import { describeCondition, fillTaskText, triggerLabel, waitMs } from "./definition";
import type { TenantEnv } from "./env";
import { defaultOwnerLookup, loadAccount, loadContact, memberEmail, recentSendTimes, troubleFactsOf, type OwnerLookup } from "./facts";
import { reasonLabel } from "./reasons";
import { capCheck, inTrouble, localParts, timingCheck } from "./safety";
import type { JourneyDefinition } from "./types";

// "Try it on one person": walks a real contact through the journey's steps and
// says what WOULD happen, with the reason at every turn. It only reads. It does
// not insert a run, a step row, a recipient or an event, it does not call the
// mailer and it does not touch the cursor; a test proves that by watching the
// database calls. The timeline it returns is also the "example person" preview
// shown before a journey is turned on.

export type TraceOutcome = "start" | "happens" | "held" | "skipped" | "waits" | "end";

export type TraceLine = {
  step_id: string | null;
  /** Days since the trigger, for the timeline ("Day 3"). */
  day: number;
  title: string;
  outcome: TraceOutcome;
  why: string;
  /** For a send: the version, language and subject; for a task: its text. */
  detail?: string;
  reason?: string;
};

export type SimulationResult = { person: { name: string; account: string }; lines: TraceLine[]; wouldSend: number; sendsNothing: true };

export type SimulateDeps = {
  now?: () => Date;
  gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  /** The same check for the WhatsApp channel. */
  waGate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  owner?: OwnerLookup;
  /** Stand-in for the trigger payload (a quote reference, an amount); the real values only exist once an event happens. */
  sample?: Record<string, unknown>;
};

const fmtTime = (d: Date, tz: string) => {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); } catch { return d.toISOString(); }
};

export async function simulateJourney(admin: SupabaseClient, env: TenantEnv, def: JourneyDefinition, contactId: string, deps: SimulateDeps = {}): Promise<SimulationResult | null> {
  const now = (deps.now ?? (() => new Date()))();
  const contact = await loadContact(admin, env.tenantId, contactId);
  if (!contact) return null;
  const account = await loadAccount(admin, env.tenantId, contact.account_id);
  const gate = deps.gate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "email", topic, admin));
  const owner = deps.owner ?? defaultOwnerLookup;

  // Languages are optional columns (0143): a workspace without them reads as "no preference".
  let contactLang: string | null = null;
  let accountLang: string | null = null;
  const cl = await admin.from("contacts").select("preferred_language").eq("id", contact.id).eq("tenant_id", env.tenantId).maybeSingle();
  if (!cl.error) contactLang = (cl.data as { preferred_language?: string | null } | null)?.preferred_language ?? null;
  const al = await admin.from("accounts").select("preferred_language").eq("id", contact.account_id).eq("tenant_id", env.tenantId).maybeSingle();
  if (!al.error) accountLang = (al.data as { preferred_language?: string | null } | null)?.preferred_language ?? null;

  const lines: TraceLine[] = [];
  let clock = now.getTime();
  const dayOf = () => Math.round(((clock - now.getTime()) / 86_400_000) * 10) / 10;
  const cond = describeCondition(def.trigger.condition);
  lines.push({
    step_id: null, day: 0, title: triggerLabel(def.trigger.event), outcome: "start",
    why: `${contact.name || "This person"} enters${cond ? ` because it is ${cond}` : ""}. Nothing is sent by this preview.`,
  });

  let wouldSend = 0;
  const today = localParts(now, env.timezone).dateKey;
  const recent = await recentSendTimes(admin, env.tenantId, contact.id, now);
  const simulatedSends: Date[] = [];

  for (const step of def.steps) {
    switch (step.kind) {
      case "wait":
        clock += waitMs(step);
        lines.push({ step_id: step.id, day: dayOf(), title: `Wait ${step.amount} ${step.unit}`, outcome: "waits", why: `Moves on at ${fmtTime(new Date(clock), env.timezone)}.` });
        break;
      case "send_newsletter": {
        const title = "Send a newsletter version";
        if (env.features.newsletter_studio !== true) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason: "studio_off", why: reasonLabel("studio_off") }); break; }
        if (!step.newsletter_version_id) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason: "no_version", why: reasonLabel("no_version") }); break; }
        const version = await loadVersion(admin, env.tenantId, step.newsletter_version_id);
        if (!version) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason: "version_missing", why: reasonLabel("version_missing") }); break; }
        // Consent is evaluated on the day, exactly as the runner would, and a refusal is never hidden behind a wait.
        const consent = await gate(env.tenantId, contact.id, step.topic);
        if (!consent.ok) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason: consent.reason, why: `${reasonLabel(consent.reason)}. The message is skipped and the journey carries on.` }); break; }
        const at = new Date(clock);
        if (def.entry.pause_when_in_trouble) {
          const facts = await troubleFactsOf(admin, env.tenantId, contact.account_id, today);
          if (inTrouble(at, facts, env.limits)) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "held", reason: "account_in_trouble", why: `${reasonLabel("account_in_trouble")}, so it waits and looks again every few hours.` }); break; }
        }
        let sendAt = at;
        const timing = timingCheck(at, env.timezone, env.limits);
        if (!timing.ok) { sendAt = timing.resumeAt; lines.push({ step_id: step.id, day: dayOf(), title: "Held", outcome: "held", reason: timing.reason, why: `${reasonLabel(timing.reason)}: it would go at ${fmtTime(sendAt, env.timezone)}.` }); }
        const cap = capCheck(sendAt, [...recent, ...simulatedSends], env.limits);
        if (!cap.ok) { lines.push({ step_id: step.id, day: dayOf(), title: "Held", outcome: "held", reason: "daily_cap", why: `${reasonLabel("daily_cap")}: it would go at ${fmtTime(cap.resumeAt, env.timezone)}.` }); sendAt = cap.resumeAt; }
        simulatedSends.push(sendAt);
        clock = Math.max(clock, sendAt.getTime());
        const ready = sendableLanguages(version);
        const included = step.languages.length ? step.languages.filter((l) => ready.includes(l)) : ready;
        if (included.length === 0) { lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason: "no_language", why: reasonLabel("no_language") }); break; }
        const choice = resolveRecipientLanguage({ contactLanguage: contactLang, accountLanguage: accountLang, included, fallback: step.fallback_language });
        const subject = version.snapshot.languages.find((l) => l.lang === choice.lang)?.subject ?? "";
        const routed = contact.email ? resolveOutbound(env.output, { to: [contact.email], subject, text: "" }) : null;
        const where = !contact.email ? "The person has no email address, so it would be skipped."
          : routed && routed.ok && routed.email.redirected ? "This workspace redirects email, so it would go to the redirect inbox, not to the person."
          : routed && !routed.ok ? "No redirect inbox is set, so nothing would be sent." : "It would go to the person.";
        wouldSend += contact.email && routed?.ok ? 1 : 0;
        lines.push({
          step_id: step.id, day: dayOf(), title, outcome: contact.email ? "happens" : "skipped", reason: contact.email ? undefined : "no_email",
          why: `${where} Consent for ${step.topic ?? "this subject"}: ${consent.reason.replace(/_/g, " ")}.`,
          detail: `${version.snapshot.name}, version ${version.version}, in ${choice.lang.toUpperCase()}${subject ? ` — “${subject}”` : ""}`,
        });
        break;
      }
      case "send_whatsapp": {
        const title = "Send a WhatsApp template";
        const skipLine = (reason: string, why: string) => lines.push({ step_id: step.id, day: dayOf(), title, outcome: "skipped", reason, why });
        if (env.features.whatsapp_marketing !== true) { skipLine("module_off", reasonLabel("module_off")); break; }
        if (!step.template_id) { skipLine("no_template", reasonLabel("no_template")); break; }
        const tpl = await admin.from("whatsapp_templates").select("name, language, status, topic, category").eq("id", step.template_id).eq("tenant_id", env.tenantId).maybeSingle();
        const template = tpl.data as { name: string; language: string; status: string; topic: string | null; category: string } | null;
        if (!template) { skipLine("template_missing", reasonLabel("template_missing")); break; }
        const waConsent = await (deps.waGate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "whatsapp", topic, admin)))(env.tenantId, contact.id, template.topic);
        if (!waConsent.ok) { skipLine(waConsent.reason, `${reasonLabel(waConsent.reason)}. The message is skipped and the journey carries on.`); break; }
        if (template.status !== "approved") { skipLine("template_not_approved", reasonLabel("template_not_approved")); break; }
        const ph = await admin.from("contacts").select("phone, country").eq("id", contact.id).eq("tenant_id", env.tenantId).maybeSingle();
        const phoneRow = ph.data as { phone: string | null; country: string | null } | null;
        if (!normalisePhone(decrypt(phoneRow?.phone ?? null), phoneRow?.country)) { skipLine("no_phone", reasonLabel("no_phone")); break; }
        const waAt = new Date(clock);
        let waSendAt = waAt;
        const waTiming = timingCheck(waAt, env.timezone, env.limits);
        if (!waTiming.ok) { waSendAt = waTiming.resumeAt; lines.push({ step_id: step.id, day: dayOf(), title: "Held", outcome: "held", reason: waTiming.reason, why: `${reasonLabel(waTiming.reason)}: it would go at ${fmtTime(waSendAt, env.timezone)}.` }); }
        const waCap = capCheck(waSendAt, [...recent, ...simulatedSends], env.limits);
        if (!waCap.ok) { waSendAt = waCap.resumeAt; lines.push({ step_id: step.id, day: dayOf(), title: "Held", outcome: "held", reason: "daily_cap", why: `${reasonLabel("daily_cap")}: it would go at ${fmtTime(waSendAt, env.timezone)}.` }); }
        simulatedSends.push(waSendAt);
        clock = Math.max(clock, waSendAt.getTime());
        const out = whatsappOutputFor({ isDemo: env.isDemo, config: env.config });
        const where = out.mode === "redirect" ? "This is a demo workspace, so it would go to the workspace's test number, not to the person."
          : out.mode === "dry_run" ? "This is a demo workspace with no test number, so it would only be logged." : "It would go to the person.";
        wouldSend += out.mode === "dry_run" ? 0 : 1;
        lines.push({
          step_id: step.id, day: dayOf(), title, outcome: "happens",
          why: `${where} Consent for ${template.topic ?? "this subject"} on WhatsApp: ${waConsent.reason.replace(/_/g, " ")}.`,
          detail: `${template.name}, in ${template.language.toUpperCase()}${template.category === "marketing" ? ", a marketing message (one a week per person)" : ""}`,
        });
        break;
      }
      case "create_task": {
        const ownerId = await owner(env.tenantId, contact.account_id);
        const who = ownerId ? (await memberEmail(admin, env.tenantId, ownerId)) ?? "the owner" : null;
        const title = fillTaskText(step.title, { contact_name: contact.name, account_name: account?.name, quote_ref: typeof deps.sample?.ref === "string" ? deps.sample.ref : "" });
        lines.push({
          step_id: step.id, day: dayOf(), title: "Create a task for the owner", outcome: "happens",
          why: who ? `Assigned to ${who} (from Coverage), due in ${step.due_in_days} day${step.due_in_days === 1 ? "" : "s"}.` : `${reasonLabel("no_owner")}.`,
          detail: title,
        });
        break;
      }
      case "notify_owner": {
        const ownerId = await owner(env.tenantId, contact.account_id);
        const who = ownerId ? await memberEmail(admin, env.tenantId, ownerId) : null;
        lines.push({
          step_id: step.id, day: dayOf(), title: "Notify the owner", outcome: who ? "happens" : "skipped", reason: who ? undefined : "no_owner",
          why: who ? `${who} would see it in the Nova inbox.` : "Nobody owns this company yet, so nobody would be told.", detail: step.text,
        });
        break;
      }
      case "end":
        lines.push({ step_id: step.id, day: dayOf(), title: "End", outcome: "end", why: "The journey finishes here for this person." });
        break;
    }
  }
  if (!def.steps.some((s) => s.kind === "end")) lines.push({ step_id: null, day: dayOf(), title: "Done", outcome: "end", why: "No more steps: the journey finishes here for this person." });
  return { person: { name: contact.name, account: account?.name ?? "" }, lines, wouldSend, sendsNothing: true };
}

