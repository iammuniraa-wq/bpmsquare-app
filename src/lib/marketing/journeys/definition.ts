import { isKnownEvent } from "@/lib/events/catalog";
import {
  CONDITION_OPS, MAX_LOOKBACK_DAYS, MAX_STEPS,
  type Condition, type JourneyDefinition, type JourneyStep,
} from "./types";

// Validation, templates and plain-words descriptions of a journey definition.
// Pure: the routes call sanitizeJourney() on every write, and the runner calls
// it again on every definition it loads, because a stored definition can be
// older than the code that reads it.

/** The events a journey may start from, in the words a person sees. Only events that carry a person or a company. */
export const TRIGGERS: { event: string; label: string; hint: string }[] = [
  { event: "quote.sent", label: "A quote is sent", hint: "When a quote or standard quote is emailed to the customer." },
  { event: "quote.accepted", label: "A quote is accepted", hint: "When the customer accepts a quote." },
  { event: "opportunity.created", label: "A deal is created", hint: "When a new deal is added to the pipeline." },
  { event: "opportunity.closed", label: "A deal is closed", hint: "When a deal is won or lost." },
  { event: "case.closed", label: "A service case is closed", hint: "When a case is finished." },
  { event: "invoice.paid", label: "An invoice is paid", hint: "When a customer pays an invoice." },
  { event: "contract.expiring", label: "An AMC contract is close to expiring", hint: "About 90 and 30 days before the end date." },
  { event: "lead.created", label: "A lead is created", hint: "When a new lead is added." },
  { event: "form.submitted", label: "Someone fills in a form", hint: "When a website or event form is submitted." },
];

export const triggerLabel = (event: string): string => TRIGGERS.find((t) => t.event === event)?.label ?? event.replace(/[._]/g, " ");

/** What a person can narrow the start by. Anything else is refused. */
export const CONDITION_FIELDS: { field: string; label: string; kind: "choice" | "amount"; choices?: { value: string; label: string }[] }[] = [
  { field: "object_type", label: "The kind of quote", kind: "choice", choices: [{ value: "standard_quote", label: "A Standard Quote" }] },
  { field: "payload.total", label: "The amount", kind: "amount" },
];

const FIELD_RE = /^(object_type|payload\.[a-z_]{1,30})$/;

export function sanitizeCondition(raw: unknown): Condition {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const field = typeof o.field === "string" ? o.field : "";
  const op = typeof o.op === "string" ? o.op : "";
  if (!FIELD_RE.test(field) || !(CONDITION_OPS as readonly string[]).includes(op)) return null;
  let value: string | number;
  if (typeof o.value === "number" && Number.isFinite(o.value)) value = o.value;
  else if (typeof o.value === "string" && o.value.trim() && o.value.length <= 80) value = o.value.trim();
  else return null;
  return { field, op: op as NonNullable<Condition>["op"], value };
}

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SanitizeResult = { ok: true; definition: JourneyDefinition } | { ok: false; errors: string[] };

/** The closed shape every stored definition must have. Unknown keys are dropped, bad values are errors, never guesses. */
export function sanitizeJourney(input: unknown): SanitizeResult {
  const errors: string[] = [];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const trig = (o.trigger && typeof o.trigger === "object" ? o.trigger : {}) as Record<string, unknown>;
  const event = typeof trig.event === "string" ? trig.event : "";
  if (!isKnownEvent(event)) errors.push("Pick what starts the journey.");
  else if (!TRIGGERS.some((t) => t.event === event)) errors.push("That event cannot start a journey.");

  const entryIn = (o.entry && typeof o.entry === "object" ? o.entry : {}) as Record<string, unknown>;
  const entry = {
    one_per_account: entryIn.one_per_account !== false,
    pause_when_in_trouble: entryIn.pause_when_in_trouble !== false,
    lookback_days: clampInt(entryIn.lookback_days, 0, MAX_LOOKBACK_DAYS, 3),
  };

  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  if (rawSteps.length > MAX_STEPS) errors.push(`A journey can have at most ${MAX_STEPS} steps.`);
  const steps: JourneyStep[] = [];
  const seen = new Set<string>();
  rawSteps.slice(0, MAX_STEPS).forEach((raw, i) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    let id = typeof s.id === "string" && /^[a-z0-9_]{1,20}$/.test(s.id) ? s.id : `s${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    switch (s.kind) {
      case "wait": {
        const unit = s.unit === "hours" ? "hours" : "days";
        steps.push({ id, kind: "wait", unit, amount: clampInt(s.amount, 1, unit === "hours" ? 720 : 90, 1) });
        break;
      }
      case "send_newsletter": {
        const v = typeof s.newsletter_version_id === "string" && UUID.test(s.newsletter_version_id) ? s.newsletter_version_id : null;
        const languages = Array.isArray(s.languages) ? s.languages.filter((l): l is string => typeof l === "string" && /^[a-z]{2}$/.test(l)).slice(0, 8) : [];
        const fb = typeof s.fallback_language === "string" && /^[a-z]{2}$/.test(s.fallback_language) ? s.fallback_language : "en";
        const topic = typeof s.topic === "string" && /^[a-z0-9_]{1,40}$/.test(s.topic) ? s.topic : null;
        steps.push({ id, kind: "send_newsletter", newsletter_version_id: v, topic, languages, fallback_language: fb });
        break;
      }
      case "send_whatsapp": {
        const t = typeof s.template_id === "string" && UUID.test(s.template_id) ? s.template_id : null;
        steps.push({ id, kind: "send_whatsapp", template_id: t });
        break;
      }
      case "create_task": {
        const title = text(s.title, 120);
        if (!title) errors.push(`Step ${i + 1}: say what the task is.`);
        steps.push({ id, kind: "create_task", title: title || "Follow up", due_in_days: clampInt(s.due_in_days, 0, 60, 1) });
        break;
      }
      case "notify_owner": {
        const t = text(s.text, 200);
        if (!t) errors.push(`Step ${i + 1}: say what the owner should be told.`);
        steps.push({ id, kind: "notify_owner", text: t || "Follow up" });
        break;
      }
      case "end":
        steps.push({ id, kind: "end" });
        break;
      default:
        errors.push(`Step ${i + 1}: unknown kind of step.`);
    }
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: { version: 1, trigger: { event, condition: sanitizeCondition(trig.condition) }, entry, steps } };
}

/** What stops a journey being turned on: plain sentences, empty when it is ready. */
export function readinessProblems(def: JourneyDefinition): string[] {
  const out: string[] = [];
  if (def.steps.length === 0) out.push("Add at least one step.");
  def.steps.forEach((s, i) => {
    if (s.kind === "send_newsletter" && !s.newsletter_version_id) out.push(`Step ${i + 1}: choose which newsletter version to send.`);
    if (s.kind === "send_whatsapp" && !s.template_id) out.push(`Step ${i + 1}: choose which WhatsApp template to send.`);
  });
  return out;
}

// ── Templates ─────────────────────────────────────────────────────────────────

export const TEMPLATES: { id: string; name: string; hint: string; build: () => JourneyDefinition }[] = [
  {
    id: "quote_follow_up",
    name: "Quote follow-up",
    hint: "A Standard Quote is sent. Three days later the customer gets your newsletter version, and the owner gets a task to call.",
    build: () => ({
      version: 1,
      trigger: { event: "quote.sent", condition: { field: "object_type", op: "eq", value: "standard_quote" } },
      entry: { one_per_account: true, pause_when_in_trouble: true, lookback_days: 3 },
      steps: [
        { id: "s1", kind: "wait", amount: 3, unit: "days" },
        { id: "s2", kind: "send_newsletter", newsletter_version_id: null, topic: "offers", languages: [], fallback_language: "en" },
        { id: "s3", kind: "create_task", title: "Call {contact_name} about quote {quote_ref}", due_in_days: 1 },
      ],
    }),
  },
  {
    id: "blank",
    name: "Blank",
    hint: "Start with nothing and add the steps yourself.",
    build: () => ({
      version: 1,
      trigger: { event: "quote.sent", condition: null },
      entry: { one_per_account: true, pause_when_in_trouble: true, lookback_days: 3 },
      steps: [],
    }),
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;

// ── Words ─────────────────────────────────────────────────────────────────────

export function describeCondition(c: Condition): string {
  if (!c) return "";
  const f = CONDITION_FIELDS.find((x) => x.field === c.field);
  if (c.field === "object_type") return c.op === "neq" ? `not ${f?.choices?.find((x) => x.value === c.value)?.label ?? String(c.value)}` : (f?.choices?.find((x) => x.value === c.value)?.label ?? String(c.value));
  const word = { eq: "is", neq: "is not", gte: "is at least", lte: "is at most", contains: "contains" }[c.op];
  return `${f?.label?.toLowerCase() ?? c.field.replace("payload.", "")} ${word} ${c.value}`;
}

export function describeStep(s: JourneyStep): string {
  switch (s.kind) {
    case "wait": return `Wait ${s.amount} ${s.unit === "hours" ? (s.amount === 1 ? "hour" : "hours") : (s.amount === 1 ? "day" : "days")}`;
    case "send_newsletter": return "Send a newsletter version";
    case "send_whatsapp": return "Send a WhatsApp template";
    case "create_task": return `Create a task for the owner: ${s.title}`;
    case "notify_owner": return `Tell the owner: ${s.text}`;
    case "end": return "End";
  }
}

export function waitMs(s: Extract<JourneyStep, { kind: "wait" }>): number {
  return s.amount * (s.unit === "hours" ? 3_600_000 : 86_400_000);
}

/** "Day 3" style offsets for each step, counting only waits. */
export function dayOffsets(steps: JourneyStep[]): number[] {
  let ms = 0;
  return steps.map((s) => {
    const at = ms;
    if (s.kind === "wait") ms += waitMs(s);
    return at / 86_400_000;
  });
}

export function fillTaskText(tpl: string, vals: { contact_name?: string; quote_ref?: string; account_name?: string }): string {
  return tpl
    .replace(/\{contact_name\}/g, vals.contact_name || "the contact")
    .replace(/\{quote_ref\}/g, vals.quote_ref || "")
    .replace(/\{account_name\}/g, vals.account_name || "the company")
    .replace(/\s+/g, " ").trim();
}
