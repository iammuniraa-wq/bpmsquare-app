// Which records one pull reads: the filters and ids behind "Full resync" and "Specific records" on the
// Integration middleware page. Pure and client-safe. Nothing typed by a person ever reaches a $filter
// raw: ids and numbers are matched against strict patterns, text and dates are validated, field names
// come only from the entity's own configuration (and must be plain identifiers), and every string
// literal goes through odataString().

import type { D365EntityConfig, D365Product } from "./types";
import { odataString } from "./mapping";

export type RunSelection = { ids?: string[]; since?: string; text?: string; activeOnly?: boolean };

/** What an entity can express, so the page can say so before a run instead of after. */
export type SelectionSupport = { since: boolean; text: boolean; active: boolean; numbers: boolean };

export const MAX_SELECT_IDS = 100;
export const MAX_SELECT_TEXT = 80;
/** Ids per request: a long OR chain would exceed the URL limits of Business Central and some gateways. */
export const IDS_PER_REQUEST = 20;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A readable number or code: letters, digits and . _ - / # only. No quote, space or operator can get through. */
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/#]{0,59}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?)?$/;

export const isGuid = (v: string): boolean => GUID_RE.test(v);

type Parsed = { ok: true; select: RunSelection | undefined } | { ok: false; error: string };

/** Check what a request body asked for. Returns the cleaned selection (undefined when it asked for nothing). */
export function parseSelection(input: { ids?: unknown; since?: unknown; text?: unknown; active_only?: unknown }): Parsed {
  const out: RunSelection = {};

  if (input.ids !== undefined && input.ids !== null) {
    if (!Array.isArray(input.ids)) return { ok: false, error: "ids must be a list." };
    const ids: string[] = [];
    for (const raw of input.ids) {
      if (typeof raw !== "string") continue;
      const t = raw.trim().replace(/^\{(.*)\}$/, "$1");
      if (!t) continue;
      if (!GUID_RE.test(t) && !NUMBER_RE.test(t)) return { ok: false, error: `"${t.slice(0, 24)}" is not an id or a number.` };
      if (!ids.includes(t)) ids.push(t);
    }
    if (ids.length > MAX_SELECT_IDS) return { ok: false, error: `Up to ${MAX_SELECT_IDS} records at a time.` };
    if (ids.length) out.ids = ids;
  }

  if (input.since !== undefined && input.since !== null && input.since !== "") {
    if (typeof input.since !== "string" || !SINCE_RE.test(input.since.trim())) return { ok: false, error: "Changed since must be a date." };
    const raw = input.since.trim();
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : /Z$/.test(raw) ? raw : `${raw}Z`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Changed since must be a date." };
    out.since = d.toISOString().replace(/\.\d+Z$/, "Z");
  }

  if (input.text !== undefined && input.text !== null && input.text !== "") {
    if (typeof input.text !== "string") return { ok: false, error: "Contains must be text." };
    // eslint-disable-next-line no-control-regex
    const t = input.text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > MAX_SELECT_TEXT) return { ok: false, error: `Contains takes at most ${MAX_SELECT_TEXT} characters.` };
    if (t) out.text = t;
  }

  if (input.active_only !== undefined && input.active_only !== null && typeof input.active_only !== "boolean") return { ok: false, error: "Active only must be on or off." };
  if (input.active_only === true) out.activeOnly = true;

  return { ok: true, select: Object.keys(out).length ? out : undefined };
}

// ── What the entity can express ─────────────────────────────────────────────

const nameField = (ec: D365EntityConfig): string | null => {
  const n = ec.field_map?.name;
  return typeof n === "string" && IDENT_RE.test(n) ? n : null;
};
const numberField = (ec: D365EntityConfig): string | null => (ec.key_field && IDENT_RE.test(ec.key_field) ? ec.key_field : null);
/** Finance & Operations keys are text (the account number itself); the other two products key on a GUID. */
const idIsText = (product: D365Product, ec: D365EntityConfig): boolean => product === "fo" || (!!ec.key_field && ec.key_field === ec.id_field);

export function selectionSupport(product: D365Product, ec: D365EntityConfig | null): SelectionSupport {
  if (!ec) return { since: false, text: false, active: false, numbers: false };
  return {
    since: !!ec.modified_field && IDENT_RE.test(ec.modified_field),
    text: !!(nameField(ec) || numberField(ec)),
    // Only Dataverse has one status column every table shares. Neither Finance & Operations nor
    // Business Central has a flag the standard presets know, so it is not guessed.
    active: product === "dataverse",
    numbers: idIsText(product, ec) || !!numberField(ec),
  };
}

const PRODUCT_WORD: Record<D365Product, string> = { fo: "Finance & Operations", bc: "Business Central", dataverse: "Dataverse" };

export type BuiltSelection = {
  /** One $filter per request (ids are split into groups); each already ANDs the other conditions. */
  filters: string[];
  /** What was asked for and could not be applied, in plain words. Never dropped silently. */
  unsupported: string[];
  /** Nothing usable was left, so no request should be made. */
  nothingUsable: boolean;
};

export function buildSelection(product: D365Product, ec: D365EntityConfig, sel: RunSelection): BuiltSelection {
  const sup = selectionSupport(product, ec);
  const unsupported: string[] = [];
  const where = PRODUCT_WORD[product];
  const clauses: string[] = [];

  if (sel.since) {
    if (sup.since && /^\d{4}-\d{2}-\d{2}T[\d:]+Z$/.test(sel.since)) clauses.push(`${ec.modified_field} ge ${sel.since}`);
    else unsupported.push(`Changed since is not available for this entity in ${where}.`);
  }
  if (sel.text) {
    const parts = [nameField(ec), numberField(ec)].filter((f): f is string => !!f).filter((f, i, a) => a.indexOf(f) === i);
    if (parts.length) clauses.push(parts.map((f) => `contains(${f},${odataString(sel.text!)})`).join(" or "));
    else unsupported.push("Contains needs a name or number field, and this entity has none set.");
  }
  if (sel.activeOnly) {
    if (sup.active) clauses.push("statecode eq 0");
    else unsupported.push(`Active only is not available in ${where}.`);
  }

  if (!sel.ids?.length) return { filters: clauses.length ? [join(clauses)] : [], unsupported, nothingUsable: clauses.length === 0 };

  const usable: string[] = [];
  const noNumber: string[] = [];
  const idCol = IDENT_RE.test(ec.id_field) ? ec.id_field : null;
  const numCol = numberField(ec);
  for (const t of sel.ids) {
    if (!idCol) continue;
    if (isGuid(t) && !idIsText(product, ec)) usable.push(`${idCol} eq ${t}`);
    else if (!isGuid(t) && idIsText(product, ec)) usable.push(`${idCol} eq ${odataString(t)}`);
    else if (!isGuid(t) && numCol) usable.push(`${numCol} eq ${odataString(t)}`);
    else if (idIsText(product, ec)) usable.push(`${idCol} eq ${odataString(t)}`);
    else noNumber.push(t);
  }
  if (!idCol) unsupported.push("This entity has no usable id field, so single records cannot be read.");
  else if (noNumber.length) {
    unsupported.push(`Numbers cannot be looked up for this entity (${noNumber.slice(0, 3).join(", ")}${noNumber.length > 3 ? ", ..." : ""}); use record ids.`);
  }
  // Asking for named records and getting a broader read would be worse than refusing.
  if (!usable.length) return { filters: [], unsupported, nothingUsable: true };

  const filters: string[] = [];
  for (let i = 0; i < usable.length; i += IDS_PER_REQUEST) {
    filters.push(join([usable.slice(i, i + IDS_PER_REQUEST).join(" or "), ...clauses]));
  }
  return { filters, unsupported, nothingUsable: false };
}

/** Each part in brackets, joined with `and`, so an `or` inside one part cannot leak into the next. */
function join(parts: string[]): string {
  return parts.map((p) => `(${p})`).join(" and ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Oct 2026": a numeric date in a stored message would be scrubbed as if it were a phone number. */
const dateWord = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;

/** The run's own words for what it read: "changed since 2026-10-01, name or number contains "AG", active only". */
export function describeSelection(sel: RunSelection): string {
  const bits: string[] = [];
  if (sel.ids?.length) bits.push(`${sel.ids.length} record${sel.ids.length === 1 ? "" : "s"} by id or number`);
  if (sel.since) bits.push(`changed since ${dateWord(sel.since)}`);
  if (sel.text) bits.push(`contains "${sel.text}"`);
  if (sel.activeOnly) bits.push("active only");
  return bits.join(", ");
}
