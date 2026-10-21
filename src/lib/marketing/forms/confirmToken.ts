import crypto from "crypto";

// The double-opt-in confirm link: signed like the unsubscribe and preference links (same secret,
// no login, the link is the credential) but with an expiry, because it asks a person to say yes:
// seven days (docs/marketing-platform-architecture.md 5.1). The expiry is part of the signed text,
// so it cannot be stretched, and the label in the text keeps the token from being valid as any
// other link. It is scoped to ONE contact.

export const CONFIRM_DAYS = 7;
const DAY_S = 86_400;
const GRACE_S = 600;

const secret = (): string | null => process.env.QUOTE_PUBLIC_LINK_SECRET || null;
const sign = (payload: string, key: string): string => crypto.createHmac("sha256", key).update(payload).digest("base64url");

/** `<expiry seconds>.<signature>`; null when QUOTE_PUBLIC_LINK_SECRET is not configured. */
export function signConfirmToken(contactId: string, now: number = Date.now()): string | null {
  const key = secret();
  if (!key || !contactId) return null;
  const exp = Math.floor(now / 1000) + CONFIRM_DAYS * DAY_S;
  return `${exp}.${sign(`doi.${contactId}.${exp}`, key)}`;
}

export type ConfirmTokenCheck =
  | { ok: true; /** The earliest a pending answer can be for this link to cover it. */ windowStart: string }
  | { ok: false; reason: "invalid" | "expired" };

export function verifyConfirmToken(contactId: string, token: string, now: number = Date.now()): ConfirmTokenCheck {
  const key = secret();
  if (!key || !contactId || typeof token !== "string") return { ok: false, reason: "invalid" };
  const dot = token.indexOf(".");
  if (dot < 1) return { ok: false, reason: "invalid" };
  const expRaw = token.slice(0, dot);
  if (!/^\d{9,12}$/.test(expRaw)) return { ok: false, reason: "invalid" };
  const exp = Number(expRaw);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(`doi.${contactId}.${exp}`, key));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  if (Math.floor(now / 1000) > exp) return { ok: false, reason: "expired" };
  // A little before the link was made: the pending answer is written just before the email is signed.
  return { ok: true, windowStart: new Date((exp - CONFIRM_DAYS * DAY_S - GRACE_S) * 1000).toISOString() };
}
