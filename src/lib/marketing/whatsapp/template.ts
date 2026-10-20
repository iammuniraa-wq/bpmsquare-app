// WhatsApp templates: the object's vocabulary, validation and rendering. Pure (importable from client
// components): nothing here touches a database.

export const TEMPLATE_STATUSES = ["draft", "approved", "rejected", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const STATUS_LABEL: Record<TemplateStatus, string> = { draft: "Draft", approved: "Approved", rejected: "Rejected", archived: "Archived" };

export const CATEGORIES = ["marketing", "utility", "authentication"] as const;
export type TemplateCategory = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<TemplateCategory, string> = { marketing: "Marketing", utility: "Utility (order or service updates)", authentication: "Authentication" };
export const CATEGORY_HINT: Record<TemplateCategory, string> = {
  marketing: "Offers, news and reminders to sell. Counts toward the weekly limit per person.",
  utility: "Updates about something the person already asked for or bought.",
  authentication: "One-time codes. Not used by journeys.",
};

/** The only variables a body may use. A closed list, so a body can never ask for a field we do not fill. */
export const TEMPLATE_VARIABLES = [
  { key: "contact_name", label: "Contact name", sample: "Omar", fallback: "there" },
  { key: "account_name", label: "Company name", sample: "Gulf Precast", fallback: "your company" },
  { key: "company_name", label: "Your company", sample: "Your Company", fallback: "our team" },
  { key: "quote_ref", label: "Quote number", sample: "SQ-0042", fallback: "your quote" },
  { key: "amount", label: "Amount", sample: "12,500", fallback: "the amount" },
] as const;
export type VariableKey = (typeof TEMPLATE_VARIABLES)[number]["key"];
const VARIABLE_KEYS: ReadonlySet<string> = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

export const LIMITS = { name: 80, body: 1024, reason: 200 } as const;
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" }, { code: "ar", label: "Arabic" }, { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" }, { code: "fr", label: "French" },
];

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The variables a body uses, in order of first appearance (that order is the provider's {{1}}, {{2}}...). */
export function variablesOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export type BodyCheck = { ok: true; variables: VariableKey[] } | { ok: false; error: string };

/** The rules WhatsApp enforces on a body that we can check without a provider, in plain words. */
export function checkBody(raw: unknown): BodyCheck {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "Write the message." };
  if (body.length > LIMITS.body) return { ok: false, error: `Keep the message under ${LIMITS.body} characters.` };
  const used = variablesOf(body);
  const unknown = used.find((v) => !VARIABLE_KEYS.has(v));
  if (unknown) return { ok: false, error: `"{{${unknown}}}" is not one of the details we can fill in. Use the list on the left.` };
  if (/^\s*\{\{[^}]*\}\}/.test(body) || /\{\{[^}]*\}\}\s*$/.test(body)) {
    return { ok: false, error: "WhatsApp does not accept a message that starts or ends with a detail. Add a few words before and after it." };
  }
  if (/\{\{[^}]*\}\}\s*\{\{[^}]*\}\}/.test(body)) return { ok: false, error: "Two details cannot sit side by side. Put a word between them." };
  return { ok: true, variables: used as VariableKey[] };
}

export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
}

export type TemplateSave = {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  topic: string | null;
  provider_template_name: string | null;
};

/** The closed shape a template save must have. Unknown keys are dropped, bad values are errors. */
export function sanitizeTemplate(input: unknown, topicKeys: string[]): { ok: true; value: TemplateSave } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = cleanText(o.name, LIMITS.name);
  if (!name) return { ok: false, error: "Give the template a name." };
  const language = typeof o.language === "string" && /^[a-z]{2}$/.test(o.language) ? o.language : "en";
  const category = (CATEGORIES as readonly string[]).includes(o.category as string) ? (o.category as TemplateCategory) : "marketing";
  const body = typeof o.body === "string" ? o.body.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, "").trim() : "";
  const checked = checkBody(body);
  if (!checked.ok) return checked;
  const topic = typeof o.topic === "string" && o.topic && topicKeys.includes(o.topic) ? o.topic : null;
  const pn = cleanText(o.provider_template_name, 80).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return { ok: true, value: { name, language, category, body, topic, provider_template_name: pn || null } };
}

export type Values = Partial<Record<VariableKey, string | null | undefined>>;

/** The message as the person reads it, and the positional values the provider takes. */
export function renderTemplate(body: string, values: Values): { text: string; params: string[] } {
  const order = variablesOf(body);
  const value = (key: string): string => {
    const v = (values as Record<string, string | null | undefined>)[key];
    const fb = TEMPLATE_VARIABLES.find((x) => x.key === key)?.fallback ?? "";
    // A value goes into a one-line slot: no newlines, no runs of spaces (the provider rejects them).
    return (typeof v === "string" && v.trim() ? v : fb).replace(/\s+/g, " ").trim().slice(0, 120);
  };
  const text = body.replace(VAR_RE, (_m, k: string) => value(k));
  return { text, params: order.map(value) };
}

export const sampleValues = (): Values => Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample])) as Values;
