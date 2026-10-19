import { createHmac } from "crypto";

// Blind index for contact emails (docs/marketing-platform-architecture.md
// 1.1.1). Contact emails are AES-GCM encrypted with a random IV per call, so
// two encryptions of one address differ and nothing can look a contact up by
// email. contacts.email_hash is a keyed hash of the normalised address: it can
// find a contact but reveals nothing without the key, and it is never shown,
// exported or returned by any API.
//
// The key is DERIVED from the existing FIELD_ENCRYPTION_KEY -- no new env var.
// The raw encryption key is never used for hashing: a labelled HMAC subkey
// keeps the two uses separate, so a hash can never be turned into a key
// oracle for the cipher. If the key is not set there is no default to fall
// back on; hashing throws a clear error instead.
//
// Deliberately free of `server-only` and `@/` imports so
// scripts/backfill-contact-email-hash.ts can import it directly.

const SUBKEY_LABEL = "bpmsquare:email-blind-index:v1";

export class BlindIndexKeyMissingError extends Error {
  constructor() {
    super("FIELD_ENCRYPTION_KEY is not set, so contact email hashes cannot be computed. Set it (the blind-index key is derived from it) and retry.");
    this.name = "BlindIndexKeyMissingError";
  }
}

/** Trim and lower-case; null for anything that cannot be an address. */
export function normaliseEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const v = email.normalize("NFKC").trim().toLowerCase();
  if (!v || v.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(v)) return null;
  return v;
}

export function deriveBlindIndexKey(encryptionKeyHex: string | null | undefined): Buffer {
  if (!encryptionKeyHex) throw new BlindIndexKeyMissingError();
  return createHmac("sha256", Buffer.from(encryptionKeyHex, "hex")).update(SUBKEY_LABEL).digest();
}

/**
 * HMAC-SHA256 (hex) of the normalised address. Null when the input is not an
 * address. Throws BlindIndexKeyMissingError when there is no key to derive from.
 */
export function emailBlindIndex(
  email: string | null | undefined,
  encryptionKeyHex: string | null | undefined = process.env.FIELD_ENCRYPTION_KEY,
): string | null {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;
  return createHmac("sha256", deriveBlindIndexKey(encryptionKeyHex)).update(normalised).digest("hex");
}
