import { CONSENT_CHANNELS, type ConsentChannel } from "./consent";
import { effectiveBasis, JURISDICTION_RULES, type ConsentBasisSetting, type JurisdictionCode } from "./jurisdictions";

// Recording consent BY A PERSON (the contact's Consent card), pure rules. A rep is
// writing down what someone told them -- "agreed by phone on 20 Oct" -- so:
//   * the note saying how it was obtained is REQUIRED, for a grant and a withdrawal;
//   * the basis is limited to what the person's jurisdiction recognises. The ledger's
//     own rule (effectiveBasis in jurisdictions.ts) is reused: "existing customer" is
//     only recordable where the country recognises it AND the workspace chose it, and
//     only for an account that is a customer;
//   * "legitimate interest" and "contract" are not offered to staff: no rule in the
//     product says when they hold, and marketing needs the person's agreement.
// The ledger itself (recordConsent) is append-only and is the only writer.

/** The channels a person on the contact record can record an answer for. web_tracking belongs to a website visitor. */
export const STAFF_CHANNELS = CONSENT_CHANNELS.filter((c) => c !== "web_tracking") as readonly ConsentChannel[];
export const STAFF_BASES = ["consent", "existing_customer"] as const;
export type StaffBasis = (typeof STAFF_BASES)[number];

export const NOTE_MIN = 3;
export const NOTE_MAX = 300;

export type StaffConsentInput = {
  channel: string;
  status: string;
  basis?: string | null;
  note: string;
};

export type StaffConsentContext = {
  jurisdiction: JurisdictionCode;
  tenantDefaults: Partial<Record<JurisdictionCode, ConsentBasisSetting>>;
  isExistingCustomer: boolean;
};

export type StaffConsentCheck =
  | { ok: true; channel: ConsentChannel; status: "granted" | "withdrawn"; basis: StaffBasis; note: string }
  | { ok: false; error: string };

export function cleanNote(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

/** Which bases the card may offer for this person: always "consent"; "existing customer" only where it is recognised. */
export function offeredBases(ctx: StaffConsentContext): StaffBasis[] {
  const out: StaffBasis[] = ["consent"];
  if (existingCustomerRecordable(ctx)) out.push("existing_customer");
  return out;
}

/**
 * The basis rule for a row of a consent IMPORT (a spreadsheet of opt-ins): the same limits as a person
 * recording by hand, with the basis REQUIRED for an opt-in. A withdrawal needs none.
 */
export function checkImportBasis(status: "granted" | "withdrawn", basis: string | null | undefined, ctx: StaffConsentContext):
  { ok: true; basis: StaffBasis } | { ok: false; error: string } {
  if (status === "withdrawn") return { ok: true, basis: "consent" };
  if (!basis) return { ok: false, error: "Basis is required for an opt-in row (consent or existing_customer)." };
  if (!(STAFF_BASES as readonly string[]).includes(basis)) return { ok: false, error: `Basis "${basis}" can't be imported. Use consent, or existing_customer where your country and settings allow it.` };
  if (basis === "existing_customer" && !existingCustomerRecordable(ctx)) {
    return { ok: false, error: `Basis existing_customer isn't allowed for this person: ${JURISDICTION_RULES[ctx.jurisdiction].label} or your workspace settings don't recognise it. Use consent.` };
  }
  return { ok: true, basis: basis as StaffBasis };
}

export function existingCustomerRecordable(ctx: StaffConsentContext): boolean {
  return ctx.isExistingCustomer
    && JURISDICTION_RULES[ctx.jurisdiction].existingCustomerAllowed
    && effectiveBasis(ctx.jurisdiction, ctx.tenantDefaults) === "existing_customer";
}

export function checkStaffConsent(i: StaffConsentInput, ctx: StaffConsentContext): StaffConsentCheck {
  if (!(STAFF_CHANNELS as readonly string[]).includes(i.channel)) return { ok: false, error: "Choose email, WhatsApp, SMS or phone." };
  if (i.status !== "granted" && i.status !== "withdrawn") return { ok: false, error: "Say whether they agreed or withdrew." };
  const note = cleanNote(i.note);
  if (note.length < NOTE_MIN) {
    return { ok: false, error: i.status === "granted" ? "Say how you got it, for example \"agreed by phone on 20 Oct\"." : "Say how they asked, for example \"asked by phone on 20 Oct\"." };
  }
  if (note.length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };

  // A withdrawal has no basis to justify; it is recorded the way the ledger always has.
  if (i.status === "withdrawn") return { ok: true, channel: i.channel as ConsentChannel, status: "withdrawn", basis: "consent", note };

  const basis = i.basis ?? "consent";
  if (!(STAFF_BASES as readonly string[]).includes(basis)) return { ok: false, error: "That basis can't be recorded by hand. Choose that they agreed, or that they are an existing customer." };
  if (basis === "existing_customer" && !existingCustomerRecordable(ctx)) {
    return {
      ok: false,
      error: !JURISDICTION_RULES[ctx.jurisdiction].existingCustomerAllowed
        ? `In ${JURISDICTION_RULES[ctx.jurisdiction].label} an existing customer is not assumed to agree. Record that they agreed.`
        : !ctx.isExistingCustomer
          ? "Only an account that is already a customer can be recorded this way. Record that they agreed."
          : `Your workspace has not chosen to email existing customers in ${JURISDICTION_RULES[ctx.jurisdiction].label} without an opt-in. Record that they agreed.`,
    };
  }
  return { ok: true, channel: i.channel as ConsentChannel, status: "granted", basis: basis as StaffBasis, note };
}
