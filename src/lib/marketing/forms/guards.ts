import crypto from "crypto";
import { LIMITS } from "./types";

// The abuse guards of the public form (docs/marketing-platform-architecture.md
// 5.1): a time-to-submit check, a hashed visitor key for the rate limit, a coarse
// browser family for the consent evidence, and a small in-process burst limiter.
// Pure apart from reading two environment secrets, so they test without a server.

const signingSecret = (): string | null => process.env.QUOTE_PUBLIC_LINK_SECRET || null;

const sign = (payload: string, key: string): string => crypto.createHmac("sha256", key).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Time to submit ────────────────────────────────────────────────────────

/**
 * Handed to the page when it renders: the time, signed against the form's key, so a script cannot claim
 * the form was opened ten minutes ago. Without QUOTE_PUBLIC_LINK_SECRET the time is unsigned (still a
 * speed bump, no longer a proof).
 */
export function signRenderToken(formKey: string, now: number = Date.now()): string {
  const secret = signingSecret();
  return `${now}.${secret ? sign(`frmrender.${formKey}.${now}`, secret) : "u"}`;
}

export type RenderCheck = { ok: true } | { ok: false; reason: "missing" | "forged" | "too_fast" | "expired" };

export function checkRenderToken(formKey: string, token: unknown, now: number = Date.now()): RenderCheck {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const [ts, sig] = token.split(".");
  const at = Number(ts);
  if (!Number.isFinite(at) || at <= 0 || at > now + 5_000 || !sig) return { ok: false, reason: "forged" };
  const secret = signingSecret();
  if (secret && !safeEqual(sig, sign(`frmrender.${formKey}.${at}`, secret))) return { ok: false, reason: "forged" };
  const seconds = (now - at) / 1000;
  if (seconds < LIMITS.minSeconds) return { ok: false, reason: "too_fast" };
  if (seconds > LIMITS.maxAgeSeconds) return { ok: false, reason: "expired" };
  return { ok: true };
}

// ── Who is asking ─────────────────────────────────────────────────────────

/** The caller's address from the proxy headers. Used only to be hashed; never stored. */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const xff = h.get("x-forwarded-for");
  const first = (xff ? xff.split(",")[0] : h.get("x-real-ip"))?.trim();
  return first && first.length <= 64 ? first : null;
}

/**
 * HMAC of the address with a labelled subkey, so a stored hash is neither the address nor a
 * key oracle. Null when there is no key or no address (the limiter then falls back to the
 * in-process counter only). The same visitor always gets the same hash: the consent
 * evidence must be comparable later.
 */
export function hashIp(ip: string | null, keyHex: string | null | undefined = process.env.FIELD_ENCRYPTION_KEY): string | null {
  if (!ip) return null;
  const secret = keyHex ? Buffer.from(keyHex, "hex") : signingSecret() ? Buffer.from(signingSecret() as string) : null;
  if (!secret || secret.length === 0) return null;
  const sub = crypto.createHmac("sha256", secret).update("bpmsquare:form-ip:v1").digest();
  return crypto.createHmac("sha256", sub).update(ip).digest("hex");
}

/** A browser family, nothing finer: enough to tell a person from a script, not a device. */
export function uaFamily(ua: string | null | undefined): string {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/bot|crawl|spider|curl|wget|python|httpclient|java\/|go-http|axios|node-fetch|headless/.test(s)) return "automated";
  if (s.includes("edg/") || s.includes("edge/")) return "Edge";
  if (s.includes("opr/") || s.includes("opera")) return "Opera";
  if (s.includes("samsungbrowser")) return "Samsung Internet";
  if (s.includes("firefox/")) return "Firefox";
  if (s.includes("chrome/") || s.includes("crios/")) return "Chrome";
  if (s.includes("safari/")) return "Safari";
  return "other";
}

// ── Burst limiter ─────────────────────────────────────────────────────────

/**
 * A fixed-window counter held in this process. It stops a flood before it costs a database round trip;
 * the database check (recent submissions by the same hashed visitor) is the one that holds across
 * servers. It stores only a salted visitor hash and a count, never tenant data, and it is bounded.
 */
export function createBurstLimiter(opts: { windowMs: number; max: number; maxKeys?: number }) {
  const hits = new Map<string, { n: number; start: number }>();
  const cap = opts.maxKeys ?? 5000;
  return {
    /** True when this call is over the limit. */
    hit(key: string, now: number = Date.now()): boolean {
      const cur = hits.get(key);
      if (!cur || now - cur.start >= opts.windowMs) {
        if (hits.size >= cap) {
          for (const [k, v] of hits) if (now - v.start >= opts.windowMs) hits.delete(k);
          if (hits.size >= cap) hits.clear();
        }
        hits.set(key, { n: 1, start: now });
        return false;
      }
      cur.n++;
      return cur.n > opts.max;
    },
  };
}

export const formBurst = createBurstLimiter({ windowMs: 10 * 60_000, max: 12 });
