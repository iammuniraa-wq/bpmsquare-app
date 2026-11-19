// What the user is told when "create and send" did not send to everyone. PURE.
//
// POST /api/rfqs creates the RFQ first and then e-mails each supplier, so a send can fail after the RFQ exists
// (a mailbox that is not connected, a mail service error). On 2026-11-19 that closed the dialog as if it had
// worked and left a draft nobody knew about. The forms now read the per-supplier result through this.

export type SentRow = { supplier: string; ok: boolean; reason?: string };

/** The one sentence for "the RFQ mail channel is the workspace's own mailbox and that mailbox is not connected". */
export const mailboxNotConnected = (connector: "gmail" | "mail_server"): string =>
  `RFQ email is set to go from your own mailbox, but the ${connector === "gmail" ? "Gmail" : "Mail server"} connector isn't connected (Settings → Connectors).`;

export type SendOutcome = {
  /** Nothing went out: the RFQ is still a draft. */
  nothingSent: boolean;
  sentCount: number;
  total: number;
  headline: string;
  /** Why, in the server's own words: one line when every failure shares a reason, else one per supplier. */
  reasons: string[];
};

const FALLBACK = "The email could not be sent. Try again from the RFQ in a moment.";

/** Null when the send was not asked for, or reached every supplier. */
export function sendOutcome(ref: string, sent: readonly SentRow[] | null | undefined, requested: boolean): SendOutcome | null {
  if (!requested) return null;
  const rows = sent ?? [];
  const failed = rows.filter((r) => !r.ok);
  if (rows.length > 0 && failed.length === 0) return null;
  const sentCount = rows.length - failed.length;
  const nothingSent = sentCount === 0;
  const name = ref || "The RFQ";
  const distinct = [...new Set(failed.map((f) => (f.reason ?? "").trim()).filter(Boolean))];
  const reasons = distinct.length <= 1
    ? [distinct[0] ?? FALLBACK]
    : failed.map((f) => `${f.supplier || "A supplier"}: ${(f.reason ?? "").trim() || FALLBACK}`);
  return {
    nothingSent,
    sentCount,
    total: rows.length,
    headline: nothingSent
      ? `${name} was saved as a draft. Nothing was sent.`
      : `${name} was sent to ${sentCount} of ${rows.length} suppliers. ${failed.length === 1 ? "One was" : `${failed.length} were`} not sent.`,
    reasons,
  };
}
