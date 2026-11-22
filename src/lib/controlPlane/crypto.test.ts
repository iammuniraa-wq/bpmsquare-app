import { describe, expect, it } from "vitest";
import {
  HANDOFF_MAX_TTL_SECONDS, controlPlanePrivateKey, controlPlanePublicKeys, generateControlPlaneKeys, mintHandoffToken,
  signSummaryRequest, verifyHandoffToken, verifySummaryRequest,
} from "./crypto";

const make = () => {
  const k = generateControlPlaneKeys();
  return { priv: controlPlanePrivateKey(k.privateKeyEnv)!, pubs: controlPlanePublicKeys(k.publicKeyEnv), env: k };
};
const asHeaders = (h: ReturnType<typeof signSummaryRequest>) => ({ ts: h["x-cp-ts"], nonce: h["x-cp-nonce"], sig: h["x-cp-sig"] });
const NOW = 1_800_000_000_000;

describe("control plane keys", () => {
  it("round-trips through the two env formats, and an unset or garbage value is no key", () => {
    const { priv, pubs } = make();
    expect(priv).not.toBeNull();
    expect(pubs).toHaveLength(1);
    expect(controlPlanePrivateKey("")).toBeNull();
    expect(controlPlanePrivateKey("not a key")).toBeNull();
    expect(controlPlanePublicKeys(undefined)).toEqual([]);
    expect(controlPlanePublicKeys("%%%,")).toEqual([]);
  });

  it("several public keys can be trusted at once (rotation), a bad entry is skipped", () => {
    const a = make(), b = make();
    const both = controlPlanePublicKeys(`${a.env.publicKeyEnv}, junk ,${b.env.publicKeyEnv}`);
    expect(both).toHaveLength(2);
    const token = mintHandoffToken(b.priv, { sub: "a@x.test", inst: "kamco" }, NOW).token;
    expect(verifyHandoffToken(both, token, { instanceSlug: "kamco" }, NOW).ok).toBe(true);
  });
});

describe("signed summary request", () => {
  it("verifies a fresh signature", () => {
    const { priv, pubs } = make();
    expect(verifySummaryRequest(pubs, asHeaders(signSummaryRequest(priv, NOW)), NOW)).toEqual({ ok: true });
  });

  it("refuses a missing or tampered header", () => {
    const { priv, pubs } = make();
    const h = asHeaders(signSummaryRequest(priv, NOW));
    expect(verifySummaryRequest(pubs, { ts: null, nonce: null, sig: null }, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySummaryRequest(pubs, { ...h, nonce: "ffffffffffffffff" }, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifySummaryRequest(pubs, { ...h, ts: String(Number(h.ts) + 1) }, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a signature from another key", () => {
    const a = make(), b = make();
    expect(verifySummaryRequest(b.pubs, asHeaders(signSummaryRequest(a.priv, NOW)), NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("accepts +-60 s of clock skew and refuses beyond it", () => {
    const { priv, pubs } = make();
    const h = asHeaders(signSummaryRequest(priv, NOW));
    expect(verifySummaryRequest(pubs, h, NOW + 60_000).ok).toBe(true);
    expect(verifySummaryRequest(pubs, h, NOW - 60_000).ok).toBe(true);
    expect(verifySummaryRequest(pubs, h, NOW + 61_000)).toEqual({ ok: false, reason: "expired" });
    expect(verifySummaryRequest(pubs, h, NOW - 61_000)).toEqual({ ok: false, reason: "future" });
  });

  it("with no public key configured nothing verifies", () => {
    const { priv } = make();
    expect(verifySummaryRequest([], asHeaders(signSummaryRequest(priv, NOW)), NOW)).toEqual({ ok: false, reason: "no_keys" });
  });
});

describe("handoff token", () => {
  it("round-trips and carries the claims", () => {
    const { priv, pubs } = make();
    const { token, claims } = mintHandoffToken(priv, { sub: "owner@x.test", inst: "kamco" }, NOW);
    const v = verifyHandoffToken(pubs, token, { instanceSlug: "kamco" }, NOW + 5_000);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims).toEqual(claims);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(HANDOFF_MAX_TTL_SECONDS);
  });

  it("never mints a token that lives longer than 120 s, however long a caller asks", () => {
    const { priv } = make();
    expect(mintHandoffToken(priv, { sub: "a@x.test", inst: "k", ttlSeconds: 3600 }, NOW).claims.exp - Math.floor(NOW / 1000)).toBe(120);
  });

  it("refuses a tampered payload (a different subject under the old signature)", () => {
    const { priv, pubs } = make();
    const { token } = mintHandoffToken(priv, { sub: "owner@x.test", inst: "kamco" }, NOW);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), sub: "attacker@x.test" })).toString("base64url");
    expect(verifyHandoffToken(pubs, `${forged}.${sig}`, { instanceSlug: "kamco" }, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a token signed with a key the instance does not trust", () => {
    const a = make(), b = make();
    const { token } = mintHandoffToken(a.priv, { sub: "owner@x.test", inst: "kamco" }, NOW);
    expect(verifyHandoffToken(b.pubs, token, { instanceSlug: "kamco" }, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses an expired token", () => {
    const { priv, pubs } = make();
    const { token } = mintHandoffToken(priv, { sub: "owner@x.test", inst: "kamco" }, NOW);
    expect(verifyHandoffToken(pubs, token, { instanceSlug: "kamco" }, NOW + 120_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a token minted for another instance, and any token when the instance has no slug", () => {
    const { priv, pubs } = make();
    const { token } = mintHandoffToken(priv, { sub: "owner@x.test", inst: "kamco" }, NOW);
    expect(verifyHandoffToken(pubs, token, { instanceSlug: "pcbs" }, NOW)).toEqual({ ok: false, reason: "instance" });
    expect(verifyHandoffToken(pubs, token, { instanceSlug: "" }, NOW)).toEqual({ ok: false, reason: "instance" });
  });

  it("refuses a token minted in the future beyond the skew allowance", () => {
    const { priv, pubs } = make();
    const { token } = mintHandoffToken(priv, { sub: "owner@x.test", inst: "kamco" }, NOW + 90_000);
    expect(verifyHandoffToken(pubs, token, { instanceSlug: "kamco" }, NOW)).toEqual({ ok: false, reason: "future" });
  });

  it("refuses malformed input", () => {
    const { pubs } = make();
    for (const t of [undefined, null, 5, "", "abc", "a.b.c", ".", "x".repeat(5000)]) {
      expect(verifyHandoffToken(pubs, t, { instanceSlug: "kamco" }, NOW).ok).toBe(false);
    }
  });
});
