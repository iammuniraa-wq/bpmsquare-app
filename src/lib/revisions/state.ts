import type { TenantConfig } from "@/lib/constants";
import type { StandardQuote } from "@/lib/types";

// Revision history of a Standard Quote (PDF design, slice 2, docs/design/pdf-design-system.md 4.9). Pure rules, shared by the
// routes, the pages and the tests. One record, many revisions: the quotation keeps its record and its number; each issue adds
// an immutable row in document_revisions (the bid-version pattern of 0225, not the Quotation object's clone-a-new-record).

type RevState = Pick<StandardQuote, "status" | "current_revision" | "revision_state">;

/** The workspace switch "Keep revisions and lock issued quotes". Off unless the workspace turned it on. */
export function revisionsOn(config: Partial<TenantConfig> | null | undefined): boolean {
  return config?.revisions?.standard_quote === true;
}

/** Revisions need migration 0252: a loaded row only carries `revision_state` once the column exists. Until then the switch,
 *  even when on, behaves as off, so a pending migration never locks a quote nobody can unlock. */
export function revisionColumnsReady(quote: object): boolean {
  return "revision_state" in quote;
}

/** Whether this quote is under revision control right now. */
export function revisionsActive(config: Partial<TenantConfig> | null | undefined, quote: object): boolean {
  return revisionsOn(config) && revisionColumnsReady(quote);
}

/** After issue the quotation is read-only until someone revises it. */
export function isLockedByIssue(quote: Pick<StandardQuote, "revision_state">, active: boolean): boolean {
  return active && quote.revision_state === "issued";
}

/** Who may change what is printed. Without revisions: a draft, as always. With revisions: anything not issued and not accepted
 *  (a sent or rejected quote is reopened by "Revise", which sets the working copy back to draft). */
export function canEditContent(quote: RevState, active: boolean): boolean {
  if (!active) return quote.status === "draft";
  if (quote.status === "accepted") return false;
  return quote.revision_state !== "issued";
}

/** The number the working copy will carry when it is issued: 0 before the first issue, then the latest issued + 1. */
export function workingRevisionNo(quote: Pick<StandardQuote, "current_revision" | "revision_state">): number {
  if (quote.current_revision === null || quote.current_revision === undefined) return 0;
  return quote.revision_state === "issued" ? quote.current_revision : quote.current_revision + 1;
}

/** The revision a printed copy of the record shows: the issued number once issued, "in preparation" otherwise. */
export function printedRevisionNo(quote: Pick<StandardQuote, "current_revision" | "revision_state">): number {
  return quote.revision_state === "issued" && quote.current_revision != null ? quote.current_revision : workingRevisionNo(quote);
}

export const REASON_MIN = 3;
export const REASON_MAX = 1000;

/** Revision 00 needs no reason; every later one must say why (checked here and by the table). */
export function reasonProblem(revisionNo: number, reason: unknown): string | null {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (revisionNo === 0) return null;
  if (text.length < REASON_MIN) return "Say why this quotation is being revised";
  if (text.length > REASON_MAX) return `The reason is at most ${REASON_MAX} characters`;
  return null;
}

/** Content fields a PATCH may not change on an issued, locked quote. Status, the sent/closed stamps and the deal link stay open:
 *  they describe what happened to the offer, not what the offer says. */
export const LOCKED_PATCH_KEYS = [
  "contact_id", "valid_until", "terms", "notes", "template_id", "intro_text", "inquiry_date", "header_discount_pct", "tax_pct",
  "shipping_amount", "print_options", "lines", "custom_data", "project_title", "subject", "entity_id", "doc_sections",
] as const;

export function lockedKeysIn(body: Record<string, unknown>): string[] {
  return LOCKED_PATCH_KEYS.filter((k) => k in body);
}
