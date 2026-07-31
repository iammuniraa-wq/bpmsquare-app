import "server-only";
import crypto from "crypto";

/**
 * The OAuth "state" param round-trips tenantId + connectorId through the
 * provider's consent screen and back -- HMAC-signed so the callback can't be
 * tricked into attaching a stolen code to the wrong tenant (CSRF), and
 * short-lived so a captured redirect URL can't be replayed later.
 */
const TTL_MS = 10 * 60 * 1000;

function secret(): string | null {
  return process.env.CONNECTOR_OAUTH_STATE_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function signOAuthState(tenantId: string, connectorId: string): string | null {
  const key = secret();
  if (!key) return null;
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${tenantId}.${connectorId}.${expiresAt}`;
  return Buffer.from(`${payload}.${sign(payload, key)}`).toString("base64url");
}

export function verifyOAuthState(state: string): { tenantId: string; connectorId: string } | null {
  const key = secret();
  if (!key) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [tenantId, connectorId, expiresAtStr, sig] = decoded.split(".");
  if (!tenantId || !connectorId || !expiresAtStr || !sig) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const expected = sign(`${tenantId}.${connectorId}.${expiresAt}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tenantId, connectorId };
}
