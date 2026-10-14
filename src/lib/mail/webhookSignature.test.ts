import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySvix, signGeneric, verifyGeneric } from "./webhookSignature";

const raw = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });

describe("verifySvix", () => {
  const keyBytes = crypto.randomBytes(24);
  const secret = `whsec_${keyBytes.toString("base64")}`;
  const now = 1_790_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const sig = crypto.createHmac("sha256", keyBytes).update(`msg_1.${ts}.${raw}`).digest("base64");

  it("accepts a correct signature, including among several", () => {
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, raw, now)).toBe(true);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,AAAA v1,${sig}` }, raw, now)).toBe(true);
  });
  it("refuses a tampered body, a wrong id, an old timestamp, a missing header", () => {
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, raw + " ", now)).toBe(false);
    expect(verifySvix(secret, { id: "msg_2", timestamp: ts, signature: `v1,${sig}` }, raw, now)).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, raw, now + 600_000)).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: null }, raw, now)).toBe(false);
    expect(verifySvix("", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, raw, now)).toBe(false);
  });
});

describe("generic signature", () => {
  it("round-trips and refuses tampering and replay", () => {
    const now = 1_790_000_000_000;
    const t = Math.floor(now / 1000);
    const h = signGeneric("s3cret", raw, t);
    expect(verifyGeneric("s3cret", h, raw, now)).toBe(true);
    expect(verifyGeneric("other", h, raw, now)).toBe(false);
    expect(verifyGeneric("s3cret", h, raw + "x", now)).toBe(false);
    expect(verifyGeneric("s3cret", h, raw, now + 3_600_000)).toBe(false);
    expect(verifyGeneric("s3cret", "garbage", raw, now)).toBe(false);
  });
});
