import crypto from "crypto";

// The preference-centre link: signed like the unsubscribe link (same secret, same
// trust model - the link is the credential, no login), scoped to ONE contact and
// with no expiry: a person should always be able to change their mind from an old
// email. The label in the signed text keeps it from being valid as any other link.

const secret = (): string | null => process.env.QUOTE_PUBLIC_LINK_SECRET || null;
const sign = (payload: string, key: string): string => crypto.createHmac("sha256", key).update(payload).digest("base64url");

/** Null when QUOTE_PUBLIC_LINK_SECRET is not configured (the email then keeps the plain unsubscribe link). */
export function signPreferenceToken(contactId: string): string | null {
  const key = secret();
  return key ? sign(`pref.${contactId}`, key) : null;
}

export function verifyPreferenceToken(contactId: string, token: string): boolean {
  const key = secret();
  if (!key || !token || !contactId) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(sign(`pref.${contactId}`, key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
