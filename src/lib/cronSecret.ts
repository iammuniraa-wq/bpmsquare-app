import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Does this Authorization header carry the cron secret? Compared in constant time:
 * both sides are hashed first so the two buffers always have the same length and
 * `timingSafeEqual` neither throws nor reveals how long the secret is.
 * A missing secret never matches, so an unset env var cannot open the route.
 */
export function cronSecretOk(authorization: string | null | undefined, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = createHash("sha256").update(authorization ?? "").digest();
  const want = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, want);
}
