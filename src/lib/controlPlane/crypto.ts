import "server-only";
import crypto from "node:crypto";

// The control plane's two signed messages (docs/dedicated-instance.md section 7.1). Ed25519, so an instance holds only PUBLIC keys
// and the control plane stores no secret about any instance:
//   - the summary pull:  a signature over `GET\n/api/platform/summary\n{ts}\n{nonce}`, valid within +-SKEW_SECONDS;
//   - the handoff token: base64url(JSON{sub, inst, iat, exp, jti}) + "." + base64url(signature over that first part),
//     valid for at most HANDOFF_MAX_TTL_SECONDS, bound to ONE instance slug, single use (the jti ledger is the caller's job).
// Everything here is pure: keys are arguments, the env readers are separate, so tests never touch process.env.

export const SUMMARY_PATH = "/api/platform/summary";
export const SKEW_SECONDS = 60;
export const HANDOFF_MAX_TTL_SECONDS = 120;
const MAX_TOKEN_LENGTH = 2000;

const fromB64Pem = (b64: string) => Buffer.from(b64.trim(), "base64").toString("utf8");

/** The control plane's signing key (env CONTROL_PLANE_PRIVATE_KEY: base64 of a PKCS8 PEM). Null when unset or unparseable. */
export function controlPlanePrivateKey(raw = process.env.CONTROL_PLANE_PRIVATE_KEY): crypto.KeyObject | null {
  if (!raw?.trim()) return null;
  try {
    const key = crypto.createPrivateKey(fromB64Pem(raw));
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/** The public keys an instance trusts (env CONTROL_PLANE_PUBLIC_KEYS: comma separated base64 SPKI PEM, so a key can rotate). */
export function controlPlanePublicKeys(raw = process.env.CONTROL_PLANE_PUBLIC_KEYS): crypto.KeyObject[] {
  if (!raw?.trim()) return [];
  const out: crypto.KeyObject[] = [];
  for (const part of raw.split(",")) {
    if (!part.trim()) continue;
    try {
      const key = crypto.createPublicKey(fromB64Pem(part));
      if (key.asymmetricKeyType === "ed25519") out.push(key);
    } catch {
      // A malformed entry is skipped, never trusted; the others stay usable.
    }
  }
  return out;
}

/** This deployment's own slug (env INSTANCE_SLUG). Empty means "not named", and a handoff for it is always refused. */
export const instanceSlug = (): string => (process.env.INSTANCE_SLUG ?? "").trim();

const sign = (priv: crypto.KeyObject, message: string): string => crypto.sign(null, Buffer.from(message), priv).toString("base64url");

function verifyAny(pubs: crypto.KeyObject[], message: string, signature: string): boolean {
  let sig: Buffer;
  try { sig = Buffer.from(signature, "base64url"); } catch { return false; }
  if (sig.length !== 64) return false;
  const data = Buffer.from(message);
  return pubs.some((k) => {
    try { return crypto.verify(null, data, k, sig); } catch { return false; }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Summary pull

export type SummaryHeaders = { "x-cp-ts": string; "x-cp-nonce": string; "x-cp-sig": string };

const summaryMessage = (ts: string, nonce: string) => `GET\n${SUMMARY_PATH}\n${ts}\n${nonce}`;

export function signSummaryRequest(priv: crypto.KeyObject, nowMs = Date.now()): SummaryHeaders {
  const ts = String(Math.floor(nowMs / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  return { "x-cp-ts": ts, "x-cp-nonce": nonce, "x-cp-sig": sign(priv, summaryMessage(ts, nonce)) };
}

export type VerifyFailure = "no_keys" | "malformed" | "signature" | "expired" | "future" | "instance" | "claims";

export function verifySummaryRequest(
  pubs: crypto.KeyObject[],
  h: { ts: string | null; nonce: string | null; sig: string | null },
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: VerifyFailure } {
  if (pubs.length === 0) return { ok: false, reason: "no_keys" };
  if (!h.ts || !h.nonce || !h.sig || !/^\d{9,12}$/.test(h.ts) || !/^[A-Za-z0-9_-]{8,64}$/.test(h.nonce)) return { ok: false, reason: "malformed" };
  if (!verifyAny(pubs, summaryMessage(h.ts, h.nonce), h.sig)) return { ok: false, reason: "signature" };
  const skew = Math.floor(nowMs / 1000) - Number(h.ts);
  if (skew > SKEW_SECONDS) return { ok: false, reason: "expired" };
  if (skew < -SKEW_SECONDS) return { ok: false, reason: "future" };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Handoff token

export type HandoffClaims = { sub: string; inst: string; iat: number; exp: number; jti: string };

export function mintHandoffToken(
  priv: crypto.KeyObject,
  p: { sub: string; inst: string; ttlSeconds?: number; jti?: string },
  nowMs = Date.now(),
): { token: string; claims: HandoffClaims } {
  const iat = Math.floor(nowMs / 1000);
  const ttl = Math.min(Math.max(Math.floor(p.ttlSeconds ?? HANDOFF_MAX_TTL_SECONDS), 1), HANDOFF_MAX_TTL_SECONDS);
  const claims: HandoffClaims = { sub: p.sub, inst: p.inst, iat, exp: iat + ttl, jti: p.jti ?? crypto.randomBytes(16).toString("hex") };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${body}.${sign(priv, body)}`, claims };
}

/**
 * Signature, shape, lifetime and the instance binding. The single-use check (the jti ledger) and the "is this person a platform
 * admin HERE" check need this database, so the route does them next; nothing here is a substitute for either.
 */
export function verifyHandoffToken(
  pubs: crypto.KeyObject[],
  token: unknown,
  expect: { instanceSlug: string },
  nowMs = Date.now(),
): { ok: true; claims: HandoffClaims } | { ok: false; reason: VerifyFailure } {
  if (pubs.length === 0) return { ok: false, reason: "no_keys" };
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  if (!verifyAny(pubs, parts[0], parts[1])) return { ok: false, reason: "signature" };
  let c: Partial<HandoffClaims>;
  try { c = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (
    typeof c?.sub !== "string" || !c.sub || typeof c.inst !== "string" || !c.inst || typeof c.jti !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(c.jti) ||
    !Number.isInteger(c.iat) || !Number.isInteger(c.exp)
  ) return { ok: false, reason: "malformed" };
  const now = Math.floor(nowMs / 1000);
  // A token that lives longer than the maximum is refused outright: the control plane never mints one, so it is not ours.
  if ((c.exp as number) - (c.iat as number) > HANDOFF_MAX_TTL_SECONDS || (c.exp as number) <= (c.iat as number)) return { ok: false, reason: "claims" };
  if (now >= (c.exp as number)) return { ok: false, reason: "expired" };
  if ((c.iat as number) - now > SKEW_SECONDS) return { ok: false, reason: "future" };
  if (!expect.instanceSlug || c.inst !== expect.instanceSlug) return { ok: false, reason: "instance" };
  return { ok: true, claims: c as HandoffClaims };
}

// ---------------------------------------------------------------------------------------------------------------------
// Key generation (scripts/dedicated/gen-secrets.mjs --control-plane keeps its own copy of these two lines)

export function generateControlPlaneKeys(): { privateKeyEnv: string; publicKeyEnv: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyEnv: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
    publicKeyEnv: Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64"),
  };
}
