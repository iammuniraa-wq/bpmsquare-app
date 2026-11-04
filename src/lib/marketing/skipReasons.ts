import { ROUTES } from "@/lib/constants";

/**
 * Why a person is left out of a plain email, in a sentence, with the screen that fixes it
 * (docs/design/marketing-two-parts.md section 7). The codes are the ones the send records:
 * `consentVerdict` (src/lib/newsletter/send.ts) and `canContact` (src/lib/marketing/consent.ts).
 * One definition for the audience count, the review panel and the sent record, so the three
 * never say different things about the same person.
 */

export type SkipFix = { label: string; href: string };
export type SkipReason = { code: string; label: string; why: string; fix: SkipFix | null };

type Subject = { accountId?: string | null; contactId?: string | null; email?: string | null };

const CONSENT_HREF = ROUTES.settingsMarketingConsent;

function accountFix(s: Subject): SkipFix | null {
  return s.accountId ? { label: "Open the account", href: ROUTES.account(s.accountId) } : null;
}
function contactFix(s: Subject): SkipFix | null {
  return s.contactId ? { label: "Open the contact", href: ROUTES.contact(s.contactId) } : null;
}

export function skipReason(codeOrStatus: string, s: Subject = {}): SkipReason {
  // The recorded status ("skipped_no_email") and the reason code ("no_email") both arrive here.
  const code = codeOrStatus.replace(/^skipped_/, "");
  switch (code) {
    case "no_email":
      return { code, label: "No email address", why: "This account has no email address.", fix: accountFix(s) };
    case "no_contact": {
      const href = s.email ? `${ROUTES.contactNew}?email=${encodeURIComponent(s.email)}` : ROUTES.contactNew;
      return { code, label: "Not a contact", why: "This address is not a contact yet, so we cannot check consent.", fix: { label: "Create contact", href } };
    }
    case "opt_out":
    case "account_opted_out":
      return { code: "account_opted_out", label: "Unsubscribed", why: "The account unsubscribed.", fix: accountFix(s) };
    case "bounced":
      return { code, label: "Address bounced", why: "This address bounced, so it is blocked.", fix: contactFix(s) };
    case "complained":
      return { code, label: "Marked as spam", why: "This person reported a message as spam, so the address is blocked.", fix: contactFix(s) };
    case "suppressed":
    case "do_not_contact":
      return { code, label: "Blocked", why: "This person is on the do-not-contact list.", fix: contactFix(s) };
    case "withdrawn":
      return { code, label: "Withdrew consent", why: "This person withdrew consent for this topic.", fix: contactFix(s) };
    case "no_language":
      return { code, label: "No language version", why: "There is no version in this person's language.", fix: null };
    case "no_consent":
    case "contact_not_found":
    case "unavailable":
      return { code: "no_consent", label: "No consent", why: "This person has not agreed to this topic.", fix: contactFix(s) ?? { label: "Open Consent settings", href: CONSENT_HREF } };
    default:
      return { code, label: "Left out", why: "This person could not be emailed. Open the contact to see why.", fix: contactFix(s) ?? accountFix(s) };
  }
}

/** The label a sent record shows next to a recipient. */
export function recipientStatusLabel(status: string): string {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Pending";
  return skipReason(status).label;
}

export const ALL_SKIP_CODES = ["no_email", "no_contact", "account_opted_out", "bounced", "complained", "suppressed", "withdrawn", "no_language", "no_consent"] as const;
