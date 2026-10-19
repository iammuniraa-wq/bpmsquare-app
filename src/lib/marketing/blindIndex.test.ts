import { describe, it, expect } from "vitest";
import { BlindIndexKeyMissingError, deriveBlindIndexKey, emailBlindIndex, normaliseEmail } from "./blindIndex";

const KEY_A = "00".repeat(32);
const KEY_B = "11".repeat(32);

describe("normaliseEmail", () => {
  it("trims and lower-cases", () => {
    expect(normaliseEmail("  Sales@Acme.COM ")).toBe("sales@acme.com");
  });
  it("returns null for things that are not addresses", () => {
    for (const v of ["", "   ", "no-at-sign", "a b@c.com", null, undefined]) expect(normaliseEmail(v as string | null)).toBeNull();
  });
  it("folds compatibility characters so look-alike forms hash the same", () => {
    expect(normaliseEmail("ＡＢＣ@acme.com")).toBe("abc@acme.com");
  });
});

describe("emailBlindIndex", () => {
  it("is stable, hex, 64 chars", () => {
    const h = emailBlindIndex("a@b.com", KEY_A);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(emailBlindIndex("a@b.com", KEY_A)).toBe(h);
  });

  it("gives the same hash however the address is cased or padded", () => {
    expect(emailBlindIndex("  A@B.com", KEY_A)).toBe(emailBlindIndex("a@b.COM  ", KEY_A));
  });

  it("differs per address and per key", () => {
    expect(emailBlindIndex("a@b.com", KEY_A)).not.toBe(emailBlindIndex("c@b.com", KEY_A));
    expect(emailBlindIndex("a@b.com", KEY_A)).not.toBe(emailBlindIndex("a@b.com", KEY_B));
  });

  it("does not contain the address", () => {
    expect(emailBlindIndex("secret.person@acme.com", KEY_A)).not.toContain("secret");
  });

  it("returns null for non-addresses without needing a key", () => {
    expect(emailBlindIndex("not an email", undefined)).toBeNull();
    expect(emailBlindIndex(null, undefined)).toBeNull();
  });

  it("throws a clear error when there is no key -- no default is ever used", () => {
    expect(() => emailBlindIndex("a@b.com", undefined)).toThrow(BlindIndexKeyMissingError);
    expect(() => emailBlindIndex("a@b.com", "")).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it("derives a subkey rather than using the encryption key itself", () => {
    const sub = deriveBlindIndexKey(KEY_A);
    expect(sub.toString("hex")).not.toBe(KEY_A);
    expect(sub.length).toBe(32);
  });
});
