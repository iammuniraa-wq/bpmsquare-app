import crypto from "crypto";

// Signature checks for inbound-mail webhooks. Pure (no server-only import)
// so they are unit-tested directly.

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Svix (which Resend uses for every webhook): signed content is
 * `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64
 * part of the `whsec_...` secret; `svix-signature` is a space-separated list
 * of `v1,<base64>` (several during a secret rotation). Timestamps more than
 * five minutes off are refused, so a captured request can't be replayed later.
 */
export function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, rawBody: string, nowMs = Date.now()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try { given = Buffer.from(sig, "base64"); } catch { continue; }
    if (safeEqual(given, expected)) return true;
  }
  return false;
}

/** The generic channel: `X-BPMSquare-Signature: t=<unix>,v1=<hex hmac>` over
 *  `${t}.${rawBody}` with INBOUND_EMAIL_SECRET. For any mail service or
 *  relay that can POST JSON (docs/rfq-architecture.md, inbound email). */
export function signGeneric(secret: string, rawBody: string, t: number): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

export function verifyGeneric(secret: string, header: string | null, rawBody: string, nowMs = Date.now()): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300 || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return safeEqual(Buffer.from(parts.v1, "hex"), expected);
}
