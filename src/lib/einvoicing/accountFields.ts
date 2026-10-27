import { normaliseTaxId } from "./parties";
import { BUYER_ID_SCHEMES, BUYER_TYPES } from "./rules";

// The buyer fields an account carries for Saudi e-invoicing (0219). One list, used by the create route, the PATCH route
// and the tests, so a field added here is accepted everywhere or nowhere. Nothing here decides whether the values are
// VALID for ZATCA -- that is the readiness check's job (a half-filled account must still be saveable); this only makes
// them clean enough to store: trimmed, spaces and dashes removed from registration numbers, enums reduced to their set.

export const ACCOUNT_EINVOICE_KEYS = [
  "vat_number", "crn", "name_ar", "buyer_type", "address_building", "address_district", "buyer_id_number", "buyer_id_scheme",
] as const;
export type AccountEinvoiceKey = (typeof ACCOUNT_EINVOICE_KEYS)[number];

/** Of these, the one that is personal data and must go through encrypt() before it is stored. */
export const ACCOUNT_EINVOICE_ENCRYPTED: readonly AccountEinvoiceKey[] = ["buyer_id_number"];

const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/** Only the keys the body actually carries come back, so a PATCH never blanks a field the form did not send. */
export function cleanAccountEinvoice(body: Record<string, unknown>): Partial<Record<AccountEinvoiceKey, string | null>> {
  const out: Partial<Record<AccountEinvoiceKey, string | null>> = {};
  for (const key of ACCOUNT_EINVOICE_KEYS) {
    if (!(key in body)) continue;
    const v = body[key];
    switch (key) {
      case "vat_number":
      case "crn":
        out[key] = normaliseTaxId(v);
        break;
      case "buyer_type":
        out[key] = (BUYER_TYPES as readonly unknown[]).includes(v) ? (v as string) : null;
        break;
      case "buyer_id_scheme":
        out[key] = (BUYER_ID_SCHEMES as readonly unknown[]).includes(v) ? (v as string) : null;
        break;
      default:
        out[key] = text(v);
    }
  }
  return out;
}

export function hasAccountEinvoiceKeys(body: Record<string, unknown>): boolean {
  return ACCOUNT_EINVOICE_KEYS.some((k) => k in body);
}

/**
 * The account as the v1 API shows it. The hub query reads every column, so once migration 0219 is applied the new keys would
 * appear (as null) on EVERY workspace's response: they are removed unless the workspace has e-invoicing on, and an
 * individual's ID number is never part of an API response.
 */
export function shapeAccountForApi<T extends Record<string, unknown>>(account: T, einvoicingOn: boolean): T {
  const out: Record<string, unknown> = { ...account };
  for (const key of ACCOUNT_EINVOICE_KEYS) {
    if (!einvoicingOn || key === "buyer_id_number") delete out[key];
  }
  return out as T;
}
