import crypto from "crypto";

// PKCE (RFC 7636) for the sign-in-as-a-user flow. The browser that starts the
// sign-in holds the verifier in a cookie; Microsoft only releases the tokens
// to whoever presents it with the code. A code obtained by a different
// browser (an admin tricked into finishing someone else's sign-in link)
// cannot be redeemed here.

export const PKCE_COOKIE = "d365_pkce";
/** Only the callback ever needs it, so it is not sent anywhere else. */
export const PKCE_COOKIE_PATH = "/api/connectors/dynamics365/oauth/callback";
export const PKCE_MAX_AGE_S = 600;

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url"); // 43 chars, within RFC 7636's 43-128
  return { verifier, challenge: challengeFor(verifier) };
}

export function challengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** A verifier is 43-128 unreserved characters; anything else in the cookie is
 *  rejected before it reaches the token request. */
export function validVerifier(v: string | undefined | null): v is string {
  return !!v && /^[A-Za-z0-9._~-]{43,128}$/.test(v);
}
