import "server-only";
import crypto from "crypto";
import { normalizeQuery } from "./webQuery";
import type { WebAllow } from "./webConsent";

// Signed proof that THIS server showed THIS person a web-search chip (audit 2026-10-22 L5). The dock used to assert
// consent by sending "once" and the query; nothing showed the server had asked. The token binds tenant + person + hash
// of the query on the chip + the consent id shown with it, and is short-lived. "Yes" sends it back. It is also spent on
// first use (claimWebConsent in research.ts), so a copy of one request cannot be replayed for a second search.
// Same derived-key approach as the action token (actions/token.ts), with its own domain so one never verifies as the other.

export const ONCE_TTL_MS = 10 * 60 * 1000;

type Payload = { v: 1; k: "once"; tid: string; uid: string; cid: string; q: string; exp: number };

function key(): Buffer {
  const base = process.env.ASSISTANT_ACTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("assistant consent signing key is not configured");
  return crypto.createHmac("sha256", "bpmsquare.assistant.consent.v1").update(base).digest();
}

const sign = (body: string): string => crypto.createHmac("sha256", key()).update(body).digest("base64url");
const encode = (p: Payload): string => { const body = Buffer.from(JSON.stringify(p)).toString("base64url"); return `${body}.${sign(body)}`; };

export const queryHash = (query: string): string =>
  crypto.createHash("sha256").update(normalizeQuery(query).toLowerCase()).digest("base64url").slice(0, 32);

export function issueOnceConsent(i: { tenantId: string; userId: string; query: string; id: string }, now = Date.now()): string {
  return encode({ v: 1, k: "once", tid: i.tenantId, uid: i.userId, cid: i.id, q: queryHash(i.query), exp: now + ONCE_TTL_MS });
}

export type ConsentFailure = "malformed" | "signature" | "expired" | "tenant" | "user" | "query";

/** Verifies signature, expiry, who it was issued to and the exact query. Never throws on a bad token. */
export function verifyConsent(
  token: unknown,
  expect: { tenantId: string; userId: string; query?: string | null },
  now = Date.now(),
): { ok: true; id: string } | { ok: false; reason: ConsentFailure } {
  if (typeof token !== "string" || token.length > 1000) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let p: Payload;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  // A token of the retired "chat" kind verifies as malformed: nothing grants a standing permission any more.
  if (p?.v !== 1 || p.k !== "once" || typeof p.cid !== "string") return { ok: false, reason: "malformed" };
  if (!Number.isFinite(p.exp) || now > p.exp) return { ok: false, reason: "expired" };
  if (p.tid !== expect.tenantId) return { ok: false, reason: "tenant" };
  if (p.uid !== expect.userId) return { ok: false, reason: "user" };
  if (!expect.query || p.q !== queryHash(expect.query)) return { ok: false, reason: "query" };
  return { ok: true, id: p.cid };
}

export type ResolvedConsent = {
  allow: WebAllow | null;
  consentQuery: string | null;
  consentId: string | null;
};

const NONE: ResolvedConsent = { allow: null, consentQuery: null, consentId: null };

/**
 * What the request is allowed to do on the web, after checking the claim against the signed token. Anything the token
 * does not prove is no permission at all: the model then asks again with a chip, as if nothing had been sent.
 */
export function resolveWebConsent(
  i: { tenantId: string; userId: string; allow: WebAllow | null; query: string | null; token: unknown },
  now = Date.now(),
): ResolvedConsent {
  if (!i.allow) return NONE;
  const v = verifyConsent(i.token, { tenantId: i.tenantId, userId: i.userId, query: i.query }, now);
  if (!v.ok) return NONE;
  return { allow: "once", consentQuery: i.query, consentId: v.id };
}
