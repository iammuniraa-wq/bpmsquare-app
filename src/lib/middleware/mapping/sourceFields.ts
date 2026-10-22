import { tokenSpecs } from "@/lib/webhooks/tokens";
import { INBOUND_FIELDS, INBOUND_LABELS, LINE_LABELS, QUOTE_LABELS, type MappingDocKey } from "../mappingDoc";
import { LINE_PLACEHOLDERS, PROJECT_PLACEHOLDERS, QUOTE_PLACEHOLDERS } from "../payload";
import type { FieldType, SourceField } from "./types";

// The BPMSquare side of a mapping (spec section 1): never snapshotted, always computed from what the engine can offer.
// Cost and margin fields are on no list: only what a customer sees leaves. Pure.

const TYPE: Record<string, FieldType> = {
  total: "number", subtotal: "number", valid_until: "date", outcome: "enum", status: "enum", currency: "enum",
  qty: "number", rate: "number", net_rate: "number", amount: "number", discount_pct: "number", uom: "enum", list_price: "number",
};

export type CustomFieldDef = { key: string; label: string; widget?: string };

const customType = (w: string | undefined): FieldType =>
  w === "number" ? "number" : w === "date" ? "date" : w === "boolean" || w === "checkbox" ? "boolean" : w === "enum" || w === "select" ? "enum" : "text";

export const customSourceFields = (defs: CustomFieldDef[]): SourceField[] =>
  defs.filter((d) => /^cf_[a-z0-9_]{1,60}$/.test(d.key)).map((d) => ({ key: d.key, label: d.label || d.key, type: customType(d.widget), custom: true }));

/** The related customer's non-personal fields, offered on a quote's header. */
export const ACCOUNT_SOURCE_FIELDS: SourceField[] = [
  { key: "account.ref", label: "Customer reference", type: "text", custom: false },
  { key: "account.name", label: "Customer name", type: "text", custom: false },
  { key: "account.city", label: "Customer city", type: "text", custom: false },
  { key: "account.country", label: "Customer country", type: "text", custom: false },
];

const field = (key: string, labels: Record<string, string>): SourceField => ({ key, label: labels[key] ?? key, type: TYPE[key] ?? "text", custom: false });

export type DocBlocks = { header: SourceField[]; lines: SourceField[] };

/** What a Dynamics, SAP or ePROMIS document can read. `kind` is the header map the Quote document is built through. */
export function adapterSourceFields(doc: MappingDocKey, kind: "quote" | "sales_order" | "project", custom: CustomFieldDef[] = []): DocBlocks {
  if (doc !== "quote") {
    return { header: (INBOUND_FIELDS[doc] ?? []).map((k) => field(k, INBOUND_LABELS)), lines: [] };
  }
  const base: readonly string[] = kind === "project" ? PROJECT_PLACEHOLDERS : QUOTE_PLACEHOLDERS;
  const header = [...base.map((k) => field(k, QUOTE_LABELS)), field("currency", { currency: "Currency" }), ...ACCOUNT_SOURCE_FIELDS, ...customSourceFields(custom)];
  const lines = kind === "project" ? [] : LINE_PLACEHOLDERS.map((k) => field(k, LINE_LABELS));
  return { header, lines };
}

/** The Standard Quote as a Call webhook reads it: the token list of the webhooks library, without the alias of the quote itself. */
export function webhookQuoteSourceFields(allowPii: boolean, custom: CustomFieldDef[] = []): DocBlocks {
  const header: SourceField[] = [];
  for (const t of tokenSpecs("standard_quotes")) {
    if (t.pii && !allowPii) continue;
    const path = t.token.replace(/^\{\{|\}\}$/g, "");
    if (path === "quote.lines" || t.kind === "array" || t.kind === "object") continue;
    const key = path.startsWith("quote.") ? path.slice(6) : path;
    header.push({ key, label: t.label, type: t.kind === "number" ? "number" : /(^|_)(valid_until)$/.test(key) ? "date" : /created_at$/.test(key) ? "datetime" : key === "currency" || key === "status" ? "enum" : "text", custom: false });
  }
  const lines: SourceField[] = LINE_PLACEHOLDERS.filter((k) => k !== "net_rate").map((k) => field(k, LINE_LABELS));
  return { header: [...header, ...customSourceFields(custom)], lines };
}

/** A short stable fingerprint of the offer, so the tab can say "BPMSquare gained 2 fields since this mapping" without a save. */
export function registryHash(b: DocBlocks): string {
  const s = [...b.header, ...b.lines].map((f) => `${f.key}:${f.type}`).sort().join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Keys a saved row refers to that the runtime cannot look up (custom fields and the customer's) are accepted as they are:
 *  they resolve to empty when absent, and the tab already judged them when the row was saved. */
export function keysUsedBy(rows: { source: string | null; convert: unknown }[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.source) out.add(r.source);
    const c = r.convert as { kind?: string; parts?: ({ field?: string } | { text?: string })[] } | null;
    if (c?.kind === "concat") for (const p of c.parts ?? []) if ("field" in p && p.field) out.add(p.field);
  }
  return [...out];
}

export function leniencyFields(blocks: DocBlocks, rows: { header: { source: string | null; convert: unknown }[]; lines: { source: string | null; convert: unknown }[] }): DocBlocks {
  const add = (fields: SourceField[], used: string[], allow: RegExp): SourceField[] => {
    const have = new Set(fields.map((f) => f.key));
    return [...fields, ...used.filter((k) => !have.has(k) && allow.test(k)).map((k) => ({ key: k, label: k, type: "text" as FieldType, custom: k.startsWith("cf_") }))];
  };
  return { header: add(blocks.header, keysUsedBy(rows.header), /^(cf_[a-z0-9_]{1,60}|account\.[a-z_]{1,30})$/), lines: add(blocks.lines, keysUsedBy(rows.lines), /^cf_[a-z0-9_]{1,60}$/) };
}
