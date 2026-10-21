// Email health of a contact's address: the statuses, what each one means in plain
// words, and the one rule for how a new fact moves a contact from one status to
// another. Pure, so the webhook, the "check this address" action and the tests all
// use the same answer.
//
// contacts.email_status (0144) is written ONLY by the Resend webhook and by the
// check / fix / mark-checked actions on the contact record. It is never part of the
// v1 API, MCP, an export or an import: it is an internal working field for sales.

export const EMAIL_STATUSES = ["unknown", "valid", "soft_bounce", "bounced", "complained", "invalid"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export function isEmailStatus(v: unknown): v is EmailStatus {
  return typeof v === "string" && (EMAIL_STATUSES as readonly string[]).includes(v);
}

/** The statuses a person in sales should look at. */
export const NEEDS_ATTENTION_STATUSES = ["bounced", "complained", "invalid", "soft_bounce"] as const satisfies readonly EmailStatus[];
export const needsAttention = (s: EmailStatus | null | undefined): boolean =>
  !!s && (NEEDS_ATTENTION_STATUSES as readonly string[]).includes(s);

export type StatusCopy = { label: string; plain: string; todo: string; tone: "green" | "amber" | "red" | "blue" };

export const EMAIL_STATUS_COPY: Record<EmailStatus, StatusCopy> = {
  unknown: {
    label: "Not checked yet", tone: "blue",
    plain: "We have not sent to this address or checked it yet.",
    todo: "Use Check address to make sure it looks right and its domain can receive mail.",
  },
  valid: {
    label: "Working", tone: "green",
    plain: "Mail to this address has been delivered, or it was checked and looks fine.",
    todo: "Nothing to do.",
  },
  soft_bounce: {
    label: "Trouble delivering", tone: "amber",
    plain: "The last message could not be delivered for now, for example because the mailbox was full. It may clear up by itself.",
    todo: "Wait for the next send, or phone the person and fix the address if it has changed.",
  },
  bounced: {
    label: "Bounced", tone: "red",
    plain: "The mail server said this address does not exist or cannot receive mail. We will not email it again.",
    todo: "Phone the person for the right address, then use Fix the address.",
  },
  complained: {
    label: "Marked as spam", tone: "red",
    plain: "The person marked one of our emails as spam. We will not email this address again.",
    todo: "Do not email this person. If they ask to hear from us again, record their consent and fix the address.",
  },
  invalid: {
    label: "Looks invalid", tone: "red",
    plain: "The address is not written correctly, or its domain cannot receive mail.",
    todo: "Correct the address with Fix the address, or phone the person to confirm it.",
  },
};

/** What just happened, in the terms the status rule cares about. */
export type HealthSignal =
  | { kind: "delivered" }
  | { kind: "soft_bounce"; reason?: string }
  | { kind: "bounced"; reason?: string }
  | { kind: "complained"; reason?: string }
  | { kind: "invalid"; reason?: string }
  /** The check passed (looks right, domain can receive mail). */
  | { kind: "checked_ok"; reason?: string }
  /** A rep confirmed the address by other means. */
  | { kind: "confirmed"; reason: string };

export type CurrentHealth = { status: EmailStatus; at: string | null };
export type HealthChange = { status: EmailStatus; reason: string | null };

const MAX_REASON = 200;
const clip = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, MAX_REASON);

/**
 * The one rule. Returns the change to write, or null when the signal leaves the
 * contact as it is.
 *
 *  - A delivery proves the address works: unknown, soft_bounce and invalid go to
 *    valid. A bounced or complained address stays as it is (we do not send to it, so
 *    a delivery after one is a late or out-of-order event, not good news).
 *  - A signal that happened BEFORE the current status was set is stale and ignored,
 *    so a late "delivered" cannot undo a newer bounce. Manual actions are always now.
 *  - Severity only goes up from webhook signals: complained > bounced > soft_bounce.
 *    Only a manual action (check, fix, confirmed) can bring a bounced contact back.
 */
export function nextHealth(current: CurrentHealth, signal: HealthSignal, occurredAt?: string | null): HealthChange | null {
  const manual = signal.kind === "checked_ok" || signal.kind === "confirmed" || signal.kind === "invalid";
  if (!manual && occurredAt && current.at) {
    const t = Date.parse(occurredAt);
    const c = Date.parse(current.at);
    if (Number.isFinite(t) && Number.isFinite(c) && t < c) return null;
  }

  switch (signal.kind) {
    case "delivered":
      if (current.status === "unknown" || current.status === "soft_bounce" || current.status === "invalid") {
        return { status: "valid", reason: "A message was delivered to this address." };
      }
      return null;
    case "soft_bounce":
      if (current.status === "bounced" || current.status === "complained" || current.status === "soft_bounce") return null;
      return { status: "soft_bounce", reason: clip(signal.reason ?? "The last message could not be delivered for now.") };
    case "bounced":
      if (current.status === "complained" || current.status === "bounced") return null;
      return { status: "bounced", reason: clip(signal.reason ?? "The mail server said this address cannot receive mail.") };
    case "complained":
      if (current.status === "complained") return null;
      return { status: "complained", reason: clip(signal.reason ?? "The person marked an email as spam.") };
    case "invalid":
      // A failed check never overrides a real delivery result.
      if (current.status === "bounced" || current.status === "complained" || current.status === "valid") return null;
      return { status: "invalid", reason: clip(signal.reason ?? "The address does not look right.") };
    case "checked_ok":
      // A passing check is weaker than a real delivery: it only upgrades "not checked" and "invalid".
      if (current.status === "unknown" || current.status === "invalid") {
        return { status: "valid", reason: clip(signal.reason ?? "Checked: the address looks right and its domain can receive mail.") };
      }
      return null;
    case "confirmed":
      return { status: "valid", reason: clip(`Confirmed by a person: ${signal.reason}`) };
  }
}

/** Plain-words reasons for what a provider told us, never the provider's own text. */
export function bounceReason(hard: boolean, subType?: string | null): string {
  const s = (subType ?? "").toLowerCase();
  if (s === "mailboxfull") return "The mailbox is full.";
  if (s === "messagetoolarge") return "The message was too large for the mailbox.";
  if (s === "contentrejected" || s === "attachmentrejected") return "The mail server refused the content of the message.";
  if (s === "suppressed") return "The email service already knows this address cannot receive mail.";
  if (s === "noemail") return "The mail server says there is no mailbox at this address.";
  return hard
    ? "The mail server said this address does not exist or cannot receive mail."
    : "The mailbox could not take the message for now.";
}
