import crypto from "crypto";

// Signed, stateless links so a sales order PDF can be opened without a BPMSquare login (a WhatsApp message, an
// email): same trust model as quotePublicLink.ts -- the token embeds its own expiry and is HMAC-signed against
// the order id, so possessing the URL is the whole credential, there is no per-link revocation and no database
// column. The signed payload carries a "sales_order" label, so a token minted for a quote can never open an
// order (and the other way round) even though both use QUOTE_PUBLIC_LINK_SECRET. Without that secret the
// feature is silently unavailable: no token is made and none verifies.

const DEFAULT_TTL_DAYS = 90;
const LABEL = "sales_order";

function secret(): string | null {
  return process.env.QUOTE_PUBLIC_LINK_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** Returns null if QUOTE_PUBLIC_LINK_SECRET isn't configured. */
export function signOrderPublicToken(orderId: string, ttlDays = DEFAULT_TTL_DAYS): string | null {
  const key = secret();
  if (!key) return null;
  const expiresAt = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  return `${expiresAt}.${sign(`${LABEL}.${orderId}.${expiresAt}`, key)}`;
}

export function verifyOrderPublicToken(orderId: string, token: string): boolean {
  const key = secret();
  if (!key || typeof token !== "string") return false;
  const [expiresAtStr, sig] = token.split(".");
  if (!expiresAtStr || !sig) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = sign(`${LABEL}.${orderId}.${expiresAt}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The path (no host) of the public print page; the caller adds the request's own origin. */
export const orderPublicPrintPath = (orderId: string, token: string): string => `/sales-orders/${orderId}/print-public/${token}`;
export const orderPublicPdfPath = (orderId: string, token: string): string => `/api/sales-orders/${orderId}/pdf-public/${token}`;
