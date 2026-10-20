// The before-send audience check, in plain words. The reason codes are the ones the send records
// (its own, and canContact()'s); here they are grouped the way a marketer thinks about a gap, with
// what it means and what to do. Pure and rule-based: no scores, no AI.

export type SkipGroup = { id: string; label: string; count: number; fix: string };

const GROUPS: { id: string; label: string; codes: readonly string[]; fix: string }[] = [
  { id: "no_consent", label: "have not said yes to emails about this topic", codes: ["no_consent"], fix: "Record their consent on the contact, or ask them to opt in. A reply, a form or a preference page counts once it is recorded." },
  { id: "opted_out", label: "have opted out or asked not to be contacted", codes: ["account_opted_out", "withdrawn", "do_not_contact", "suppressed"], fix: "Nothing to do. They said no, and the send will always respect it." },
  { id: "no_contact", label: "are not a contact we can match to this address", codes: ["no_contact", "contact_not_found"], fix: "Add them as a contact on their account (with this email) so their consent and language can be checked." },
  { id: "no_language", label: "would get a language that is not ready", codes: ["no_language"], fix: "Finish checking the other language in the studio, or tick the fallback language." },
  { id: "no_email", label: "have no email address", codes: ["no_email"], fix: "Add an email to the account or contact." },
  { id: "bounced", label: "have an address that bounced or was reported as spam", codes: ["bounced", "complained"], fix: "Correct the address or leave them out. Mailing it again hurts your sending reputation." },
  { id: "unavailable", label: "could not be checked just now", codes: ["unavailable"], fix: "Try again in a moment. Nobody is sent to unless the check passes." },
];

/** Groups the skip counts for display; a group with nobody in it is left out. Unknown codes still show, under their own words. */
export function groupSkipReasons(skipped: Record<string, number>): SkipGroup[] {
  const out: SkipGroup[] = [];
  const used = new Set<string>();
  for (const g of GROUPS) {
    const count = g.codes.reduce((n, c) => { if (skipped[c]) used.add(c); return n + (skipped[c] ?? 0); }, 0);
    if (count > 0) out.push({ id: g.id, label: g.label, count, fix: g.fix });
  }
  for (const [code, n] of Object.entries(skipped)) if (n > 0 && !used.has(code)) out.push({ id: code, label: `were left out (${code.replace(/_/g, " ")})`, count: n, fix: "" });
  return out;
}
