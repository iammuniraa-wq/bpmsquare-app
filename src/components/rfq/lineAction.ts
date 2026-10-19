// Whether a document line can carry the per-line "Request quotation" action,
// and what to tell the user when it cannot yet. Pure, shared by the line
// grid and the read-only quotation table.

export const SAVE_FIRST_MESSAGE = "Save the quote first so the RFQ can be linked to it.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LineActionState =
  | { eligible: false; reason: null }
  | { eligible: true; ready: true; reason: null }
  | { eligible: true; ready: false; reason: string };

export function rfqLineActionState(l: { documentId?: string | null; lineId: string; description: string; isBreak?: boolean; hasRfq?: boolean }): LineActionState {
  if (l.isBreak || l.hasRfq || !l.description.trim()) return { eligible: false, reason: null };
  // A line that exists only in this editing session has no database id yet:
  // the RFQ could not be linked to it, so ask for a save first.
  if (!l.documentId || !UUID.test(l.documentId) || !UUID.test(l.lineId)) return { eligible: true, ready: false, reason: SAVE_FIRST_MESSAGE };
  return { eligible: true, ready: true, reason: null };
}
