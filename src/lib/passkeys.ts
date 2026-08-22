import "server-only";

import { createHmac, timingSafeEqual, createHash } from "crypto";

/**
 * Passkey (WebAuthn) support pieces shared by the four /api/auth/passkey
 * routes. The verification itself is @simplewebauthn/server; this module
 * owns what's codebase-specific:
 *
 * - The relying-party identity comes from the REQUEST HOST (each tenant runs
 *   on its own domain, so a credential is bound to that tenant's domain --
 *   the same per-host resolution the login page's branding uses).
 * - The challenge round-trip: options are generated in one request and
 *   verified in another, so the challenge travels in a short-lived, signed,
 *   httpOnly cookie rather than a DB row. The HMAC key derives from
 *   SUPABASE_SERVICE_ROLE_KEY exactly like the kiosk match tickets -- no new
 *   secret to provision.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_COOKIE = "bpm_pk_chal";

function key(): Buffer {
  return createHash("sha256")
    .update(`${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}:bpm-passkey-challenge`)
    .digest();
}

/** purpose separates registration cookies from login cookies so one can never
 *  be replayed as the other; uid binds a registration to the session user. */
export function signChallenge(challenge: string, purpose: "reg" | "auth", uid = ""): string {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const body = `${challenge}.${purpose}.${uid}.${exp}`;
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyChallenge(token: string | undefined, purpose: "reg" | "auth", uid = ""): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [challenge, p, u, expStr, mac] = parts;
  if (p !== purpose || u !== uid) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = createHmac("sha256", key()).update(`${challenge}.${p}.${u}.${expStr}`).digest();
  const got = Buffer.from(mac, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return challenge;
}

/** rpID = the bare hostname; origin = https://host. Everything WebAuthn
 *  verifies is anchored to these, per tenant domain. */
export function relyingParty(host: string): { rpID: string; origin: string } {
  const rpID = host.split(":")[0].toLowerCase();
  return { rpID, origin: `https://${rpID}` };
}
