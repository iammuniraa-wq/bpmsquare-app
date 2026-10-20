// The explanations the two marketing cards on a contact keep behind an "i"
// (docs/design/ux-simplification.md §3 rows 7 and 8). One place, so a test can hold every text to the InfoTip limit
// (two sentences, 160 characters). The cards never print these; they pass them to InfoTip.

import { TIP_MAX_CHARS } from "@/lib/infoTip";
import { EMAIL_STATUS_COPY, type EmailStatus } from "./emailHealth";

export const EMAIL_HEALTH_TIPS = {
  card: "Whether mail to this address works, from delivery reports and our own checks. Nothing on this card sends an email.",
} as const;

export const CONSENT_CARD_TIPS = {
  card: "What this person has agreed to hear from us about. Every answer is kept; a new answer never erases an old one.",
  channel: "Where they agreed to be contacted.",
  consentTopic: "One consent topic, or any. Topics are set in Settings, Marketing, Consent and topics.",
  note: "In your own words, as evidence: for example \"agreed by phone on 20 Oct\".",
  basis: "The reason we may contact them. The stored word is what Data Workbench and the API use.",
} as const;

/** What the stored word is, for the "i" on Basis. Plain word first, the stored word once, in quotes. */
export const BASIS_TIP: Record<string, string> = {
  consent: "They told you they are happy to hear from us, the safe choice everywhere. Stored as \"consent\".",
  existing_customer: "They already buy from us and may hear about similar products, where the law allows. Stored as \"existing_customer\".",
  contract: "We need to contact them to carry out their contract. Stored as \"contract\".",
  legitimate_interest: "We have a business reason they would expect, and balanced it against their rights. Stored as \"legitimate_interest\".",
};

/** The country rule appended to the card's tip when the workspace knows the person's jurisdiction. */
export const consentCardTip = (jurisdictionLabel: string | null): string =>
  jurisdictionLabel
    ? clipTip(`What this person agreed to hear about, under the rules for ${jurisdictionLabel}. Every answer is kept; a new one never erases an old one.`)
    : CONSENT_CARD_TIPS.card;

/** Free text from a person is clipped so the tip stays inside the limit. */
export function clipTip(text: string, max = TIP_MAX_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The status explanation shown behind the card's "i" when nothing is wrong (a problem sentence stays on screen). */
export function emailStatusTip(status: EmailStatus): string {
  const copy = EMAIL_STATUS_COPY[status];
  return clipTip(`${copy.plain} ${copy.todo}`);
}

/** "How we know" for one consent row, behind its "i" on a phone: the basis, where it came from, and the person's own note. */
export function consentRowTip(parts: { basis: string; source: string | null; note: string | null }): string {
  const head = [parts.basis, parts.source].filter(Boolean).join(", ");
  return clipTip(parts.note ? `${head}. ${parts.note}` : head);
}
