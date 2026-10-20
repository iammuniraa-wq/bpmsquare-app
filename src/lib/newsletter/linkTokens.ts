import crypto from "crypto";

// Signed, stateless tracking links for newsletter sends -- same trust model as
// lib/campaignInterestLink.ts (the link is the credential, no login, no expiry:
// a genuine email should stay clickable as long as the recipient keeps it).
//
// The click link carries an INDEX into the version's stored link list, never a
// URL, and the signature covers campaign, recipient and index. So there is no
// open redirect: the route verifies the token first, then redirects only to
// links[index] of the version the campaign points at.

const secret = (): string | null => process.env.QUOTE_PUBLIC_LINK_SECRET || null;

const sign = (payload: string, key: string): string => crypto.createHmac("sha256", key).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const clickPayload = (campaignId: string, recipientId: string, index: number) => `nlclick.${campaignId}.${recipientId}.${index}`;
const openPayload = (campaignId: string, recipientId: string) => `nlopen.${campaignId}.${recipientId}`;

/** Null when QUOTE_PUBLIC_LINK_SECRET is not configured (the send then refuses to track). */
export function signClickToken(campaignId: string, recipientId: string, index: number): string | null {
  const key = secret();
  return key ? sign(clickPayload(campaignId, recipientId, index), key) : null;
}

export function verifyClickToken(campaignId: string, recipientId: string, index: number, token: string): boolean {
  const key = secret();
  if (!key || !token || !Number.isInteger(index) || index < 0) return false;
  return safeEqual(token, sign(clickPayload(campaignId, recipientId, index), key));
}

export function signOpenToken(campaignId: string, recipientId: string): string | null {
  const key = secret();
  return key ? sign(openPayload(campaignId, recipientId), key) : null;
}

export function verifyOpenToken(campaignId: string, recipientId: string, token: string): boolean {
  const key = secret();
  if (!key || !token) return false;
  return safeEqual(token, sign(openPayload(campaignId, recipientId), key));
}
