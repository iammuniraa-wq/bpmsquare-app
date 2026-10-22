import { describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES, MAX_TEMPLATE_BYTES, addressForLog, renderStandard, renderTemplate, renderUrl, standardRecord, validateTemplate, validateUrlTemplate,
} from "./render";
import type { RenderContext } from "./tokens";

describe("addressForLog", () => {
  it("keeps host and path, drops the query, user info and fragment", () => {
    expect(addressForLog("https://erp.example.com/in/v2?sig=abc&code=1#frag")).toBe("https://erp.example.com/in/v2");
    expect(addressForLog("https://user:pw@erp.example.com/in")).toBe("https://erp.example.com/in");
  });
  it("masks a long path segment (Slack and Teams carry the credential there)", () => {
    expect(addressForLog("https://hooks.slack.com/services/T0001/B0002/abcdEFGH1234ijklMNOP5678")).toBe("https://hooks.slack.com/services/T0001/B0002/...");
  });
  it("is empty for nothing or a non-address", () => {
    expect(addressForLog(null)).toBe("");
    expect(addressForLog("nope")).toBe("");
  });
});

const ctx = (over: Partial<RenderContext> = {}): RenderContext => ({
  event: "account.pushed", sent_at: "2026-10-21T10:00:00.000Z", delivery_id: "d-1", workspace: { name: "Acme" },
  record: { id: "a-1", url: "https://acme.example.com/accounts/a-1" },
  account: { id: "a-1", ref: "ACC-0001", name: 'Smith & "Sons" \\ {{x}}', city: "Doha", email: "pat@example.com", custom: { cf_region: "GCC" } },
  ...over,
});

describe("validateTemplate", () => {
  it("accepts JSON with known tokens inside values", () => {
    const r = validateTemplate('{"name":"{{account.name}}","n":["{{account.city}}"],"nested":{"k":"{{event}}"}}', "accounts", false);
    expect(r.ok).toBe(true);
  });

  it("refuses text that is not JSON before any token is looked at", () => {
    for (const s of ["", "{name: {{account.name}}}", '{"a": {{account.name}}}', "[1,", "{{account.name}}"]) {
      const r = validateTemplate(s, "accounts", false);
      expect(r.ok, s).toBe(false);
    }
  });

  it("names an unknown token", () => {
    const r = validateTemplate('{"a":"{{account.secret}}"}', "accounts", false);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors[0].message).toContain("{{account.secret}}");
  });

  it("refuses personal data unless allowed", () => {
    expect(validateTemplate('{"e":"{{account.email}}"}', "accounts", false).ok).toBe(false);
    expect(validateTemplate('{"e":"{{account.email}}"}', "accounts", true).ok).toBe(true);
  });

  it("refuses a stray brace and a token used as a key", () => {
    expect(validateTemplate('{"a":"{{account.name"}', "accounts", false).ok).toBe(false);
    expect(validateTemplate('{"{{account.name}}":"x"}', "accounts", false).ok).toBe(false);
  });

  it("refuses a template over 16 KB", () => {
    const big = JSON.stringify({ a: "x".repeat(MAX_TEMPLATE_BYTES) });
    expect(validateTemplate(big, "accounts", false)).toMatchObject({ ok: false });
  });
});

describe("renderTemplate", () => {
  const tree = (s: string) => {
    const v = validateTemplate(s, "accounts", true);
    if (!v.ok) throw new Error("template should be valid");
    return v.value;
  };

  it("substitutes text and keeps hostile values from breaking the structure", () => {
    const r = renderTemplate(tree('{"name":"Hello {{account.name}}!","ref":"{{account.ref}}"}'), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.json);
    expect(parsed.name).toBe('Hello Smith & "Sons" \\ {{x}}!');
    expect(Object.keys(parsed)).toEqual(["name", "ref"]);
  });

  it("does not scan a substituted value for tokens again", () => {
    const r = renderTemplate(tree('{"a":"{{account.name}}"}'), ctx({ account: { name: "{{account.email}}", email: "leak@example.com" } }));
    expect(r.ok && r.json).toContain("{{account.email}}");
    expect(r.ok && r.json).not.toContain("leak@example.com");
  });

  it("a string that is exactly one token emits that token's JSON value", () => {
    const c = ctx({ quote: { total: 12.5, lines: [{ d: "x" }], flag: false }, account: undefined });
    const v = validateTemplate('{"total":"{{quote.total}}","lines":"{{quote.lines}}","t":"Total {{quote.total}}"}', "standard_quotes", false);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = renderTemplate(v.value, c);
    expect(r.ok && JSON.parse(r.json)).toEqual({ total: 12.5, lines: [{ d: "x" }], t: "Total 12.5" });
  });

  it("empties a missing value: text becomes empty, a sole token becomes null", () => {
    const r = renderTemplate(tree('{"a":"x{{account.state}}y","b":"{{account.state}}"}'), ctx());
    expect(r.ok && JSON.parse(r.json)).toEqual({ a: "xy", b: null });
  });

  it("fails with a plain message over 256 KB", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => ({ description: "x".repeat(100), i }));
    const v = validateTemplate('{"l":"{{quote.lines}}"}', "standard_quotes", false);
    if (!v.ok) throw new Error("valid");
    const r = renderTemplate(v.value, ctx({ quote: { lines }, account: undefined }));
    expect(r).toEqual({ ok: false, message: "The payload is too large." });
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it("fuzz: whatever a record holds, the body is valid JSON with the template's keys", () => {
    const alphabet = ['{', '}', '{{', '}}', '"', "\\", "'", "\n", "\u0000", " ", "é", "😀", "</script>", " ", "a", "{{account.email}}", "\\u0022"];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const t = tree('{"a":"{{account.name}}","b":"pre {{account.city}} post","c":"{{account.notes}}","d":{"e":["{{account.ref}}"]}}');
    for (let i = 0; i < 400; i++) {
      const junk = () => Array.from({ length: Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      const r = renderTemplate(t, ctx({ account: { name: junk(), city: junk(), notes: junk(), ref: junk() } }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const parsed = JSON.parse(r.json);
      expect(Object.keys(parsed)).toEqual(["a", "b", "c", "d"]);
      expect(Object.keys(parsed.d)).toEqual(["e"]);
    }
  });

  it("fuzz: random template text is either rejected or renders to valid JSON, never throws", () => {
    const parts = ['{', '}', '"a"', ":", ",", '"{{account.name}}"', '"{{bad}}"', '"{{', '}}"', "[", "]", "1", "null", '"\\u12"', "\\", "{{"];
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 600; i++) {
      const src = Array.from({ length: Math.floor(rnd() * 10) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
      const v = validateTemplate(src, "accounts", false);
      if (!v.ok) { expect(v.errors.length).toBeGreaterThan(0); continue; }
      const r = renderTemplate(v.value, ctx());
      expect(r.ok).toBe(true);
      if (r.ok) expect(() => JSON.parse(r.json)).not.toThrow();
    }
  });
});

describe("standard body", () => {
  it("leaves personal data out unless allowed", () => {
    const off = renderStandard("accounts", ctx(), false);
    const on = renderStandard("accounts", ctx(), true);
    expect(off.ok && off.json).not.toContain("pat@example.com");
    expect(on.ok && on.json).toContain("pat@example.com");
    if (off.ok) expect(JSON.parse(off.json)).toMatchObject({ event: "account.pushed", delivery_id: "d-1", workspace: "Acme", record: { id: "a-1" } });
  });

  it("carries custom fields of an account and never a cost field", () => {
    const rec = standardRecord("accounts", ctx(), false);
    expect(rec.custom).toEqual({ cf_region: "GCC" });
    expect(JSON.stringify(rec)).not.toMatch(/cost|margin/i);
  });

  it("a quote carries its lines, its ERP numbers and a small account", () => {
    const rec = standardRecord("standard_quotes", ctx({ quote: { ref: "SQ-1", total: 5, lines: [{ description: "x" }], external: { dynamics365: "QUO-1" } } }), false);
    expect(rec).toMatchObject({ ref: "SQ-1", total: 5, lines: [{ description: "x" }], external: { dynamics365: "QUO-1" }, account: { ref: "ACC-0001" } });
    expect(rec).not.toHaveProperty("account.email");
  });
});

describe("the address", () => {
  it("refuses http, a missing scheme and a token in the host", () => {
    expect(validateUrlTemplate("http://erp.example.com/x", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("erp.example.com/x", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("https://{{account.ref}}.example.com/x", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("ftp://x", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("", "accounts")).toMatchObject({ ok: false });
  });

  it("allows tokens in the path and query, and refuses personal data and lists there", () => {
    const ok = validateUrlTemplate("https://erp.example.com/a/{{account.ref}}?r={{account.city}}", "accounts");
    expect(ok).toEqual({ ok: true, value: { sample: "https://erp.example.com/a/x?r=x" } });
    expect(validateUrlTemplate("https://erp.example.com/?e={{account.email}}", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("https://erp.example.com/?e={{account.gstin}}", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("https://erp.example.com/?l={{quote.lines}}", "standard_quotes")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("https://erp.example.com/?x={{nope}}", "accounts")).toMatchObject({ ok: false });
    expect(validateUrlTemplate("https://erp.example.com/?x={{account.name}}", null)).toMatchObject({ ok: false });
  });

  it("URL-encodes a token value so it cannot add a path, a query or a host", () => {
    const u = renderUrl("https://erp.example.com/a/{{account.name}}", "accounts", ctx({ account: { name: "x/../y?z=1#h&@evil.com" } }));
    expect(u).toBe("https://erp.example.com/a/x%2F..%2Fy%3Fz%3D1%23h%26%40evil.com");
    expect(new URL(u).host).toBe("erp.example.com");
  });

  it("throws at send time if a personal-data token somehow got into a stored address", () => {
    expect(() => renderUrl("https://erp.example.com/?e={{account.email}}", "accounts", ctx())).toThrow();
  });
});
