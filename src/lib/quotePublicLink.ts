import crypto from "crypto";
import { headers } from "next/headers";

// Signed, stateless links so a quote PDF can be opened without a BPMSquare login
// (e.g. from a WhatsApp message) -- no DB column, no per-link revocation. The
// token embeds its own expiry and is HMAC-signed against the quote id, so
// possessing the URL is the entire credential, same trust model as a
// password-reset link. Requires QUOTE_PUBLIC_LINK_SECRET to be set; the
// feature is silently unavailable (falls back to no link) without it.

const DEFAULT_TTL_DAYS = 90;

function secret(): string | null {
  return process.env.QUOTE_PUBLIC_LINK_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** Returns null if QUOTE_PUBLIC_LINK_SECRET isn't configured. */
export function signQuotePublicToken(quoteId: string, ttlDays = DEFAULT_TTL_DAYS): string | null {
  const key = secret();
  if (!key) return null;
  const expiresAt = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  return `${expiresAt}.${sign(`${quoteId}.${expiresAt}`, key)}`;
}

/** Absolute URL for the current request's host -- needed because a WhatsApp
 * message has to carry a real, external URL, not a relative path. */
export async function buildAbsoluteUrl(path: string): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : (h.get("x-forwarded-proto") ?? "https");
  return `${proto}://${host}${path}`;
}

export function verifyQuotePublicToken(quoteId: string, token: string): boolean {
  const key = secret();
  if (!key) return false;
  const [expiresAtStr, sig] = token.split(".");
  if (!expiresAtStr || !sig) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = sign(`${quoteId}.${expiresAt}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
