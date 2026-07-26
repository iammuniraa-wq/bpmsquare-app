import crypto from "crypto";

// Signed, stateless unsubscribe links -- same trust model as
// lib/quotePublicLink.ts (the link itself is the credential, no login).
// No expiry: an unsubscribe request should always be honorable, unlike the
// time-boxed quote-PDF share link.
function secret(): string | null {
  return process.env.QUOTE_PUBLIC_LINK_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** Returns null if QUOTE_PUBLIC_LINK_SECRET isn't configured (same secret as
 * the quote public-link feature -- both are "prove you hold a link we signed"). */
export function signUnsubscribeToken(accountId: string): string | null {
  const key = secret();
  if (!key) return null;
  return sign(`unsub.${accountId}`, key);
}

export function verifyUnsubscribeToken(accountId: string, token: string): boolean {
  const key = secret();
  if (!key || !token) return false;
  const expected = sign(`unsub.${accountId}`, key);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
