// How an RFQ is tied to the quote (or case, work order ...) it came from and
// to the item on that quote. Pure and client-safe: the server checks in
// linkingServer.ts / createRfq use these rules, the screens use the labels.

import { RFQ_ORIGIN_LABEL, type RfqOriginType } from "./types";

/** Origins that are a real record, so an RFQ from one must name it. "manual"
 *  (and the legacy "pricing") have no document and stay possible. */
export const DOCUMENT_ORIGIN_TYPES = [
  "standard_quote", "quote", "opportunity", "case", "inspection_report", "work_order", "fence_project", "estimate",
] as const satisfies readonly RfqOriginType[];

/** The sales documents whose lines an RFQ line can be stamped onto. */
export const DOC_LINE_TABLE: Partial<Record<RfqOriginType, { table: string; parent: string }>> = {
  standard_quote: { table: "standard_quote_lines", parent: "standard_quote_id" },
  quote: { table: "quote_lines", parent: "quote_id" },
  opportunity: { table: "opportunity_lines", parent: "opportunity_id" },
  // An RFQ for the missing costs of an estimate (0227): its lines ask about estimate lines. Unlike the three above, the estimate line is
  // not stamped with the RFQ line; the RFQ line remembers the estimate line (rfq_lines.estimate_line_id) so an award can write the cost back.
  estimate: { table: "estimate_lines", parent: "estimate_id" },
};

/** What the "From a quote" filter means: the three sales documents with lines. */
export const QUOTE_ORIGIN_TYPES: readonly RfqOriginType[] = ["standard_quote", "quote", "opportunity"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const isDocumentOrigin = (t: RfqOriginType | undefined | null): boolean =>
  !!t && (DOCUMENT_ORIGIN_TYPES as readonly string[]).includes(t);

/** Null when the origin is acceptable, else the message to answer with (422). */
export function validateOriginInput(type: RfqOriginType, id: unknown): string | null {
  if (!isDocumentOrigin(type)) return null;
  if (id === null || id === undefined || id === "") return `An RFQ from a ${RFQ_ORIGIN_LABEL[type].toLowerCase()} must be linked to it. Save the ${RFQ_ORIGIN_LABEL[type].toLowerCase()} first, then request the quotation.`;
  if (!isUuid(id)) return `The ${RFQ_ORIGIN_LABEL[type].toLowerCase()} this RFQ is for is not valid.`;
  return null;
}

export type SourceLineCheck = { ok: true; ids: string[] } | { ok: false; error: string };

/** The document-line ids a request carries, checked for shape, duplicates and
 *  whether the origin can have document lines at all. Membership of the
 *  origin document is a database question (verifySourceLines). */
export function checkSourceLineIds(type: RfqOriginType, lines: { source_line_id?: unknown }[]): SourceLineCheck {
  const ids: string[] = [];
  for (const l of lines) {
    const v = l.source_line_id;
    if (v === null || v === undefined || v === "") continue;
    if (!isUuid(v)) return { ok: false, error: "A line you selected is not valid." };
    ids.push(v.toLowerCase());
  }
  if (!ids.length) return { ok: true, ids };
  if (!DOC_LINE_TABLE[type]) return { ok: false, error: "Lines can only be linked to a quote, standard quote or deal." };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "The same quote line is on this request twice." };
  return { ok: true, ids };
}

export function originHref(type: RfqOriginType, id: string | null, extra?: { caseId?: string | null }): string | null {
  if (!id) return null;
  switch (type) {
    case "standard_quote": return `/standard-quotes/${id}`;
    case "quote": return `/quotations/${id}`;
    case "opportunity": return `/pipeline/${id}`;
    case "case": return `/cases/${id}`;
    case "inspection_report": return extra?.caseId ? `/cases/${extra.caseId}` : null;
    case "work_order": return `/work-orders/${id}`;
    case "fence_project": return `/fence-projects/${id}`;
    case "estimate": return `/estimates/${id}`;
    default: return null;
  }
}

/** "Standard Quote SQ-0007", "Deal D-0012" ... or "No quote" for a manual RFQ. */
export function quoteLabel(type: RfqOriginType, label: string | null | undefined): string {
  if (!isDocumentOrigin(type)) return "No quote";
  return label ? `${RFQ_ORIGIN_LABEL[type]} ${label}` : RFQ_ORIGIN_LABEL[type];
}

/** "PTFE sheet" or "PTFE sheet +2" -- the first item and how many more. */
export function itemsSummary(names: (string | null | undefined)[]): string {
  const list = names.map((n) => (n ?? "").trim()).filter(Boolean);
  if (!list.length) return "—";
  return list.length === 1 ? list[0] : `${list[0]} +${list.length - 1}`;
}

/** What the list search matches an RFQ on besides ref and title. */
export function searchText(r: { ref?: string | null; title?: string | null; origin_type: RfqOriginType; origin_label?: string | null; item_names?: string[] }): string {
  return [r.ref, r.title, quoteLabel(r.origin_type, r.origin_label), r.origin_label, ...(r.item_names ?? [])].filter(Boolean).join(" ").toLowerCase();
}
