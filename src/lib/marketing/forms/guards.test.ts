import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkRenderToken, clientIp, createBurstLimiter, hashIp, signRenderToken, uaFamily } from "./guards";

const KEY = "frm_abcdefghijklmnopqrstu";
const HEX = "aa".repeat(32);
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = { s: process.env.QUOTE_PUBLIC_LINK_SECRET, k: process.env.FIELD_ENCRYPTION_KEY }; process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret"; process.env.FIELD_ENCRYPTION_KEY = HEX; });
afterEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = saved.s; process.env.FIELD_ENCRYPTION_KEY = saved.k; });

describe("time to submit", () => {
  const t0 = 1_700_000_000_000;
  it("rejects a post faster than a person can fill the form", () => {
    expect(checkRenderToken(KEY, signRenderToken(KEY, t0), t0 + 1000)).toEqual({ ok: false, reason: "too_fast" });
    expect(checkRenderToken(KEY, signRenderToken(KEY, t0), t0 + 4000)).toEqual({ ok: true });
  });
  it("rejects a missing, forged, re-keyed or expired token", () => {
    expect(checkRenderToken(KEY, undefined, t0).ok).toBe(false);
    expect(checkRenderToken(KEY, `${t0 - 60_000}.forged`, t0)).toEqual({ ok: false, reason: "forged" });
    expect(checkRenderToken("frm_otherotherotherother1", signRenderToken(KEY, t0 - 60_000), t0)).toEqual({ ok: false, reason: "forged" });
    expect(checkRenderToken(KEY, signRenderToken(KEY, t0), t0 + 25 * 3600_000)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects a time in the future", () => {
    expect(checkRenderToken(KEY, signRenderToken(KEY, t0 + 60_000), t0).ok).toBe(false);
  });
});

describe("visitor key", () => {
  it("hashes the address: stable, not the address, different per address", () => {
    const a = hashIp("203.0.113.9");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(hashIp("203.0.113.9")).toBe(a);
    expect(hashIp("203.0.113.10")).not.toBe(a);
    expect(hashIp(null)).toBeNull();
  });
  it("reads the first forwarded address", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(clientIp(h)).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBeNull();
  });
  it("names a browser family and nothing finer", () => {
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("Chrome");
    expect(uaFamily("curl/8.0")).toBe("automated");
    expect(uaFamily(null)).toBe("unknown");
  });
});

describe("burst limiter", () => {
  it("allows up to the maximum in a window, then refuses, then recovers", () => {
    const l = createBurstLimiter({ windowMs: 1000, max: 3 });
    expect([1, 2, 3].map(() => l.hit("a", 0))).toEqual([false, false, false]);
    expect(l.hit("a", 10)).toBe(true);
    expect(l.hit("b", 10)).toBe(false);
    expect(l.hit("a", 2000)).toBe(false);
  });
  it("stays bounded", () => {
    const l = createBurstLimiter({ windowMs: 1000, max: 1, maxKeys: 5 });
    for (let i = 0; i < 50; i++) l.hit(`k${i}`, 0);
    expect(l.hit("k49", 1)).toBe(true);
  });
});
