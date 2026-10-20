import { createHmac } from "crypto";

// WhatsApp numbers. Pure and free of `server-only` so tests can import it.
//
// A contact's phone is stored encrypted with a random IV, so nothing can look a contact up by phone.
// An inbound message arrives with only the sender's number, so a keyed hash of the normalised number
// (the same idea as contacts.email_hash, src/lib/marketing/blindIndex.ts) is kept in whatsapp_numbers.
// The key is derived from FIELD_ENCRYPTION_KEY with its own label; the hash cannot be reversed.

const SUBKEY_LABEL = "bpmsquare:phone-blind-index:v1";

/** Calling codes by the country names and codes a contact record carries. Only for a local number written with a leading 0. */
const CALLING_CODE: Record<string, string> = {
  "saudi arabia": "966", ksa: "966", sa: "966",
  "united arab emirates": "971", uae: "971", ae: "971",
  qatar: "974", qa: "974",
  kuwait: "965", kw: "965",
  oman: "968", om: "968",
  bahrain: "973", bh: "973",
  india: "91", in: "91",
};

const ARABIC_INDIC = /[٠-٩]/g;
const EASTERN_ARABIC_INDIC = /[۰-۹]/g;

/**
 * A phone as "+<country code><number>", or null when it cannot be one. A number must start with + or 00,
 * or be a local number with a leading 0 for a country we know the code of; anything else is refused rather
 * than guessed (a wrong country code messages a stranger).
 */
export function normalisePhone(raw: string | null | undefined, country?: string | null): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.normalize("NFKC").trim();
  if (!s) return null;
  s = s.replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660)).replace(EASTERN_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0));
  const international = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);
  if (!international) {
    const code = country ? CALLING_CODE[country.trim().toLowerCase()] : undefined;
    if (!code || !digits.startsWith("0")) return null;
    digits = code + digits.slice(1);
  }
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
}

export class PhoneKeyMissingError extends Error {
  constructor() {
    super("FIELD_ENCRYPTION_KEY is not set, so WhatsApp number hashes cannot be computed.");
    this.name = "PhoneKeyMissingError";
  }
}

/** HMAC-SHA256 (hex) of a normalised "+number". Throws PhoneKeyMissingError when there is no key to derive from. */
export function phoneBlindIndex(e164: string, encryptionKeyHex: string | null | undefined = process.env.FIELD_ENCRYPTION_KEY): string {
  if (!encryptionKeyHex) throw new PhoneKeyMissingError();
  const sub = createHmac("sha256", Buffer.from(encryptionKeyHex, "hex")).update(SUBKEY_LABEL).digest();
  return createHmac("sha256", sub).update(e164).digest("hex");
}

/** "+966 5•• ••• 123": enough for a person to recognise their own number, never the whole thing. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (d.length < 7) return "••••";
  return `+${d.slice(0, 3)} ••• •••${d.slice(-3)}`;
}
