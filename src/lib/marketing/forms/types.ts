// Forms (0170, docs/shells/forms-shell.md). Pure: shared by the public page, the
// builder and the server. Nothing here imports server-only code.

/** The small fixed set the shell offers. Three free-text questions on top of the five standard fields. */
export const FORM_FIELD_KEYS = ["name", "company", "email", "phone", "message", "custom1", "custom2", "custom3"] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

export type FormField = { key: FormFieldKey; label: string; required: boolean; enabled: boolean };
export type FormConsent = { text: string; topics: string[]; required: boolean };
export type AfterSubmit = { kind: "message" | "redirect"; message: string; redirect_url: string };

export const FORM_STATUSES = ["draft", "live", "archived"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const LIMITS = {
  name: 120,
  slug: 60,
  title: 120,
  intro: 400,
  button: 40,
  label: 60,
  consentText: 600,
  message: 300,
  redirect: 500,
  value: { name: 120, company: 160, email: 254, phone: 24, message: 2000, custom: 300 },
  /** Whole request body, in bytes. The longest legitimate submit is a few KB. */
  bodyBytes: 16_000,
  /** Seconds a person needs to fill a form in; a faster post is a script. */
  minSeconds: 3,
  /** A form left open longer than this is asked to be reloaded. */
  maxAgeSeconds: 24 * 60 * 60,
  /** Submits per visitor per form per hour that reach the database. */
  perHour: 5,
  retentionDays: 180,
} as const;

/** The name of the hidden trap field. A real visitor never sees or fills it. */
export const HONEYPOT_FIELD = "company_website";

export const FIELD_LABEL_DEFAULT: Record<FormFieldKey, string> = {
  name: "Your name", company: "Company", email: "Email", phone: "Phone", message: "How can we help?",
  custom1: "Question 1", custom2: "Question 2", custom3: "Question 3",
};

/** A new form: name, company, email and message on; the rest off. Email is always on and required. */
export function defaultFields(): FormField[] {
  return FORM_FIELD_KEYS.map((key) => ({
    key,
    label: FIELD_LABEL_DEFAULT[key],
    required: key === "email" || key === "name",
    enabled: key === "name" || key === "company" || key === "email" || key === "message",
  }));
}

export function defaultConsentText(companyName: string): string {
  const who = companyName.trim() || "us";
  return `I agree to receive news and offers from ${who} by email. I can change my mind at any time.`;
}

export function defaultAfterSubmit(): AfterSubmit {
  return { kind: "message", message: "Thank you. We have your message and will be in touch soon.", redirect_url: "" };
}

export type FormRow = {
  id: string;
  tenant_id: string;
  ref: string | null;
  name: string;
  slug: string;
  public_key: string;
  status: FormStatus;
  title: string | null;
  intro: string | null;
  button_label: string | null;
  fields: FormField[];
  consent: FormConsent;
  after_submit: AfterSubmit;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** What a visitor's browser is given. No tenant id, no internal column. */
export type PublicForm = {
  key: string;
  title: string;
  intro: string;
  button: string;
  fields: { key: FormFieldKey; label: string; required: boolean }[];
  consent: { text: string; required: boolean };
  /** Signed render time, sent back with the submit so the server can tell how long the form was open. */
  renderToken: string;
};

export type SubmitOutcome =
  | { ok: true; after: { kind: "message"; message: string } | { kind: "redirect"; url: string } }
  | { ok: false; error: string; fields?: string[] };
