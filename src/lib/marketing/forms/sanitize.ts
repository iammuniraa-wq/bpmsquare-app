import { normaliseEmail } from "../blindIndex";
import {
  FIELD_LABEL_DEFAULT, FORM_FIELD_KEYS, FORM_STATUSES, LIMITS, defaultAfterSubmit, defaultFields,
  type AfterSubmit, type FormConsent, type FormField, type FormFieldKey, type FormStatus,
} from "./types";

// Everything a person types - a visitor on the public form or an admin in the
// builder - passes through here before it is stored. The rule is the one the
// design states: every text is sanitised and nothing is ever rendered as HTML.
// These functions make plain text; the screens render it as text (React escapes),
// and the one place text meets HTML in an email is escaped where it is built.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const TAG = /<\/?[a-z!?][^>]*>?/gi;

/** Plain text: no control or direction-override characters, no tags, trimmed, capped. */
export function cleanText(v: unknown, max: number, opts: { multiline?: boolean } = {}): string {
  if (typeof v !== "string") return "";
  let s = v.normalize("NFKC").replace(/\r\n?/g, "\n").replace(CONTROL, "");
  s = s.replace(TAG, "");
  s = opts.multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

/** An email address, or "" when it cannot be one. */
export function cleanEmailValue(v: unknown): string {
  if (typeof v !== "string") return "";
  const n = normaliseEmail(cleanText(v, LIMITS.value.email));
  return n && n.length <= LIMITS.value.email && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(n) ? n : "";
}

export function cleanPhoneValue(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[^\d+\-().\s]/g, "").replace(/\s+/g, " ").trim().slice(0, LIMITS.value.phone);
}

export function slugify(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.slug);
}

/** The slugs the app itself could one day want under /f/, plus anything that looks like a file. */
export function isUsableSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug);
}

// ── What a visitor sends ──────────────────────────────────────────────────

export type CleanSubmission = {
  values: Partial<Record<FormFieldKey, string>>;
  consent: boolean;
  /** Field labels that failed, for a message the visitor can act on. */
  invalid: string[];
};

/**
 * Reads a submit body against the form's own fields. Unknown keys are dropped (a
 * visitor cannot add a field), disabled fields are ignored, and a required field
 * left empty - or an email that is not one - is reported.
 */
export function sanitizeSubmission(body: Record<string, unknown>, fields: FormField[]): CleanSubmission {
  const values: Partial<Record<FormFieldKey, string>> = {};
  const invalid: string[] = [];
  for (const f of fields) {
    if (!f.enabled) continue;
    const raw = body[f.key];
    let v = "";
    if (f.key === "email") v = cleanEmailValue(raw);
    else if (f.key === "phone") v = cleanPhoneValue(raw);
    else if (f.key === "message") v = cleanText(raw, LIMITS.value.message, { multiline: true });
    else if (f.key === "name") v = cleanText(raw, LIMITS.value.name);
    else if (f.key === "company") v = cleanText(raw, LIMITS.value.company);
    else v = cleanText(raw, LIMITS.value.custom);
    if (v) values[f.key] = v;
    else if (f.required || f.key === "email") invalid.push(f.label);
  }
  return { values, consent: body.consent === true, invalid };
}

// ── What an admin saves ───────────────────────────────────────────────────

export type FormSavePayload = {
  name: string;
  slug: string;
  status: FormStatus;
  title: string;
  intro: string;
  button_label: string;
  fields: FormField[];
  consent: FormConsent;
  after_submit: AfterSubmit;
};

export type SaveContext = {
  /** Topic keys the workspace has (config.marketing.topics). */
  topicKeys: string[];
  /** Hosts a redirect may go to: the workspace's own domain. */
  redirectHosts: string[];
};

/** The hosts a form may send a visitor on to after a submit: the tenant's own domain, nothing else. */
export function allowedRedirectHosts(t: { custom_domain?: string | null; is_demo?: boolean | null }, primaryHost: string): string[] {
  const hosts: string[] = [];
  const d = (t.custom_domain ?? "").trim().toLowerCase();
  if (d) hosts.push(d);
  // The demo sandbox lives on the primary host; no client tenant ever reaches it.
  if (t.is_demo === true) hosts.push(primaryHost.toLowerCase());
  return hosts;
}

/** An https URL on one of the allowed hosts, or "" . The query and fragment are dropped: nothing a visitor typed rides along. */
export function cleanRedirectUrl(v: unknown, hosts: string[]): string {
  if (typeof v !== "string" || !v.trim()) return "";
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (!hosts.includes(u.hostname.toLowerCase()) || u.port) return "";
    return `${u.origin}${u.pathname}`.slice(0, LIMITS.redirect);
  } catch {
    return "";
  }
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveResult = { ok: true; value: FormSavePayload; warnings: string[] } | { ok: false; error: string };

export function sanitizeFormSave(body: unknown, ctx: SaveContext, companyName: string): SaveResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Nothing to save" };
  const b = body as Record<string, unknown>;
  const warnings: string[] = [];

  const name = cleanText(b.name, LIMITS.name) || "Untitled form";
  const slug = slugify(typeof b.slug === "string" && b.slug.trim() ? b.slug : name);
  if (!isUsableSlug(slug)) return { ok: false, error: "The web address needs letters or numbers" };
  const status: FormStatus = (FORM_STATUSES as readonly string[]).includes(b.status as string) ? (b.status as FormStatus) : "draft";

  const incoming = Array.isArray(b.fields) ? (b.fields as Record<string, unknown>[]) : [];
  const fields: FormField[] = defaultFields().map((d) => {
    const f = incoming.find((x) => x && x.key === d.key);
    if (!f) return d;
    const label = cleanText(f.label, LIMITS.label) || FIELD_LABEL_DEFAULT[d.key];
    // Email is how a person is found again and how consent is attached to them: always on, always needed.
    if (d.key === "email") return { key: d.key, label, enabled: true, required: true };
    return { key: d.key, label, enabled: bool(f.enabled, d.enabled), required: bool(f.required, d.required) };
  });
  if (!fields.some((f) => f.enabled && f.key !== "email")) warnings.push("The form only asks for an email address.");

  const c = (b.consent && typeof b.consent === "object" ? b.consent : {}) as Record<string, unknown>;
  let text = cleanText(c.text, LIMITS.consentText);
  if (!text) text = "";
  const topics = Array.isArray(c.topics)
    ? [...new Set((c.topics as unknown[]).filter((t): t is string => typeof t === "string" && ctx.topicKeys.includes(t)))]
    : [];
  const consent: FormConsent = { text, topics, required: bool(c.required, false) };
  if (!consent.text) return { ok: false, error: "Write the words people agree to. The consent box is part of every form." };

  const a = (b.after_submit && typeof b.after_submit === "object" ? b.after_submit : {}) as Record<string, unknown>;
  const d = defaultAfterSubmit();
  const kind = a.kind === "redirect" ? "redirect" : "message";
  const redirect_url = kind === "redirect" ? cleanRedirectUrl(a.redirect_url, ctx.redirectHosts) : "";
  if (kind === "redirect" && !redirect_url) return { ok: false, error: "The page after sending must be a full https address on your own domain" };
  const notify_owner = bool(a.notify_owner, false);
  const notify_user_id = typeof a.notify_user_id === "string" && UUID.test(a.notify_user_id) ? a.notify_user_id : null;
  if (notify_owner && !notify_user_id) return { ok: false, error: "Choose who should be told about each new answer" };
  const after: AfterSubmit = {
    kind, message: cleanText(a.message, LIMITS.message) || d.message, redirect_url,
    thank_you_email: bool(a.thank_you_email, d.thank_you_email),
    thank_you_text: cleanText(a.thank_you_text, LIMITS.thankYou, { multiline: true }) || d.thank_you_text,
    notify_owner, notify_user_id,
    confirm_by_email: typeof a.confirm_by_email === "boolean" ? a.confirm_by_email : null,
  };

  return {
    ok: true, warnings,
    value: {
      name, slug, status,
      title: cleanText(b.title, LIMITS.title), intro: cleanText(b.intro, LIMITS.intro, { multiline: true }),
      button_label: cleanText(b.button_label, LIMITS.button) || "Send",
      fields, consent, after_submit: after,
    },
  };
}

/** What the tenant has put on the row, tolerant of old or hand-edited JSON. */
export function normaliseFields(raw: unknown): FormField[] {
  const incoming = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return defaultFields().map((d) => {
    const f = incoming.find((x) => x && x.key === d.key);
    if (!f) return d;
    return {
      key: d.key,
      label: cleanText(f.label, LIMITS.label) || FIELD_LABEL_DEFAULT[d.key],
      enabled: d.key === "email" ? true : bool(f.enabled, d.enabled),
      required: d.key === "email" ? true : bool(f.required, d.required),
    };
  });
}

export function normaliseConsent(raw: unknown): FormConsent {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    text: cleanText(c.text, LIMITS.consentText),
    topics: Array.isArray(c.topics) ? (c.topics as unknown[]).filter((t): t is string => typeof t === "string") : [],
    required: c.required === true,
  };
}

export function normaliseAfter(raw: unknown): AfterSubmit {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = defaultAfterSubmit();
  return {
    kind: a.kind === "redirect" ? "redirect" : "message",
    message: cleanText(a.message, LIMITS.message) || d.message,
    redirect_url: typeof a.redirect_url === "string" ? a.redirect_url.slice(0, LIMITS.redirect) : "",
    thank_you_email: bool(a.thank_you_email, d.thank_you_email),
    thank_you_text: cleanText(a.thank_you_text, LIMITS.thankYou, { multiline: true }) || d.thank_you_text,
    notify_owner: bool(a.notify_owner, false) && typeof a.notify_user_id === "string" && UUID.test(a.notify_user_id),
    notify_user_id: typeof a.notify_user_id === "string" && UUID.test(a.notify_user_id) ? a.notify_user_id : null,
    confirm_by_email: typeof a.confirm_by_email === "boolean" ? a.confirm_by_email : null,
  };
}

export { FORM_FIELD_KEYS };
