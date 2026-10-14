import crypto from "crypto";

// Two signed identifiers for one RFQ recipient (rfq_suppliers row):
//
//  1. The REPLY LINK token -- the supplier's no-login credential for the
//     reply page. Same shape as quotePublicLink.ts (expiry + HMAC, timing-safe)
//     plus the row's token_nonce, so cancelling or re-issuing a link rotates
//     the nonce and every older link dies. Domain-separated with an "rfq."
//     prefix so a quote-PDF token can never verify here, or the reverse.
//
//  2. The MAIL CODE -- a short code stamped into the subject ("[RFQ-0012 ·
//     k3f9q2xa]") and the platform reply-to address, so an inbound email can
//     be matched to exactly one recipient without trusting the From header
//     alone. It cannot be forged without the secret, and it is per-recipient,
//     so one supplier's code never lands a message on another's row.
//
// Secret: RFQ_LINK_SECRET, falling back to QUOTE_PUBLIC_LINK_SECRET (the
// domain prefix keeps the two uses apart). Without either, no link is sent
// and inbound routing is off -- the buyer keys replies in.

function secret(): string | null {
  return process.env.RFQ_LINK_SECRET || process.env.QUOTE_PUBLIC_LINK_SECRET || null;
}

export function rfqSecretConfigured(): boolean {
  return !!secret();
}

function hmac(payload: string, key: string): Buffer {
  return crypto.createHmac("sha256", key).update(payload).digest();
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** `${expiresAt}.${sig}` or null without a secret. */
export function signReplyToken(rfqSupplierId: string, nonce: string, expiresAt: number): string | null {
  const key = secret();
  if (!key) return null;
  const sig = hmac(`rfq.reply.${rfqSupplierId}.${nonce}.${expiresAt}`, key).toString("base64url");
  return `${expiresAt}.${sig}`;
}

export type ReplyTokenCheck = { ok: true; expiresAt: number } | { ok: false; reason: "invalid" | "expired" };

/** Verifies the signature against the row's CURRENT nonce. An expired token
 *  is reported as such (the page says "this link has expired", not "invalid"). */
export function verifyReplyToken(rfqSupplierId: string, nonce: string, token: string, now = Date.now()): ReplyTokenCheck {
  const key = secret();
  if (!key || typeof token !== "string") return { ok: false, reason: "invalid" };
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig || !/^\d{10,15}$/.test(expStr)) return { ok: false, reason: "invalid" };
  const expiresAt = Number(expStr);
  const expected = hmac(`rfq.reply.${rfqSupplierId}.${nonce}.${expiresAt}`, key).toString("base64url");
  if (!safeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt };
}

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l

/** 10 characters, ~50 bits: plenty against guessing, short enough to survive
 *  a subject line and a mail client's reply. */
export function mailCode(rfqSupplierId: string): string | null {
  const key = secret();
  if (!key) return null;
  const bytes = hmac(`rfq.mail.${rfqSupplierId}`, key);
  let out = "";
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function mailCodeMatches(rfqSupplierId: string, code: string): boolean {
  const expected = mailCode(rfqSupplierId);
  return !!expected && safeEqual(expected, code.toLowerCase());
}

/** The tag stamped into every RFQ subject. */
export function subjectTag(ref: string, code: string | null): string {
  return code ? `[${ref} · ${code}]` : `[${ref}]`;
}

/** Pulls { ref, code } out of a subject, tolerating "Re:", "AW:", a mail
 *  client that swapped the middle dot for something else, and case. */
export function parseSubjectTag(subject: string | null | undefined): { ref: string; code: string | null } | null {
  const m = /\[\s*(RFQ-\d{1,9})\s*(?:[·•\-|:·\s]+\s*([a-z2-9]{10}))?\s*\]/i.exec(subject ?? "");
  if (!m) return null;
  return { ref: m[1].toUpperCase(), code: m[2] ? m[2].toLowerCase() : null };
}

/** Platform mode reply-to: rfq-<rfqSupplierId without dashes>-<code>@<domain>.
 *  The id is in the address so routing is one indexed lookup; the code is
 *  what makes it unforgeable. */
export function replyToAddress(rfqSupplierId: string, domain: string): string | null {
  const code = mailCode(rfqSupplierId);
  if (!code || !domain) return null;
  return `rfq-${rfqSupplierId.replace(/-/g, "")}-${code}@${domain}`;
}

const UUID_HEX_RE = /^[0-9a-f]{32}$/;

/** The inverse: given any recipient address, the rfq_suppliers id it routes
 *  to -- or null when it isn't one of ours or the code doesn't verify. */
export function parseReplyToAddress(address: string, domain: string): string | null {
  const a = address.trim().toLowerCase().replace(/^.*</, "").replace(/>.*$/, "");
  const at = a.lastIndexOf("@");
  if (at < 0 || a.slice(at + 1) !== domain.toLowerCase()) return null;
  const m = /^rfq-([0-9a-f]{32})-([a-z2-9]{10})$/.exec(a.slice(0, at));
  if (!m || !UUID_HEX_RE.test(m[1])) return null;
  const hex = m[1];
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return mailCodeMatches(id, m[2]) ? id : null;
}
