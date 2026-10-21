import { describe, expect, it } from "vitest";
import { cronSecretOk } from "./cronSecret";

describe("cronSecretOk", () => {
  it("accepts exactly the bearer secret", () => {
    expect(cronSecretOk("Bearer s3cret-value", "s3cret-value")).toBe(true);
  });

  it("refuses anything else, whatever its length, without throwing", () => {
    for (const given of [null, undefined, "", "Bearer ", "Bearer s3cret-valuf", "Bearer s3cret-value ", "bearer s3cret-value", "s3cret-value", "Bearer " + "x".repeat(5000)]) {
      expect(cronSecretOk(given, "s3cret-value"), String(given).slice(0, 30)).toBe(false);
    }
  });

  it("an unset or empty secret never matches, not even an empty header", () => {
    expect(cronSecretOk("Bearer undefined", undefined)).toBe(false);
    expect(cronSecretOk("Bearer ", "")).toBe(false);
    expect(cronSecretOk("", "")).toBe(false);
  });
});
