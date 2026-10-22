import { DEFAULT_QUOTE_STATUSES, QUOTE_TYPES, type QuoteStatusDef, type QuoteTypeId, type TenantFeatures } from "@/lib/constants";
import type { EmailTemplate, EmailTemplateCategory, FragmentCategory, TextFragment } from "@/lib/types";
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_VARS } from "@/lib/emailTemplates";
import type { QuotationTab } from "@/lib/settingsFolded";

// Pure rules behind Settings > Quotations (batch S3 of docs/design/settings-simplification.md), kept out of the
// components so they can be tested without a browser.

// ── Tabs ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Statuses, offer types and templates belong to Quotations; Print belongs to Assets (it fills the equipment block). */
export function quotationTabs(features: Partial<TenantFeatures> | undefined): QuotationTab[] {
  const out: QuotationTab[] = [];
  if (features?.quotations === true) out.push("statuses", "types", "templates");
  if (features?.assets === true) out.push("print");
  return out;
}

// ── Statuses ────────────────────────────────────────────────────────────────────────────────────────────────────

export const STATUS_COLOURS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#ef4444",
  "#f59e0b", "#0ea5e9", "#ec4899", "#14b8a6",
  "#f97316", "#6366f1", "#84cc16", "#64748b",
] as const;

/** The stored key follows the name once, at creation, and then never changes: it sits on every quote with this status. */
export function statusKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "status";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** A new open status lands before the closed ones, where the pipeline expects it. */
export function addStatus(list: QuoteStatusDef[], draft: { label: string; color: string }): { list: QuoteStatusDef[] } | { error: string } {
  const label = draft.label.trim();
  if (!label) return { error: "Give the status a name." };
  if (list.some((s) => s.label.trim().toLowerCase() === label.toLowerCase())) return { error: "A status with this name already exists." };
  const next: QuoteStatusDef = { value: statusKey(label, list.map((s) => s.value)), label, color: draft.color };
  const firstClosed = list.findIndex((s) => s.is_closed);
  const at = firstClosed < 0 ? list.length : firstClosed;
  return { list: [...list.slice(0, at), next, ...list.slice(at)] };
}

export function patchStatus(list: QuoteStatusDef[], value: string, patch: Partial<QuoteStatusDef>): QuoteStatusDef[] {
  return list.map((s) => (s.value === value ? { ...s, ...patch } : s));
}

export function makeDefaultStatus(list: QuoteStatusDef[], value: string): QuoteStatusDef[] {
  return list.map((s) => ({ ...s, is_initial: s.value === value }));
}

export function moveStatus(list: QuoteStatusDef[], value: string, by: -1 | 1): QuoteStatusDef[] {
  const i = list.findIndex((s) => s.value === value);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** The default cannot go (new quotes need somewhere to start), nor the last one left. */
export function canRemoveStatus(list: QuoteStatusDef[], s: QuoteStatusDef): boolean {
  return list.length > 1 && !s.is_initial;
}

export function removeStatus(list: QuoteStatusDef[], value: string): QuoteStatusDef[] {
  const s = list.find((x) => x.value === value);
  return s && canRemoveStatus(list, s) ? list.filter((x) => x.value !== value) : list;
}

/** What the server would refuse, said before the round trip. */
export function statusProblem(list: QuoteStatusDef[]): string | null {
  if (list.length < 1) return "Keep at least one status.";
  if (list.some((s) => !s.label.trim())) return "Every status needs a name.";
  if (list.filter((s) => s.is_initial).length !== 1) return "Exactly one status must be the default.";
  if (!list.some((s) => s.is_closed)) return "Mark at least one status as closed, or a quote can never be closed.";
  return null;
}

// ── Offer types ─────────────────────────────────────────────────────────────────────────────────────────────────

export type TypeVisibility = Record<QuoteTypeId, boolean>;

/** Stored map to a full one: a type is shown unless it was explicitly hidden. */
export function typeVisibility(stored: Partial<Record<string, boolean>> | null | undefined): TypeVisibility {
  const out = {} as TypeVisibility;
  for (const t of QUOTE_TYPES) out[t.id as QuoteTypeId] = stored?.[t.id] !== false;
  return out;
}

// ── Print ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PrintField = { value: string; label: string };

export const EQUIPMENT_FIELDS: PrintField[] = [
  { value: "name", label: "Equipment name" },
  { value: "kind", label: "Type" },
  { value: "make", label: "Make / OEM" },
  { value: "model", label: "Model / Frame" },
  { value: "rating", label: "Rating" },
  { value: "rpm", label: "RPM" },
  { value: "serial", label: "Serial no." },
  { value: "notes", label: "Remarks" },
];

// Motor and generator nameplate fields, see FIELD_REGISTRY.asset in src/lib/fieldRegistry.ts.
export const NAMEPLATE_FIELDS: PrintField[] = [
  { value: "frame_type", label: "Frame / Type" },
  { value: "insulation_class", label: "Insulation class" },
  { value: "connection", label: "Connection" },
  { value: "duty", label: "Duty" },
  { value: "ambient_temp", label: "Ambient temp." },
  { value: "output_kw", label: "Output (kW)" },
  { value: "stator_voltage", label: "Stator voltage" },
  { value: "stator_current", label: "Stator current" },
  { value: "excitation_voltage", label: "Excitation voltage" },
  { value: "excitation_current", label: "Excitation current" },
  { value: "frequency", label: "Frequency" },
];

export function togglePrintField(fields: string[], value: string): string[] {
  return fields.includes(value) ? fields.filter((f) => f !== value) : [...fields, value];
}

/** The nameplate group stays folded unless one of its fields is already printing. */
export function nameplateOpen(fields: string[]): boolean {
  return NAMEPLATE_FIELDS.some((f) => fields.includes(f.value));
}

// ── Templates: text and email as one list ───────────────────────────────────────────────────────────────────────

export type TemplateKind = FragmentCategory | `email_${EmailTemplateCategory}`;

export const TEMPLATE_KINDS: { id: TemplateKind; label: string }[] = [
  { id: "line_item", label: "Line item" },
  { id: "notes", label: "Notes" },
  { id: "terms", label: "Terms" },
  { id: "sow", label: "Scope of work" },
  { id: "email_quote", label: "Email: quotation" },
  { id: "email_invoice", label: "Email: invoice" },
  { id: "email_rfq", label: "Email: supplier RFQ" },
  { id: "email_report", label: "Email: inspection report" },
];

// Only these emails are sent today; an inspection report email can still be listed if one already exists.
const NOT_LIVE: TemplateKind[] = ["email_report"];

/** What a new template can be: every kind that does something. */
export const NEW_TEMPLATE_KINDS = TEMPLATE_KINDS.filter((k) => !NOT_LIVE.includes(k.id));

export const kindLabel = (kind: TemplateKind): string => TEMPLATE_KINDS.find((k) => k.id === kind)?.label ?? kind;
export const isEmailKind = (kind: TemplateKind): kind is `email_${EmailTemplateCategory}` => kind.startsWith("email_");
export const emailCategory = (kind: TemplateKind): EmailTemplateCategory => kind.slice("email_".length) as EmailTemplateCategory;

export type TemplateRow = {
  /** `text:<id>` or `email:<id>`: the two tables share no id space. */
  key: string;
  id: string;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  isDefault: boolean;
};

export const textRow = (f: TextFragment): TemplateRow => ({ key: `text:${f.id}`, id: f.id, kind: f.category, name: f.label, subject: "", body: f.text, isDefault: false });
export const emailRow = (t: EmailTemplate): TemplateRow => ({ key: `email:${t.id}`, id: t.id, kind: `email_${t.category}`, name: t.name, subject: t.subject, body: t.body, isDefault: t.is_default });

export function templateRows(fragments: TextFragment[], emails: EmailTemplate[]): TemplateRow[] {
  const order = (r: TemplateRow) => TEMPLATE_KINDS.findIndex((k) => k.id === r.kind);
  return [...fragments.map(textRow), ...emails.map(emailRow)].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

export type KindFilter = "all" | FragmentCategory | "email";
export const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "line_item", label: "Line item" },
  { id: "notes", label: "Notes" },
  { id: "terms", label: "Terms" },
  { id: "sow", label: "Scope" },
  { id: "email", label: "Email" },
];

export function filterTemplates(rows: TemplateRow[], filter: KindFilter): TemplateRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => (filter === "email" ? isEmailKind(r.kind) : r.kind === filter));
}

export const ROW_LIMIT = 8;
/** A long list shows its first rows and a "Show all" (bpmsquarecore 6b). */
export function shownRows<T>(rows: T[], showAll: boolean, limit = ROW_LIMIT): { rows: T[]; hidden: number } {
  if (showAll || rows.length <= limit) return { rows, hidden: 0 };
  return { rows: rows.slice(0, limit), hidden: rows.length - limit };
}

export type TemplateDraft = { id: string | null; kind: TemplateKind; name: string; subject: string; body: string; isDefault: boolean };

export function blankTemplate(kind: TemplateKind = "line_item"): TemplateDraft {
  return { id: null, kind, name: "", subject: "", body: "", isDefault: false };
}

/** What a new template of this kind starts with: the built-in text for an email, nothing for a saved text. */
export function startingText(kind: TemplateKind): { subject: string; body: string } {
  if (!isEmailKind(kind)) return { subject: "", body: "" };
  const d = DEFAULT_EMAIL_TEMPLATES[emailCategory(kind)];
  return { subject: d.subject, body: d.body };
}

/** New: any live kind. Saved: an email keeps its kind (it belongs to one send path), a text may move between text kinds. */
export function kindOptions(d: TemplateDraft): { id: TemplateKind; label: string }[] {
  if (d.id === null) return NEW_TEMPLATE_KINDS;
  return isEmailKind(d.kind) ? [{ id: d.kind, label: kindLabel(d.kind) }] : NEW_TEMPLATE_KINDS.filter((k) => !isEmailKind(k.id));
}

/** Switching kind on a new template swaps the starting text, but never over something the person typed. */
export function withKind(d: TemplateDraft, kind: TemplateKind): TemplateDraft {
  const untouched = d.id === null && d.body.trim() === startingText(d.kind).body.trim();
  return untouched ? { ...d, kind, ...startingText(kind) } : { ...d, kind };
}

export const draftOfRow = (r: TemplateRow): TemplateDraft => ({ id: r.id, kind: r.kind, name: r.name, subject: r.subject, body: r.body, isDefault: r.isDefault });

export function templateProblem(d: TemplateDraft): string | null {
  if (!d.name.trim()) return "Give the template a name.";
  if (isEmailKind(d.kind) && !d.subject.trim()) return "An email needs a subject.";
  if (!d.body.trim()) return "The text cannot be empty.";
  return null;
}

/** The endpoint call that stores a draft: text templates and emails are two tables behind two routes. */
export function planTemplateSave(d: TemplateDraft): { url: string; method: "POST" | "PATCH"; body: Record<string, unknown> } {
  if (isEmailKind(d.kind)) {
    const category = emailCategory(d.kind);
    return d.id === null
      ? { url: "/api/settings/email-templates", method: "POST", body: { name: d.name.trim(), subject: d.subject, body: d.body, category, is_default: d.isDefault } }
      : { url: `/api/settings/email-templates/${d.id}`, method: "PATCH", body: { name: d.name.trim(), subject: d.subject, body: d.body, ...(d.isDefault ? { is_default: true } : {}) } };
  }
  return d.id === null
    ? { url: "/api/settings/templates", method: "POST", body: { label: d.name.trim(), category: d.kind, text: d.body } }
    : { url: `/api/settings/templates/${d.id}`, method: "PATCH", body: { label: d.name.trim(), category: d.kind, text: d.body } };
}

export const templateDeleteUrl = (r: TemplateRow): string =>
  isEmailKind(r.kind) ? `/api/settings/email-templates/${r.id}` : `/api/settings/templates/${r.id}`;

/** Placeholders an email of this kind understands, as `{{key}}`. */
export function placeholders(kind: TemplateKind): string[] {
  return isEmailKind(kind) ? EMAIL_TEMPLATE_VARS[emailCategory(kind)].map((v) => `{{${v.key}}}`) : [];
}

/** One default per email kind: saving a default clears the old one. */
export function applySavedEmail(rows: TemplateRow[], saved: TemplateRow): TemplateRow[] {
  const cleared = saved.isDefault && isEmailKind(saved.kind) ? rows.map((r) => (r.kind === saved.kind ? { ...r, isDefault: false } : r)) : rows;
  const at = cleared.findIndex((r) => r.key === saved.key);
  const next = at >= 0 ? cleared.map((r, i) => (i === at ? saved : r)) : [...cleared, saved];
  const order = (r: TemplateRow) => TEMPLATE_KINDS.findIndex((k) => k.id === r.kind);
  return next.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

// ── One draft, one Save for statuses, offer types and print ────────────────────────────────────────────────────

export type QuotationsDraft = { statuses: QuoteStatusDef[]; types: TypeVisibility; print: string[] };

export function draftFrom(statuses: QuoteStatusDef[] | null, visibility: Partial<Record<string, boolean>> | null | undefined, print: string[]): QuotationsDraft {
  return { statuses: statuses ?? DEFAULT_QUOTE_STATUSES, types: typeVisibility(visibility), print };
}

export type SaveStep = { id: "statuses" | "types" | "print"; url: string; method: "PUT" | "PATCH"; body: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the groups that changed are sent, to the routes the old pages used. */
export function planQuotationsSave(initial: QuotationsDraft, draft: QuotationsDraft): SaveStep[] {
  const steps: SaveStep[] = [];
  if (!same(initial.statuses, draft.statuses)) steps.push({ id: "statuses", url: "/api/settings/quote-statuses", method: "PUT", body: draft.statuses });
  if (!same(initial.types, draft.types)) steps.push({ id: "types", url: "/api/settings/entities", method: "PATCH", body: { quote_type_visibility: draft.types } });
  if (!same(initial.print, draft.print)) steps.push({ id: "print", url: "/api/settings/asset-print-fields", method: "PUT", body: draft.print });
  return steps;
}

export const quotationsDirty = (initial: QuotationsDraft, draft: QuotationsDraft): boolean => planQuotationsSave(initial, draft).length > 0;
