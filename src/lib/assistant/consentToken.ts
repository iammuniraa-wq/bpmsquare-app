import "server-only";
import crypto from "crypto";
import { normalizeQuery } from "./webQuery";
import type { WebAllow } from "./webConsent";

// Signed proof that THIS server showed THIS person a web-search chip (audit 2026-10-22 L5). The dock used to assert
// consent by sending "once" or "chat" and the query; nothing showed the server had asked. Two kinds:
//   once  tenant + person + hash of the query on the chip + the consent id shown with it; short-lived. "Yes" sends it back.
//   chat  tenant + person + a chat id, minted when a valid "once" token comes back with "Always in this chat". The dock
//         keeps it in memory only, so a reload ends it, exactly as before; the server still checks it on every ask.
// Same derived-key approach as the action token (actions/token.ts), with its own domain so one never verifies as the other.

export const ONCE_TTL_MS = 10 * 60 * 1000;
export const CHAT_TTL_MS = 8 * 60 * 60 * 1000;

type Payload = { v: 1; k: "once" | "chat"; tid: string; uid: string; cid: string; q?: string; exp: number };

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

export function issueChatConsent(i: { tenantId: string; userId: string }, now = Date.now()): string {
  return encode({ v: 1, k: "chat", tid: i.tenantId, uid: i.userId, cid: crypto.randomUUID(), exp: now + CHAT_TTL_MS });
}

export type ConsentFailure = "malformed" | "signature" | "expired" | "tenant" | "user" | "query";

/** Verifies signature, expiry, who it was issued to and (for a "once" token) the exact query. Never throws on a bad token. */
export function verifyConsent(
  token: unknown,
  expect: { tenantId: string; userId: string; query?: string | null },
  now = Date.now(),
): { ok: true; kind: "once" | "chat"; id: string } | { ok: false; reason: ConsentFailure } {
  if (typeof token !== "string" || token.length > 1000) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let p: Payload;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (p?.v !== 1 || (p.k !== "once" && p.k !== "chat") || typeof p.cid !== "string") return { ok: false, reason: "malformed" };
  if (!Number.isFinite(p.exp) || now > p.exp) return { ok: false, reason: "expired" };
  if (p.tid !== expect.tenantId) return { ok: false, reason: "tenant" };
  if (p.uid !== expect.userId) return { ok: false, reason: "user" };
  if (p.k === "once" && (!expect.query || p.q !== queryHash(expect.query))) return { ok: false, reason: "query" };
  return { ok: true, kind: p.k, id: p.cid };
}

export type ResolvedConsent = {
  allow: WebAllow | null;
  consentQuery: string | null;
  consentId: string | null;
  /** The person pressed "Always in this chat" on a chip this server issued: hand them the chat token. */
  mintChat: boolean;
};

const NONE: ResolvedConsent = { allow: null, consentQuery: null, consentId: null, mintChat: false };

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
  if (v.kind === "chat") return i.allow === "chat" ? { allow: "chat", consentQuery: null, consentId: v.id, mintChat: false } : NONE;
  // A "once" token proves one query. With "chat" it is the Always press: this ask runs that query, and the chat starts.
  return { allow: "once", consentQuery: i.query, consentId: v.id, mintChat: i.allow === "chat" };
}
