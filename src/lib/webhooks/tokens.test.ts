import { describe, expect, it } from "vitest";
import { CALL_OBJECTS, isCallObject, readPath, recordFields, resolveToken, scanTokens, soleToken, tokenSpecs, type RenderContext } from "./tokens";

describe("token whitelist", () => {
  it("knows exactly the two call objects", () => {
    expect(CALL_OBJECTS.map((o) => o.key)).toEqual(["accounts", "standard_quotes"]);
    expect(isCallObject("accounts")).toBe(true);
    expect(isCallObject("contacts")).toBe(false);
    expect(isCallObject(undefined)).toBe(false);
  });

  it("resolves a listed token and refuses an unlisted one", () => {
    expect(resolveToken("accounts", "account.name")).toMatchObject({ pii: false });
    expect(resolveToken("accounts", " account.name ")).not.toBeNull();
    expect(resolveToken("accounts", "account.password")).toBeNull();
    expect(resolveToken("accounts", "quote.total")).toBeNull();
    expect(resolveToken("standard_quotes", "account.name")).not.toBeNull();
    expect(resolveToken("standard_quotes", "quote.total")).toMatchObject({ kind: "number" });
    expect(resolveToken("standard_quotes", "quote.lines")).toMatchObject({ kind: "array" });
  });

  it("marks the encrypted account fields as personal data on both objects", () => {
    for (const t of ["account.email", "account.phone", "account.gstin"]) {
      expect(resolveToken("accounts", t)?.pii, t).toBe(true);
      expect(resolveToken("standard_quotes", t)?.pii ?? true, t).toBe(true);
    }
    expect(tokenSpecs("accounts").filter((s) => s.pii).length).toBeGreaterThan(0);
  });

  it("puts no cost, margin or internal field on any whitelist", () => {
    const all = [...tokenSpecs("accounts"), ...tokenSpecs("standard_quotes")].map((s) => s.token).join(" ");
    expect(all).not.toMatch(/cost|margin|internal/i);
  });

  it("opens only the cf_ custom fields of an account and the ERP numbers of a quote", () => {
    expect(resolveToken("accounts", "account.custom.cf_region")).not.toBeNull();
    expect(resolveToken("accounts", "account.custom.region")).toBeNull();
    expect(resolveToken("accounts", "account.custom.cf_x.y")).toBeNull();
    expect(resolveToken("standard_quotes", "quote.external.dynamics365")).not.toBeNull();
    expect(resolveToken("accounts", "quote.external.dynamics365")).toBeNull();
  });

  it("lists the record fields without the system ones", () => {
    const f = recordFields("accounts").map((x) => x.path);
    expect(f).toContain("account.name");
    expect(f).not.toContain("event");
    expect(f).not.toContain("record.id");
  });
});

describe("scanning", () => {
  it("finds tokens and stray braces", () => {
    expect(scanTokens("Hi {{account.name}} / {{ quote.ref }}")).toEqual({ names: ["account.name", "quote.ref"], stray: false });
    expect(scanTokens("a {{ b").stray).toBe(true);
    expect(scanTokens("a }} b").stray).toBe(true);
    expect(scanTokens("{{{account.name}}}")).toEqual({ names: ["account.name"], stray: false });
  });

  it("recognises a string that is exactly one token", () => {
    expect(soleToken("{{quote.lines}}")).toBe("quote.lines");
    expect(soleToken("{{ quote.lines }}")).toBe("quote.lines");
    expect(soleToken("x {{quote.lines}}")).toBeNull();
    expect(soleToken("{{a}}{{b}}")).toBeNull();
  });
});

describe("readPath", () => {
  const ctx = { event: "e", sent_at: "t", delivery_id: "d", workspace: { name: "W" }, record: { id: "1", url: "u" }, account: { name: "Acme", custom: { cf_x: "1" } } } as RenderContext;

  it("reads nested values", () => {
    expect(readPath(ctx, "account.name")).toBe("Acme");
    expect(readPath(ctx, "account.custom.cf_x")).toBe("1");
    expect(readPath(ctx, "workspace.name")).toBe("W");
  });

  it("can never reach a prototype or a non-own key", () => {
    for (const p of ["__proto__", "constructor", "account.__proto__", "account.constructor.name", "account.toString", "account.name.length", "a b", "account..name", "account.na-me"]) {
      expect(readPath(ctx, p), p).toBeUndefined();
    }
  });
});
