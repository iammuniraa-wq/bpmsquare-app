import type { PaymentTermMilestone, PaymentTermTemplate } from "@/lib/constants";
import { MILESTONE_LIMITS, type MilestoneInput } from "./milestones";

// Payment-term TEMPLATES (owner decision 2026-10-29). A workspace keeps a few named schedules in tenants.config.contract_projects; a
// tender's Bid tab picks one, the bid documents print it, the submitted bid version keeps a copy, and the contract project's billing
// schedule copies the one on the winning bid. PURE: no I/O and no server imports, so the settings route, the Bid tab, the documents and
// the tests read one set of rules. A template is data a workspace edits, never a code branch.

export const TERM_LIMITS = { maxTemplates: 20, maxMilestones: 12, nameMax: 80, titleMax: 80, triggerMax: 120 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const numberOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ParsedTemplates = { ok: true; templates: PaymentTermTemplate[] } | { ok: false; error: string };

/**
 * The shape check of a list of templates from a request body. A new template (no valid id) gets one from `newId`. Percent is 0 to 100,
 * a fixed amount 0 or more, every milestone needs a title, a template needs a name and at least one milestone, names are unique.
 */
export function parsePaymentTermTemplates(raw: unknown, newId: () => string): ParsedTemplates {
  if (!Array.isArray(raw)) return { ok: false, error: "The templates must be a list" };
  if (raw.length > TERM_LIMITS.maxTemplates) return { ok: false, error: `A workspace keeps up to ${TERM_LIMITS.maxTemplates} templates` };
  const out: PaymentTermTemplate[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const name = clean(o.name, TERM_LIMITS.nameMax);
    if (!name) return { ok: false, error: "Give every template a name" };
    if (seen.has(name.toLowerCase())) return { ok: false, error: `Two templates are called "${name}"` };
    seen.add(name.toLowerCase());
    const list = Array.isArray(o.milestones) ? o.milestones : [];
    if (list.length === 0) return { ok: false, error: `"${name}" needs at least one milestone` };
    if (list.length > TERM_LIMITS.maxMilestones) return { ok: false, error: `A template holds up to ${TERM_LIMITS.maxMilestones} milestones` };
    const milestones: PaymentTermMilestone[] = [];
    for (const m of list) {
      const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const title = clean(x.title, TERM_LIMITS.titleMax);
      if (!title) return { ok: false, error: `Give every milestone of "${name}" a title` };
      const basis = x.basis === "fixed" ? "fixed" : "percent";
      const value = numberOf(basis === "percent" ? x.percent : x.fixed_amount);
      if (value === null) return { ok: false, error: `"${title}" needs ${basis === "percent" ? "a percent" : "an amount"}` };
      if (basis === "percent" && (value < 0 || value > 100)) return { ok: false, error: `"${title}": a percent is from 0 to 100` };
      if (basis === "fixed" && (value < 0 || value > MILESTONE_LIMITS.amountMax)) return { ok: false, error: `"${title}": an amount is 0 or more` };
      milestones.push({ title, basis, percent: basis === "percent" ? round2(value) : null, fixed_amount: basis === "fixed" ? round2(value) : null, trigger: clean(x.trigger, TERM_LIMITS.triggerMax) });
    }
    out.push({ id: typeof o.id === "string" && UUID.test(o.id) ? o.id : newId(), name, milestones });
  }
  return { ok: true, templates: out };
}

/** The templates a stored config holds, tolerant of anything malformed (a bad entry is left out, never thrown on). */
export function readPaymentTermTemplates(config: { contract_projects?: { payment_term_templates?: unknown } } | null | undefined): PaymentTermTemplate[] {
  const raw = config?.contract_projects?.payment_term_templates;
  if (!Array.isArray(raw)) return [];
  const parsed: PaymentTermTemplate[] = [];
  for (const t of raw) {
    const one = parsePaymentTermTemplates([t], () => "");
    if (one.ok && one.templates[0].id) parsed.push(one.templates[0]);
  }
  return parsed;
}

/** What is saved on a tender and on its submitted bid version: the template as it read when it was chosen, so a later edit to the template never changes a bid. */
export type PaymentTermsChoice = { template_id: string; name: string; milestones: PaymentTermMilestone[]; chosen_at: string };

export function choiceFrom(template: PaymentTermTemplate, now: Date): PaymentTermsChoice {
  return { template_id: template.id, name: template.name, milestones: template.milestones, chosen_at: now.toISOString() };
}

/** Reads a stored choice back (jsonb: only a well-formed one, only the known fields). */
export function parseChoice(raw: unknown): PaymentTermsChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const one = parsePaymentTermTemplates([{ id: o.template_id, name: o.name, milestones: o.milestones }], () => "");
  if (!one.ok || typeof o.template_id !== "string") return null;
  return { template_id: o.template_id, name: one.templates[0].name, milestones: one.templates[0].milestones, chosen_at: typeof o.chosen_at === "string" ? o.chosen_at : "" };
}

/** One printable line per milestone for a bid document: "30% on award", "50,000 on delivery". */
export function termLines(milestones: readonly PaymentTermMilestone[], money: (n: number) => string = (n) => String(n)): string[] {
  return milestones.map((m) => {
    const share = m.basis === "percent" ? `${m.percent ?? 0}%` : money(m.fixed_amount ?? 0);
    return `${m.title}: ${share}${m.trigger ? `, ${m.trigger}` : ""}`;
  });
}

/** The percent milestones total, so a template can say when it does not add up to 100. */
export const percentTotal = (milestones: readonly PaymentTermMilestone[]): number => round2(milestones.reduce((s, m) => s + (m.basis === "percent" ? m.percent ?? 0 : 0), 0));

/** A template milestone as a billing-schedule milestone: the trigger text becomes the note, there is no date yet. */
export function toMilestoneInput(m: PaymentTermMilestone): MilestoneInput {
  return { title: m.title, due_date: null, basis: m.basis, percent: m.percent, fixed_amount: m.fixed_amount, note: m.trigger ? m.trigger.slice(0, MILESTONE_LIMITS.noteMax) : null };
}
