import "server-only";
import crypto from "crypto";

// The action token: proof that THIS server showed THIS person a card for THIS workspace. It is signed, not
// secret-bearing: it carries ids and hashes, never values. What it binds:
//   tenant + user  - a card shown to someone else (or in another workspace) is useless to anyone but its owner
//   card hash      - the card's structure: action, object, route and the exact fields it offered. Values are the
//                    person's to edit, so they are not in the hash; the fields they may set are.
//   duplicate hash - the similar records the person saw; a different set at press time asks them to look again
// Single use is enforced by the ledger (ledger.ts), keyed on the card id inside the token.

export const TOKEN_TTL_MS = 30 * 60 * 1000;

export type TokenPayload = {
  v: 1;
  cid: string;
  tid: string;
  uid: string;
  act: string;
  h: string;
  dup: string;
  /** The assistant's own sentence on the card, kept for the audit row. */
  sm: string;
  /** What the card proposed, as a short hash per non-empty field, so the audit can say which values the person changed. */
  pv: Record<string, string>;
  exp: number;
};

function key(): Buffer {
  // The service-role key is already a server-only secret in every deployment; a derived key means a leaked token
  // signature reveals nothing about it and no new environment variable has to exist before this works.
  const base = process.env.ASSISTANT_ACTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("assistant action signing key is not configured");
  return crypto.createHmac("sha256", "bpmsquare.assistant.action.v1").update(base).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string): string => crypto.createHmac("sha256", key()).update(body).digest("base64url");

export function hashOf(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 32);
}

export function signToken(p: Omit<TokenPayload, "v" | "exp"> & { exp?: number }, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...p, v: 1, exp: p.exp ?? now + TOKEN_TTL_MS }));
  return `${body}.${sign(body)}`;
}

export type TokenFailure = "malformed" | "signature" | "expired" | "tenant" | "user" | "card";

/** Verifies signature, expiry and the caller's binding. Never throws on a bad token. */
export function verifyToken(
  token: unknown,
  expect: { tenantId: string; userId: string; cardId: string },
  now = Date.now(),
): { ok: true; payload: TokenPayload } | { ok: false; reason: TokenFailure } {
  if (typeof token !== "string" || token.length > 4000) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let payload: TokenPayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (payload?.v !== 1 || typeof payload.cid !== "string") return { ok: false, reason: "malformed" };
  if (!Number.isFinite(payload.exp) || now > payload.exp) return { ok: false, reason: "expired" };
  if (payload.tid !== expect.tenantId) return { ok: false, reason: "tenant" };
  if (payload.uid !== expect.userId) return { ok: false, reason: "user" };
  if (payload.cid !== expect.cardId) return { ok: false, reason: "card" };
  return { ok: true, payload };
}
