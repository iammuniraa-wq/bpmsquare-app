import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_HOST, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { encrypt } from "@/lib/encryption";
import { insertWithMasterRef } from "@/lib/masterRef";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { BlindIndexKeyMissingError, emailBlindIndex } from "../blindIndex";
import { stampContactEmailHash } from "../contactEmailHash";
import { eventsEnabled, registerFromSubmission } from "../events/register";
import { confirmByEmailDefault, topicsOf } from "../config";
import { recordConsent, recordPendingConsent } from "../consentWrite";
import { isSchemaPending } from "../pending";
import { HONEYPOT_FIELD, LIMITS, type FormRow, type SubmitOutcome } from "./types";
import { allowedRedirectHosts, cleanRedirectUrl, cleanText, normaliseAfter, normaliseConsent, normaliseFields, sanitizeSubmission } from "./sanitize";
import { checkRenderToken, formBurst } from "./guards";
import { PUBLIC_KEY_PATTERN } from "./links";
import { signConfirmToken } from "./confirmToken";
import { sendSubmissionEmails, type EmailDeps } from "./emails";

// The public submit (docs/marketing-platform-architecture.md 5.1), in the order the
// design states: guards, find or create the person, write the consent, file the lead,
// keep the answers, tell the event stream.
//
// Tenant isolation, concretely (MULTI_TENANT_GUARDRAILS.md): the tenant is the one on
// the form row found by the request's public key - nothing in the body is ever read as
// a tenant, a form, a contact or an account id. This runs on the service-role client,
// which bypasses RLS, so every query below names that tenant.

export type TenantForSubmit = {
  id: string;
  name: string;
  slug?: string | null;
  company_info?: { email?: string } | null;
  custom_domain: string | null;
  is_demo: boolean | null;
  features: Partial<TenantFeatures> | null;
  config: Partial<TenantConfig> | null;
};

export type SubmitRequest = {
  key: string;
  rawBody: string;
  ipHash: string | null;
  uaFamily: string;
};

export type SubmitResponse = { status: number; body: SubmitOutcome };

/** Test seams for the emails; production passes nothing. */
export type SubmitDeps = EmailDeps;

const fail = (status: number, error: string, fields?: string[]): SubmitResponse => ({ status, body: { ok: false, error, ...(fields ? { fields } : {}) } });

export function formsEnabled(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.marketing_forms === true;
}

export function toFormRow(r: Record<string, unknown>): FormRow {
  return {
    ...(r as unknown as FormRow),
    fields: normaliseFields(r.fields),
    consent: normaliseConsent(r.consent),
    after_submit: normaliseAfter(r.after_submit),
  };
}

/** A live form and its tenant by the public key, or null (also for a flag that is off or a missing table). */
export async function loadByPublicKey(admin: SupabaseClient, key: string): Promise<{ form: FormRow; tenant: TenantForSubmit } | null> {
  if (!PUBLIC_KEY_PATTERN.test(key)) return null;
  const { data, error } = await admin.from("forms").select("*").eq("public_key", key).maybeSingle();
  if (error || !data) return null;
  const form = toFormRow(data as Record<string, unknown>);
  const { data: t } = await admin
    .from("tenants").select("id, name, slug, company_info, custom_domain, is_demo, features, config").eq("id", form.tenant_id).maybeSingle();
  if (!t || !formsEnabled((t as TenantForSubmit).features)) return null;
  if (form.status !== "live") return null;
  return { form, tenant: t as TenantForSubmit };
}

// ── the person ────────────────────────────────────────────────────────────

/** The most recent contact of THIS tenant with this address, by the email blind index. */
export async function findContactByEmailHash(
  admin: SupabaseClient, tenantId: string, hash: string,
): Promise<{ id: string; account_id: string } | null | "unavailable"> {
  const { data, error } = await admin
    .from("contacts").select("id, account_id").eq("tenant_id", tenantId).eq("email_hash", hash).order("created_at", { ascending: false }).limit(1);
  if (error) return "unavailable";
  const row = ((data ?? []) as { id: string; account_id: string }[])[0];
  return row ?? null;
}

const domainOf = (email: string) => email.split("@")[1] ?? "";

async function createPerson(
  admin: SupabaseClient, tenantId: string, v: Partial<Record<string, string>>,
): Promise<{ contactId: string; accountId: string } | null> {
  const email = v.email as string;
  const accountName = cleanText(v.company ?? "", LIMITS.value.company) || domainOf(email) || "New enquiry";
  const acct = await insertWithMasterRef<{ id: string }>(admin, "accounts", tenantId, {
    tenant_id: tenantId, name: accountName, type: "prospect", email: encrypt(email), phone: encrypt(v.phone || null),
  }, "id");
  if (acct.error || !acct.data) return null;
  const name = cleanText(v.name ?? "", LIMITS.value.name) || email.split("@")[0];
  const contact = await insertWithMasterRef<{ id: string }>(admin, "contacts", tenantId, {
    tenant_id: tenantId, account_id: acct.data.id, name, email: encrypt(email), phone: encrypt(v.phone || null),
  }, "id");
  if (contact.error || !contact.data) return null;
  await stampContactEmailHash(admin, tenantId, contact.data.id, email);
  return { contactId: contact.data.id, accountId: acct.data.id };
}

// ── the lead ──────────────────────────────────────────────────────────────

const OPEN_LEAD_STATUSES = ["new", "inspecting", "quoted"];

/**
 * One open lead per person per form: a second submit from the same person updates the lead's last
 * activity instead of piling up copies. While migration 0172 is pending the lead is filed as a plain
 * "direct" lead (no form link) rather than lost.
 */
export async function fileLead(
  admin: SupabaseClient, tenantId: string,
  p: { formId: string; formName: string; accountId: string; contactId: string; personName: string },
): Promise<{ id: string | null; created: boolean }> {
  const now = new Date().toISOString();
  const { data: existing, error: exErr } = await admin
    .from("leads").select("id").eq("tenant_id", tenantId).eq("account_id", p.accountId).eq("source_form_id", p.formId).in("status", OPEN_LEAD_STATUSES).limit(1);
  const found = ((existing ?? []) as { id: string }[])[0];
  if (!exErr && found) {
    await admin.from("leads").update({ last_activity_at: now }).eq("id", found.id).eq("tenant_id", tenantId);
    return { id: found.id, created: false };
  }
  const title = cleanText(`Enquiry from ${p.personName} (${p.formName})`, 200);
  const full = await admin.from("leads").insert({
    tenant_id: tenantId, account_id: p.accountId, contact_id: p.contactId, title, source: "form", source_form_id: p.formId,
    status: "new", last_activity_at: now,
  }).select("id").single();
  if (!full.error && full.data) return { id: (full.data as { id: string }).id, created: true };
  // 23514: the source check does not know 'form' yet; 42703 and friends: a new column is missing.
  if (full.error && (full.error.code === "23514" || isSchemaPending(full.error))) {
    const plain = await admin.from("leads").insert({ tenant_id: tenantId, account_id: p.accountId, title, source: "direct", status: "new" }).select("id").single();
    if (!plain.error && plain.data) return { id: (plain.data as { id: string }).id, created: true };
  }
  return { id: null, created: false };
}

// ── the whole submit ──────────────────────────────────────────────────────

export async function handleSubmission(admin: SupabaseClient, req: SubmitRequest, deps: SubmitDeps = {}): Promise<SubmitResponse> {
  try {
    if (Buffer.byteLength(req.rawBody, "utf8") > LIMITS.bodyBytes) return fail(413, "That is too much to send in one go.");
    let parsed: unknown;
    try { parsed = JSON.parse(req.rawBody); } catch { return fail(400, "That could not be read."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "That could not be read.");
    const body = parsed as Record<string, unknown>;

    const loaded = await loadByPublicKey(admin, req.key);
    if (!loaded) return fail(404, "Not found");
    const { form, tenant } = loaded;
    const tenantId = tenant.id;

    // A script fills every box, including the one a person cannot see. It is told it worked and nothing is kept.
    if (typeof body[HONEYPOT_FIELD] === "string" && (body[HONEYPOT_FIELD] as string).trim() !== "") {
      return { status: 200, body: { ok: true, after: { kind: "message", message: form.after_submit.message } } };
    }

    const timing = checkRenderToken(form.public_key, body.rt);
    if (!timing.ok) {
      if (timing.reason === "expired") return fail(422, "This form has been open for a long time. Please reload the page and try again.");
      if (timing.reason === "too_fast") return fail(429, "That was quick. Please check your answers and send again.");
      return fail(422, "Please reload the page and try again.");
    }

    if (req.ipHash && formBurst.hit(`${form.id}:${req.ipHash}`)) return fail(429, "Too many tries. Please wait a little and try again.");
    if (req.ipHash) {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { data: recent } = await admin
        .from("form_submissions").select("id")
        .eq("tenant_id", tenantId).eq("form_id", form.id).eq("ip_hash", req.ipHash).gte("created_at", since).limit(LIMITS.perHour);
      if (((recent ?? []) as unknown[]).length >= LIMITS.perHour) return fail(429, "Too many tries. Please wait a little and try again.");
    }

    const clean = sanitizeSubmission(body, form.fields);
    if (clean.invalid.length) return fail(422, `Please check: ${clean.invalid.join(", ")}.`, clean.invalid);
    if (form.consent.required && !clean.consent) return fail(422, "Please tick the box to agree before sending.");
    const email = clean.values.email as string;

    let hash: string | null;
    try { hash = emailBlindIndex(email); } catch (e) {
      if (!(e instanceof BlindIndexKeyMissingError)) throw e;
      console.error(`[forms] ${e.message}`);
      return fail(503, "We cannot take this right now. Please try again later.");
    }
    if (!hash) return fail(422, "Please check: Email.", ["Email"]);

    // 1. the person
    const found = await findContactByEmailHash(admin, tenantId, hash);
    if (found === "unavailable") return fail(503, "We cannot take this right now. Please try again later.");
    let contactId: string;
    let accountId: string;
    let outcome: "created" | "matched";
    if (found) {
      // An existing contact is never changed by an anonymous form.
      contactId = found.id; accountId = found.account_id; outcome = "matched";
    } else {
      const made = await createPerson(admin, tenantId, clean.values);
      if (!made) return fail(500, "We could not save that. Please try again.");
      contactId = made.contactId; accountId = made.accountId; outcome = "created";
    }

    // Did this person send this form a moment ago? Then no second thank-you goes out (see skipThanks).
    let repeat = false;
    {
      const { data: prior } = await admin
        .from("form_submissions").select("id").eq("tenant_id", tenantId).eq("form_id", form.id).eq("contact_id", contactId)
        .gte("created_at", new Date(Date.now() - 3_600_000).toISOString()).limit(1);
      repeat = ((prior ?? []) as unknown[]).length > 0;
    }

    // 2. consent: only for a box the person ticked; one row per topic the form named. A form that asks people to
    // confirm by email (double opt-in) records each as PENDING instead; the link in the thank-you email makes it a yes.
    const confirmTopics: string[] = [];
    if (clean.consent) {
      const topicList = topicsOf(tenant.config);
      const known = new Set(topicList.map((t) => t.key));
      const named = form.consent.topics;
      const topics: (string | null)[] = named.length === 0 ? [null] : named.filter((t) => known.has(t));
      const evidence = {
        form_id: form.id, form_ref: form.ref, form_version: form.updated_at,
        text: form.consent.text, topics: named,
        ip_hash: req.ipHash, ua_family: req.uaFamily,
      };
      const doubleOptIn = form.after_submit.confirm_by_email ?? confirmByEmailDefault(tenant.config);
      if (doubleOptIn && !signConfirmToken(contactId)) {
        // Without the signing secret no link can be made, so nothing could ever confirm. Record nothing rather than a yes nobody gave.
        console.error(`[forms] form ${form.id} asks for confirmation but QUOTE_PUBLIC_LINK_SECRET is not set: consent not recorded`);
      } else {
        for (const topic of topics) {
          if (doubleOptIn) {
            const r = await recordPendingConsent(tenantId, {
              contactId, channel: "email", topic, source: "form", evidence: { ...evidence, double_opt_in: true },
            }, admin);
            if (r.ok) {
              if (!r.skipped) confirmTopics.push(topic === null ? "our news and offers" : (topicList.find((t) => t.key === topic)?.label ?? topic));
            } else if (r.pending) {
              // Migration 0197 not applied yet: no pending state exists. Nothing is recorded and nothing is claimed.
              console.error(`[forms] consent not recorded for form ${form.id}: the confirmation state is waiting for a database update`);
            } else {
              console.error(`[forms] consent not recorded for form ${form.id}: ${r.error}`);
              return fail(503, "We could not save your choice. Please try again later.");
            }
            continue;
          }
          const r = await recordConsent(tenantId, {
            contactId, channel: "email", topic, status: "granted", basis: "consent", source: "form", evidence,
          }, admin);
          if (!r.ok) {
            console.error(`[forms] consent not recorded for form ${form.id}: ${r.error}`);
            return fail(503, "We could not save your choice. Please try again later.");
          }
        }
      }
    }

    // 3. the lead
    const personName = clean.values.name || (email.split("@")[0] ?? "");
    const lead = await fileLead(admin, tenantId, { formId: form.id, formName: form.name, accountId, contactId, personName });

    // 4. the answers, kept 180 days, personal values encrypted
    const answers: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(clean.values)) answers[k] = encrypt(v as string);
    const { data: sub, error: subErr } = await admin.from("form_submissions").insert({
      tenant_id: tenantId, form_id: form.id, contact_id: contactId, account_id: accountId, lead_id: lead.id, answers,
      consent_given: clean.consent, outcome, ip_hash: req.ipHash, ua_family: req.uaFamily,
      expires_at: new Date(Date.now() + LIMITS.retentionDays * 86_400_000).toISOString(),
    }).select("id").single();
    if (subErr && !isSchemaPending(subErr)) console.error(`[forms] submission not kept: ${subErr.message}`);

    // 5. the event stream: ids and counts only
    const submissionId = (sub as { id?: string } | null)?.id ?? null;
    await emitEvent(tenantId, {
      name: EVENTS.FORM_SUBMITTED, object_type: "form", object_id: form.id, source: "public_link",
      contact_id: contactId, account_id: accountId, lead_id: lead.id,
      key: submissionId ?? `${form.id}:${contactId}:${Date.now()}`,
      payload: { form_id: form.id, outcome, consent: clean.consent, lead_created: lead.created, confirm_pending: confirmTopics.length > 0 },
    }, admin);
    if (lead.created && lead.id) {
      await emitEvent(tenantId, {
        name: EVENTS.LEAD_CREATED, object_type: "lead", object_id: lead.id, source: "public_link",
        contact_id: contactId, account_id: accountId, lead_id: lead.id, key: lead.id, payload: { source: "form", form_id: form.id },
      }, admin);
    }

    // 5b. an open event whose registration form this is registers the person (Events; a no-op unless the
    // workspace has that module, and it never throws, so it can never lose the answers above).
    if (eventsEnabled(tenant.features)) await registerFromSubmission(admin, tenantId, { formId: form.id, contactId, submissionId });

    // 5c. the emails: the visitor's thank-you (with the confirm link when one is owed) and the notice to the owner.
    // Never throws and never changes what the visitor sees.
    await sendSubmissionEmails(admin, {
      form, tenant, contactId, email, values: clean.values, confirmTopics, skipThanks: repeat,
    }, deps);

    if (Math.random() < 0.05) await purgeExpired(admin, tenantId);

    // 6. what the visitor sees next. The redirect is re-checked now: the domain may have changed since the form was saved.
    if (form.after_submit.kind === "redirect") {
      const url = cleanRedirectUrl(form.after_submit.redirect_url, allowedRedirectHosts(tenant, PRIMARY_HOST));
      if (url) return { status: 200, body: { ok: true, after: { kind: "redirect", url } } };
    }
    return { status: 200, body: { ok: true, after: { kind: "message", message: form.after_submit.message } } };
  } catch (e) {
    console.error("[forms] submit failed", e);
    return fail(500, "We could not save that. Please try again.");
  }
}

/** Removes this workspace's answers past their 180 days. The records made from them stay. */
export async function purgeExpired(admin: SupabaseClient, tenantId: string): Promise<void> {
  try {
    const { error } = await admin.from("form_submissions").delete().eq("tenant_id", tenantId).lt("expires_at", new Date().toISOString());
    if (error && !isSchemaPending(error)) console.error(`[forms] purge failed: ${error.message}`);
  } catch (e) {
    console.error("[forms] purge failed", e);
  }
}
