// Which records one pull reads by id: the "Specific records" box on the Integration middleware page. A saved
// Scope (attributes of the records in the connected system) is scope.ts. Pure and client-safe. Nothing typed by
// a person ever reaches a $filter raw: ids and numbers are matched against strict patterns, field names come
// only from the entity's own configuration (and must be plain identifiers), and every string literal goes
// through odataString().

import type { D365EntityConfig, D365Product } from "./types";
import { odataString } from "./mapping";

export type RunSelection = { ids?: string[] };

/** What an entity can express, so the page can say so before a run instead of after. */
export type SelectionSupport = { numbers: boolean };

export const MAX_SELECT_IDS = 100;
/** Ids per request: a long OR chain would exceed the URL limits of Business Central and some gateways. */
export const IDS_PER_REQUEST = 20;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A readable number or code: letters, digits and . _ - / # only. No quote, space or operator can get through. */
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/#]{0,59}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isGuid = (v: string): boolean => GUID_RE.test(v);

type Parsed = { ok: true; select: RunSelection | undefined } | { ok: false; error: string };

/** Check what a request body asked for. Returns the cleaned selection (undefined when it asked for nothing). */
export function parseSelection(input: { ids?: unknown }): Parsed {
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
  return { ok: true, select: Object.keys(out).length ? out : undefined };
}

// ── What the entity can express ─────────────────────────────────────────────

const numberField = (ec: D365EntityConfig): string | null => (ec.key_field && IDENT_RE.test(ec.key_field) ? ec.key_field : null);
/** Finance & Operations keys are text (the account number itself); the other two products key on a GUID. */
const idIsText = (product: D365Product, ec: D365EntityConfig): boolean => product === "fo" || (!!ec.key_field && ec.key_field === ec.id_field);

export function selectionSupport(product: D365Product, ec: D365EntityConfig | null): SelectionSupport {
  if (!ec) return { numbers: false };
  return { numbers: idIsText(product, ec) || !!numberField(ec) };
}

export type BuiltSelection = {
  /** One $filter per request (ids are split into groups). */
  filters: string[];
  /** What was asked for and could not be applied, in plain words. Never dropped silently. */
  unsupported: string[];
  /** Nothing usable was left, so no request should be made. */
  nothingUsable: boolean;
};

export function buildSelection(product: D365Product, ec: D365EntityConfig, sel: RunSelection): BuiltSelection {
  const unsupported: string[] = [];
  if (!sel.ids?.length) return { filters: [], unsupported, nothingUsable: true };

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
  for (let i = 0; i < usable.length; i += IDS_PER_REQUEST) filters.push(`(${usable.slice(i, i + IDS_PER_REQUEST).join(" or ")})`);
  return { filters, unsupported, nothingUsable: false };
}

/** The run's own words for what it read: "3 records by id or number". */
export function describeSelection(sel: RunSelection): string {
  return sel.ids?.length ? `${sel.ids.length} record${sel.ids.length === 1 ? "" : "s"} by id or number` : "";
}
