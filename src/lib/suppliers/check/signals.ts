import {
  DISPOSABLE_MAIL, FREE_MAIL, emailDomain, isSaudiCrFormat, isSaudiVatFormat, looksNumeric, normBank, normEmail, normNumber, normPhone,
  sameCompanyName, websiteDomain, type Identity,
} from "./identity";
import type { Findings, Positive, Signal } from "./types";

// Genuineness signals computed from the workspace's own supplier records, one supplier against the others of the SAME workspace
// (the caller passes only this tenant's suppliers). Pure and deterministic. Each signal has a severity and one plain sentence; none
// carries an email address, a phone number or a bank number, only the names of the other suppliers. These are indicators for a
// person to look at, never a finding about the company.

export const NEW_SUPPLIER_DAYS = 90;
export const LARGE_QUOTE_FACTOR = 5;
export const MIN_PEER_QUOTES = 3;

export type QuoteContext = {
  /** The largest quote total the subject has given on one RFQ, in the workspace currency. */
  subjectTotal: number | null;
  /** The quote totals other suppliers gave on RFQs (one number per supplier per RFQ). */
  peerTotals: number[];
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const names = (xs: { name: string }[]): string => {
  const n = xs.map((x) => x.name);
  return n.length <= 2 ? n.join(" and ") : `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
};

const ref = (xs: Identity[]) => xs.map((x) => ({ id: x.id, name: x.name }));

export function computeSignals(
  subject: Identity, others: readonly Identity[], opts: { now: Date; quote?: QuoteContext; formatMoney?: (n: number) => string },
): Findings {
  const signals: Signal[] = [];
  const positives: Positive[] = [];
  const peers = others.filter((o) => o.id !== subject.id);
  const add = (s: Signal) => signals.push(s);

  const domain = emailDomain(subject.email);
  const siteDomain = websiteDomain(subject.website);

  if (domain && DISPOSABLE_MAIL.has(domain)) {
    add({ id: "disposable_email", severity: "medium", text: "The email address is from a throw-away mail service, which a company that expects repeat business would not normally use." });
  } else if (domain && FREE_MAIL.has(domain)) {
    add({ id: "free_mail", severity: "low", text: `The email address is on a free-mail service (${domain}) rather than a company domain.` });
  }

  if (domain && siteDomain && !FREE_MAIL.has(domain) && !DISPOSABLE_MAIL.has(domain)) {
    const same = domain === siteDomain || domain.endsWith(`.${siteDomain}`) || siteDomain.endsWith(`.${domain}`);
    if (same) positives.push({ id: "domain_match", kind: "domain", text: `The email address and the website are on the same domain (${siteDomain}).` });
    else add({ id: "email_site_mismatch", severity: "medium", text: `The email address is on ${domain} but the website is ${siteDomain}. They should normally match.` });
  }

  if (!subject.website) add({ id: "no_website", severity: "low", text: "No website is on record, so the company cannot be cross-checked online." });
  if (!subject.email && !subject.phone) add({ id: "no_contact", severity: "medium", text: "Neither an email address nor a phone number is on record." });

  if (!subject.taxId) add({ id: "no_tax_id", severity: "low", text: "No VAT or tax number is on record." });
  else if (looksNumeric(subject.taxId)) {
    if (isSaudiVatFormat(subject.taxId)) positives.push({ id: "vat_format", kind: "ids_format", formatOnly: true, text: "The VAT number is in the Saudi format (15 digits, starting and ending with 3). Format only, not confirmed with the registry." });
    else add({ id: "vat_format", severity: "medium", formatOnly: true, text: "The VAT number is not in the Saudi format (15 digits, starting and ending with 3). Format only, not confirmed with the registry." });
  }

  if (!subject.cr) add({ id: "no_cr", severity: "info", text: "No commercial registration number is on record." });
  else if (looksNumeric(subject.cr)) {
    if (isSaudiCrFormat(subject.cr)) positives.push({ id: "cr_format", kind: "ids_format", formatOnly: true, text: "The commercial registration number has the Saudi format (10 digits). Format only, not confirmed with the registry." });
    else add({ id: "cr_format", severity: "medium", formatOnly: true, text: "The commercial registration number is not 10 digits, the Saudi format. Format only, not confirmed with the registry." });
  }

  // Duplicates across suppliers of this workspace. The same number on a record with the same company name is most likely the same
  // company entered twice (a clean-up for the master data); the same number under a different name is the red flag.
  const clash = (key: (i: Identity) => string, hard: boolean, soft: SignalSeverity, id: string, what: string) => {
    const mine = key(subject);
    if (!mine) return;
    const hits = peers.filter((p) => key(p) === mine);
    if (!hits.length) return;
    const dup = hits.filter((h) => sameCompanyName(h.name, subject.name));
    const other = hits.filter((h) => !sameCompanyName(h.name, subject.name));
    if (other.length) add({ id, severity: hard ? "high" : soft, text: `${what} as ${names(other)}, which is a different company name.`, with: ref(other) });
    if (dup.length) add({ id: `${id}_record`, severity: "medium", text: `${what} as ${names(dup)}, which looks like the same company entered twice.`, with: ref(dup) });
  };
  clash((i) => normBank(i.bank), true, "high", "dup_bank", "The bank details are the same");
  clash((i) => normNumber(i.taxId), true, "high", "dup_tax_id", "The VAT or tax number is the same");
  clash((i) => normNumber(i.cr), true, "high", "dup_cr", "The commercial registration number is the same");
  clash((i) => normEmail(i.email), false, "medium", "dup_email", "The email address is the same");
  clash((i) => normPhone(i.phone), false, "low", "dup_phone", "The phone number is the same");

  const q = opts.quote;
  if (q && q.subjectTotal !== null && q.peerTotals.length >= MIN_PEER_QUOTES) {
    const ageDays = (opts.now.getTime() - Date.parse(subject.createdAt)) / 86_400_000;
    const typical = median(q.peerTotals);
    if (ageDays >= 0 && ageDays <= NEW_SUPPLIER_DAYS && typical > 0 && q.subjectTotal >= typical * LARGE_QUOTE_FACTOR) {
      const fmt = opts.formatMoney ?? ((n: number) => String(Math.round(n)));
      add({ id: "new_large_quote", severity: "medium", text: `This supplier was added ${Math.max(0, Math.round(ageDays))} days ago and its largest quote (${fmt(q.subjectTotal)}) is more than ${LARGE_QUOTE_FACTOR} times the usual quote (${fmt(typical)}).` });
    }
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
  signals.sort((a, b) => order[a.severity] - order[b.severity]);
  return { signals, positives };
}

type SignalSeverity = Signal["severity"];

export const hasSeverity = (signals: readonly Signal[], ...levels: SignalSeverity[]): boolean => signals.some((s) => levels.includes(s.severity));
