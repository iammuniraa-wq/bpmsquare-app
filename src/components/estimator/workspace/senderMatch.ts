import type { SenderInfo } from "@/lib/estimator/ai";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The name an account would be created under: the company, else the person (an individual customer). */
export function senderAccountName(s: SenderInfo): string | null {
  return s.company ?? s.contact_name ?? null;
}

/**
 * Whether the account and contact an email names already exist. Names only: a
 * contact's email is stored encrypted, so it cannot be searched here. A contact is
 * looked for inside the matched account only, so a common first name never
 * attaches the quote to someone else's customer.
 */
export function matchSender(
  s: SenderInfo,
  accounts: readonly AccountOption[],
  contacts: readonly ContactOption[],
): { account: AccountOption | null; contact: ContactOption | null } {
  const wanted = senderAccountName(s);
  const account = wanted ? accounts.find((a) => norm(a.name) === norm(wanted)) ?? null : null;
  const person = s.contact_name;
  const contact = account && person
    ? contacts.find((c) => c.account_id === account.id && norm(c.name) === norm(person)) ?? null
    : null;
  return { account, contact };
}
