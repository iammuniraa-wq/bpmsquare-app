import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEffectiveFieldConfig } from "@/lib/fieldConfig";
import { applyRules, type EffectiveField, type FieldRule } from "@/lib/fieldRegistry";
import { isUuid } from "@/lib/assistant/objects";
import type { CardDuplicate, CardField, CardWidget, ConfirmCard } from "@/lib/assistant/cards";
import { findAccountDuplicates, findContactDuplicates, type DuplicateHit } from "@/lib/assistant/duplicates";
import { redactPii } from "@/lib/changeLog";
import type { CreateActionDef, RefDef } from "./registry";
import { hashOf, signToken } from "./token";

// Turns "create an account Tesla Germany" into a card, and a pressed card back into the exact body the object's
// own route expects. The fields are the workspace's own field config (custom fields, renamed labels, hidden fields
// and show/require rules included), the same source the New form and Data Workbench read. Pure functions where
// they can be, so the checks that matter are unit-tested without a database.

export type SpecField = {
  key: string;
  label: string;
  widget: CardWidget;
  kind: "standard" | "custom" | "ref";
  /** Required whatever the rules say: the route refuses without it, or the field is required by definition. */
  baseRequired: boolean;
  options?: { value: string; label: string }[];
  format?: "email";
  ref?: RefDef;
};

export type Spec = { fields: SpecField[]; rules: FieldRule[] };

const MAX_TEXT = 2000;
const MAX_LONG = 5000;

function widgetOf(f: EffectiveField): CardWidget {
  switch (f.widget) {
    case "textarea": return "textarea";
    case "enum": case "select": return "enum";
    case "date": return "date";
    case "number": return "number";
    case "checkbox": return "checkbox";
    default: return "text";
  }
}

function optionsOf(f: EffectiveField): { value: string; label: string }[] | undefined {
  if (f.widget === "enum" || (f.widget === "select" && f.enumOptions)) return f.enumOptions;
  if (f.options?.length) return f.options.map((o) => ({ value: o, label: o }));
  return undefined;
}

export async function loadSpec(supabase: SupabaseClient, tenantId: string, def: CreateActionDef): Promise<Spec> {
  const cfg = await getEffectiveFieldConfig(supabase, tenantId, def.registryType);
  const refFields: SpecField[] = def.refs.map((r) => ({ key: r.key, label: r.label, widget: "ref", kind: "ref", baseRequired: r.required, ref: r }));
  const refKeys = new Set(def.refs.map((r) => r.key));
  const fields: SpecField[] = cfg.sections
    .flatMap((s) => s.fields)
    // What the New form lets a person type: editable, not a computed column, not hidden by the workspace.
    .filter((f) => f.editable !== false && !f.exportOnly && !f.hidden && !refKeys.has(f.field_key))
    .map((f) => ({
      key: f.field_key, label: f.label, widget: widgetOf(f), kind: f.kind,
      baseRequired: def.requiredKeys.includes(f.field_key) || f.required,
      options: optionsOf(f),
      format: f.widget === "email" ? "email" as const : undefined,
    }));
  // A key the route insists on that the field config does not list (a workspace cannot hide its way out of it).
  for (const k of def.requiredKeys) if (!refKeys.has(k) && !fields.some((f) => f.key === k)) {
    fields.unshift({ key: k, label: k, widget: "text", kind: "standard", baseRequired: true });
  }
  return { fields: [...refFields, ...fields], rules: cfg.rules };
}

/** Hash of what a card offers, not what it holds: the action, the route and every field with its type and options. */
export function structureHash(def: CreateActionDef, spec: Spec): string {
  return hashOf({
    a: def.key, r: def.route,
    f: spec.fields.map((f) => [f.key, f.widget, f.baseRequired, (f.options ?? []).map((o) => o.value)]),
  });
}

export const hash8 = (s: string) => crypto.createHash("sha256").update(s).digest("base64url").slice(0, 8);

export function dupHash(hits: { id: string }[]): string {
  return hashOf(hits.map((h) => h.id).sort());
}

// ── value normalisation, shared by the card (lenient) and the press (strict) ──────────────────────────────────

export type Normalised = { ok: true; value: string } | { ok: false; error: string };

export function normaliseValue(f: SpecField, raw: unknown): Normalised {
  if (raw === null || raw === undefined) return { ok: true, value: "" };
  if (typeof raw === "object") return { ok: false, error: `${f.label} must be plain text` };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: "" };
  const max = f.widget === "textarea" ? MAX_LONG : MAX_TEXT;
  if (s.length > max) return { ok: false, error: `${f.label} is too long` };
  switch (f.widget) {
    case "enum": {
      const hit = f.options?.find((o) => o.value === s) ?? f.options?.find((o) => o.value.toLowerCase() === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase());
      return hit ? { ok: true, value: hit.value } : { ok: false, error: `${f.label}: "${s.slice(0, 40)}" is not one of the options` };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { ok: true, value: s } : { ok: false, error: `${f.label} must be a date (yyyy-mm-dd)` };
    case "number":
      return Number.isFinite(Number(s)) ? { ok: true, value: String(Number(s)) } : { ok: false, error: `${f.label} must be a number` };
    case "checkbox": {
      const t = s.toLowerCase();
      if (["true", "yes", "1", "on"].includes(t)) return { ok: true, value: "true" };
      if (["false", "no", "0", "off"].includes(t)) return { ok: true, value: "false" };
      return { ok: false, error: `${f.label} must be yes or no` };
    }
    case "ref":
      return isUuid(s) ? { ok: true, value: s } : { ok: false, error: `${f.label} was not chosen` };
    default:
      if (f.format === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { ok: false, error: `${f.label} is not an email address` };
      return { ok: true, value: s };
  }
}

/** Which fields are required for these values, after the workspace's show/require rules, and which are hidden by them. */
export function evaluateFields(spec: Spec, values: Record<string, string>): { required: Set<string>; hidden: Set<string> } {
  const required = new Set<string>();
  const hidden = new Set<string>();
  for (const f of spec.fields) {
    const r = applyRules(spec.rules, f.key, false, f.baseRequired, values);
    if (r.hidden && !f.baseRequired) hidden.add(f.key);
    else if (r.required || f.baseRequired) required.add(f.key);
  }
  return { required, hidden };
}

/** The request body the object's own route takes: standard keys on top, custom fields in custom_data. */
export function toRouteBody(spec: Spec, values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const v = values[f.key];
    if (!v) continue;
    if (f.kind === "custom") custom[f.key] = f.widget === "number" ? Number(v) : f.widget === "checkbox" ? v === "true" : v;
    else body[f.key] = v;
  }
  if (Object.keys(custom).length > 0) body.custom_data = custom;
  return body;
}

// ── references ───────────────────────────────────────────────────────────────────────────────────────────────

const clean = (s: string) => s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export type RefResolution = { value: string; options: { value: string; label: string }[] };

/** The record a reference field points at: the one the person named, the one they are on, or the candidates. */
export async function resolveRef(
  supabase: SupabaseClient,
  tenantId: string,
  ref: RefDef,
  hint: string | undefined,
  pageRecordId?: string | null,
): Promise<RefResolution> {
  const needle = clean(hint ?? "");
  if (needle.length >= 2) {
    const { data } = await supabase.from(ref.table).select("id, name, ref").eq("tenant_id", tenantId).ilike("name", `%${needle}%`).limit(6);
    const rows = (data ?? []) as { id: string; name: string; ref?: string | null }[];
    const options = rows.map((r) => ({ value: r.id, label: r.ref ? `${r.name} (${r.ref})` : r.name }));
    const exact = rows.filter((r) => r.name.trim().toLowerCase() === needle.toLowerCase());
    const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
    return { value: pick?.id ?? "", options };
  }
  if (pageRecordId && isUuid(pageRecordId)) {
    const { data } = await supabase.from(ref.table).select("id, name, ref").eq("id", pageRecordId).eq("tenant_id", tenantId).maybeSingle();
    if (data) return { value: data.id as string, options: [{ value: data.id as string, label: data.ref ? `${data.name} (${data.ref})` : (data.name as string) }] };
  }
  return { value: "", options: [] };
}

/** Does this id name a row of this workspace? The one check every foreign id gets before it goes near a route. */
export async function refExists(supabase: SupabaseClient, tenantId: string, ref: RefDef, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data } = await supabase.from(ref.table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

// ── duplicates ───────────────────────────────────────────────────────────────────────────────────────────────

export async function duplicatesFor(
  supabase: SupabaseClient,
  tenantId: string,
  def: CreateActionDef,
  values: Record<string, string>,
): Promise<CardDuplicate[]> {
  let hits: DuplicateHit[] = [];
  if (def.object === "account") hits = await findAccountDuplicates(supabase, tenantId, values.name, values.website);
  else if (def.object === "contact") hits = await findContactDuplicates(supabase, tenantId, values.account_id, values.name);
  return hits.map((h) => ({ id: h.id, label: h.ref ? `${h.name} (${h.ref})` : h.name, href: def.hrefFor(h.id) }));
}

// ── the card ─────────────────────────────────────────────────────────────────────────────────────────────────

/** What a web lookup proposed, already validated once (assistant/createResearch.ts) and validated again here. */
export type WebFill = {
  values: Record<string, string>;
  confidence: Record<string, "found" | "likely">;
  /** The fields the lookup was asked about; one of them without a value reads "Not found". */
  asked: string[];
  /** The id inside the signed consent that allowed the lookup; kept in the card's token for the audit row. */
  consentId: string | null;
};

export type CardInput = {
  values: Record<string, unknown>;
  references: Record<string, string>;
  summary: string;
  /** An account the person is looking at; the default for a reference that wants one. */
  pageAccountId?: string | null;
  web?: WebFill;
};

export type CardBuild =
  | { ok: true; card: ConfirmCard; ignored: string[] }
  | { ok: false; reason: string };

export async function buildCard(
  ctx: { supabase: SupabaseClient; tenantId: string; userId: string },
  def: CreateActionDef,
  input: CardInput,
  newId: () => string = () => crypto.randomUUID(),
): Promise<CardBuild> {
  const spec = await loadSpec(ctx.supabase, ctx.tenantId, def);
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  const values: Record<string, string> = {};
  const ignored: string[] = [];
  const notices: string[] = [];
  const optionsFor = new Map<string, { value: string; label: string }[]>();

  for (const [k, raw] of Object.entries(input.values ?? {})) {
    const f = byKey.get(k);
    if (!f || f.kind === "ref") { ignored.push(k); continue; }
    const n = normaliseValue(f, raw);
    if (!n.ok) { notices.push(n.error); continue; }
    if (n.value) values[k] = n.value;
  }

  // Web values are untrusted input: only the registry's research keys, only standard fields, never over something the
  // person said, and through the very validators a typed value goes through. One that fails is "not found", not a notice.
  const webKept = new Set<string>();
  for (const [k, raw] of Object.entries(input.web?.values ?? {})) {
    const f = byKey.get(k);
    if (!f || f.kind !== "standard" || !def.research?.[k] || values[k]) continue;
    const n = normaliseValue(f, raw);
    if (n.ok && n.value) { values[k] = n.value; webKept.add(k); }
  }

  for (const r of def.refs) {
    const res = await resolveRef(ctx.supabase, ctx.tenantId, r, input.references?.[r.param], r.fromPage === "account" ? input.pageAccountId : null);
    if (res.options.length) optionsFor.set(r.key, res.options);
    if (res.value) values[r.key] = res.value;
    else if (r.required && res.options.length === 0) {
      return { ok: false, reason: input.references?.[r.param]
        ? `No ${r.label.toLowerCase()} matched "${input.references[r.param]}". Tell the person, and offer to create that ${r.label.toLowerCase()} first.`
        : `Which ${r.label.toLowerCase()} is this for? Ask the person; no card has been shown.` };
    } else if (r.required) notices.push(`Several ${r.label.toLowerCase()}s match. Pick one.`);
  }

  const { required, hidden } = evaluateFields(spec, values);
  for (const k of hidden) { delete values[k]; webKept.delete(k); }

  const duplicates = await duplicatesFor(ctx.supabase, ctx.tenantId, def, values);

  const asked = new Set(input.web?.asked ?? []);
  const fields: CardField[] = spec.fields
    .filter((f) => !hidden.has(f.key))
    .map((f) => ({
      key: f.key, label: f.label, value: values[f.key] ?? "", required: required.has(f.key), widget: f.widget,
      options: optionsFor.get(f.key) ?? f.options,
      ...(webKept.has(f.key)
        ? { origin: "web" as const, confidence: input.web?.confidence[f.key] ?? ("likely" as const) }
        : asked.has(f.key) && !values[f.key] ? { confidence: "not_found" as const } : {}),
    }));

  const cardId = newId();
  const token = signToken({
    cid: cardId, tid: ctx.tenantId, uid: ctx.userId, act: def.key,
    h: structureHash(def, spec), dup: dupHash(duplicates),
    sm: input.summary.slice(0, 240),
    pv: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, hash8(v)])),
    ...(input.web ? { wb: { c: input.web.consentId, f: [...webKept] } } : {}),
  });

  const title = def.labelOf(values);
  return {
    ok: true,
    ignored,
    card: {
      id: cardId, token, action: "create", object: def.object, noun: def.noun,
      title: title ? `New ${def.noun}: ${title}` : `New ${def.noun}`,
      summary: input.summary.slice(0, 240),
      fields, duplicates, notices,
      primaryLabel: `Create ${def.noun}`, risk: "write",
    },
  };
}

/** A card or its values as the audit row keeps them: encrypted-at-rest fields are never written in the clear. */
export function auditValues(def: CreateActionDef, values: Record<string, string>): Record<string, unknown> {
  return redactPii(def.table, values);
}
