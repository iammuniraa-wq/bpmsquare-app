import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runChecks, countWarnings } from "./checks";
import { resolveRecipientLanguage, countByLanguage } from "./language";
import { signClickToken, verifyClickToken, signOpenToken, verifyOpenToken } from "./linkTokens";
import { resolveBrandKit, sanitizeBrandKit, contrastRatio } from "./brandKit";
import { BUILT_IN_DESIGNS, languageRowsOf } from "./designs";
import { pendingBlocks, languageStatus, sanitizeLanguageRow } from "./sanitize";

const TENANT = "11111111-1111-4111-8111-111111111111";
const kit = resolveBrandKit({}, { name: "Al Noor" });
const monthly = BUILT_IN_DESIGNS.find((d) => d.id === "monthly-update")!;
const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;

describe("runChecks", () => {
  it("passes a tidy English-only design and counts no warnings on the rule-based chips", () => {
    const rows = languageRowsOf(monthly);
    // the monthly design has a button with no link and a product without a picture: those are real findings
    const checks = runChecks({ blocks: monthly.blocks, languages: rows, kit, tenantId: TENANT });
    expect(checks.find((c) => c.id === "footer")?.tone).toBe("good");
    expect(checks.find((c) => c.id === "button-links")?.tone).toBe("warn");
    expect(checks.find((c) => c.id === "spam")?.tone).toBe("good");
    expect(countWarnings(checks)).toBeGreaterThan(0);
  });

  it("flags a long subject, spam words and an unknown field", () => {
    const rows = languageRowsOf(monthly);
    rows[0].subject = "Act now: " + "x".repeat(70);
    rows[0].texts.text1 = { text: "Hi {{nickname}}, this is a guarantee" };
    const checks = runChecks({ blocks: monthly.blocks, languages: rows, kit, tenantId: TENANT });
    expect(checks.find((c) => c.id === "subject-en")?.tone).toBe("warn");
    expect(checks.find((c) => c.id === "spam")?.label).toMatch(/act now.*guarantee|guarantee.*act now/);
    expect(checks.find((c) => c.id === "tokens")?.label).toContain("{{nickname}}");
  });

  it("warns that an added language is not reviewed until every translated block is accepted", () => {
    const rows = languageRowsOf(eid);
    const ar = rows.find((r) => r.lang === "ar")!;
    expect(pendingBlocks(ar, eid.blocks).length).toBeGreaterThan(0);
    expect(languageStatus(ar, eid.blocks)).toBe("draft");
    let checks = runChecks({ blocks: eid.blocks, languages: rows, kit, tenantId: TENANT });
    expect(checks.find((c) => c.id === "review-ar")?.tone).toBe("warn");
    for (const id of Object.keys(ar.review)) ar.review[id] = "reviewed";
    expect(languageStatus(ar, eid.blocks)).toBe("ready");
    checks = runChecks({ blocks: eid.blocks, languages: rows, kit, tenantId: TENANT });
    expect(checks.find((c) => c.id === "review-ar")?.tone).toBe("good");
  });

  it("is deterministic: the same design gives the same chips", () => {
    const a = runChecks({ blocks: monthly.blocks, languages: languageRowsOf(monthly), kit, tenantId: TENANT });
    const b = runChecks({ blocks: monthly.blocks, languages: languageRowsOf(monthly), kit, tenantId: TENANT });
    expect(a).toEqual(b);
  });

  it("the language gate never trusts a client's status", () => {
    const row = sanitizeLanguageRow({ lang: "ar", dir: "ltr", status: "ready", subject: "s", texts: {}, review: { hero1: "translated" } }, eid.blocks)!;
    expect(row.dir).toBe("rtl");
    expect(row.status).toBe("draft");
    expect(sanitizeLanguageRow({ lang: "xx" }, eid.blocks)).toBeNull();
  });
});

describe("resolveRecipientLanguage", () => {
  it("prefers the contact, then the account, then the fallback", () => {
    const included = ["en", "ar"];
    expect(resolveRecipientLanguage({ contactLanguage: "ar", accountLanguage: "en", included, fallback: "en" })).toEqual({ lang: "ar", via: "contact" });
    expect(resolveRecipientLanguage({ contactLanguage: null, accountLanguage: "ar", included, fallback: "en" })).toEqual({ lang: "ar", via: "account" });
    expect(resolveRecipientLanguage({ included, fallback: "en" })).toEqual({ lang: "en", via: "fallback" });
  });

  it("only offers languages the campaign includes", () => {
    expect(resolveRecipientLanguage({ contactLanguage: "fr", accountLanguage: "hi", included: ["en", "ar"], fallback: "ar" })).toEqual({ lang: "ar", via: "fallback" });
    expect(resolveRecipientLanguage({ contactLanguage: "AR ", included: ["en", "ar"], fallback: "en" }).lang).toBe("ar");
  });

  it("falls back to English when the chosen fallback was not ticked, and counts per language", () => {
    expect(resolveRecipientLanguage({ included: ["en", "ar"], fallback: "fr" }).lang).toBe("en");
    expect(resolveRecipientLanguage({ included: ["ar"], fallback: "fr" }).lang).toBe("ar");
    expect(countByLanguage([{ lang: "ar", via: "contact" }, { lang: "en", via: "fallback" }, { lang: "ar", via: "account" }])).toEqual({ ar: 2, en: 1 });
  });
});

describe("signed click and open links", () => {
  const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret-1"; });
  afterEach(() => { if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev; });

  it("verifies its own token and rejects any tampering", () => {
    const t = signClickToken("camp", "rec", 3)!;
    expect(verifyClickToken("camp", "rec", 3, t)).toBe(true);
    expect(verifyClickToken("camp", "rec", 4, t)).toBe(false);
    expect(verifyClickToken("camp", "rec2", 3, t)).toBe(false);
    expect(verifyClickToken("camp2", "rec", 3, t)).toBe(false);
    expect(verifyClickToken("camp", "rec", 3, t.slice(0, -2) + "xx")).toBe(false);
    expect(verifyClickToken("camp", "rec", 3, "")).toBe(false);
    expect(verifyClickToken("camp", "rec", -1, t)).toBe(false);
  });

  it("a token for one purpose is no good for another", () => {
    const click = signClickToken("camp", "rec", 0)!;
    const open = signOpenToken("camp", "rec")!;
    expect(verifyOpenToken("camp", "rec", click)).toBe(false);
    expect(verifyClickToken("camp", "rec", 0, open)).toBe(false);
    expect(verifyOpenToken("camp", "rec", open)).toBe(true);
  });

  it("refuses everything when the secret is not configured", () => {
    const t = signClickToken("camp", "rec", 1)!;
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    expect(signClickToken("camp", "rec", 1)).toBeNull();
    expect(verifyClickToken("camp", "rec", 1, t)).toBe(false);
  });

  it("a token signed under another secret does not verify", () => {
    const t = signClickToken("camp", "rec", 1)!;
    process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret-2";
    expect(verifyClickToken("camp", "rec", 1, t)).toBe(false);
  });
});

describe("brand kit", () => {
  it("accepts only strict hex colours, a known font and https logos", () => {
    const k = sanitizeBrandKit({ primary: "#112233", secondary: "red", text: "#12345", font_pairing: "comic", logo_url: "http://x.example/l.png", social_links: [{ label: "X", url: "javascript:1" }, { label: "In", url: "https://in.example" }] });
    expect(k).toEqual({ primary: "#112233", social_links: [{ label: "In", url: "https://in.example/" }] });
  });

  it("derives sensible defaults and a contrast ratio", () => {
    const r = resolveBrandKit({}, { name: "A", logo_url: "https://cdn.example/logo.png" });
    expect(r.logoUrl).toBe("https://cdn.example/logo.png");
    expect(r.fontPairing).toBe("arial");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
