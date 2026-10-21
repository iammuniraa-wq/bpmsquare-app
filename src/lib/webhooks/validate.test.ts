import { describe, expect, it } from "vitest";
import { needsAttention, parseHeaderInput, toApiWebhook, validateDefinition, type WebhookRow } from "./validate";

const row = (over: Partial<WebhookRow> = {}): WebhookRow => ({
  id: "w-1", tenant_id: "t-1", kind: "call", name: "ERP push", url: "https://erp.example.com/in", secret: "enc:v1:SECRET", method: "POST",
  object_type: "accounts", object_types: null, headers: [{ name: "Authorization", value: "enc:v1:HEADERVALUE" }], payload_mode: "standard", template: null,
  allow_personal_data: false, timeout_ms: 15000, active: true, paused_reason: null, last_delivery_at: null, last_status: null, last_error: null,
  failure_count: 0, legacy_key: null, created_at: "2026-10-21T00:00:00Z", updated_at: null, ...over,
});

const errs = (r: ReturnType<typeof validateDefinition>) => (r.ok ? [] : r.errors.map((e) => e.field));

describe("secrets never leave in a read", () => {
  it("toApiWebhook shows 'set' and the header names only", () => {
    const api = toApiWebhook(row(), []);
    const json = JSON.stringify(api);
    expect(api.secret).toBe("set");
    expect(api.headers).toEqual([{ name: "Authorization", set: true }]);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("HEADERVALUE");
  });
});

describe("needs https", () => {
  it("flags a migrated http address and passes https", () => {
    expect(needsAttention({ url: "http://old.example.com/x" })).toMatch(/https/);
    expect(needsAttention({ url: " https://ok.example.com " })).toBeNull();
    expect(toApiWebhook(row({ url: "http://old.example.com" })).needs_attention).not.toBeNull();
  });
});

describe("create", () => {
  const base = { kind: "call", name: "Hook", url: "https://erp.example.com/in", object_type: "accounts" };

  it("accepts a minimal call webhook", () => {
    expect(validateDefinition(base, "create")).toMatchObject({ ok: true });
  });

  it("requires a kind, a name of 1 to 80 characters, an https address and, for a call, an object", () => {
    expect(errs(validateDefinition({ ...base, kind: "x" }, "create"))).toContain("kind");
    expect(errs(validateDefinition({ ...base, name: "" }, "create"))).toContain("name");
    expect(errs(validateDefinition({ ...base, name: "x".repeat(81) }, "create"))).toContain("name");
    expect(errs(validateDefinition({ ...base, url: "http://erp.example.com" }, "create"))).toContain("url");
    expect(errs(validateDefinition({ ...base, object_type: "contacts" }, "create"))).toContain("object_type");
    expect(errs(validateDefinition("nope", "create"))).toContain("body");
  });

  it("refuses unknown settings", () => {
    expect(errs(validateDefinition({ ...base, tenant_id: "other" }, "create"))).toContain("tenant_id");
    expect(errs(validateDefinition({ ...base, secret: "x" }, "create"))).toContain("secret");
  });

  it("refuses personal data in a template unless allowed, and an unknown token", () => {
    const t = '{"e":"{{account.email}}"}';
    expect(errs(validateDefinition({ ...base, payload_mode: "template", template: t }, "create"))).toContain("template");
    expect(validateDefinition({ ...base, payload_mode: "template", template: t, allow_personal_data: true }, "create").ok).toBe(true);
    expect(errs(validateDefinition({ ...base, payload_mode: "template", template: '{"a":"{{nope}}"}' }, "create"))).toContain("template");
    expect(errs(validateDefinition({ ...base, payload_mode: "template" }, "create"))).toContain("template");
  });

  it("refuses a personal-data token in the address", () => {
    expect(errs(validateDefinition({ ...base, url: "https://erp.example.com/?e={{account.email}}" }, "create"))).toContain("url");
  });

  it("bounds the timeout to 5-30 seconds and the method to four verbs", () => {
    expect(errs(validateDefinition({ ...base, timeout_ms: 1000 }, "create"))).toContain("timeout_ms");
    expect(errs(validateDefinition({ ...base, timeout_ms: 31000 }, "create"))).toContain("timeout_ms");
    expect(validateDefinition({ ...base, timeout_ms: 30000 }, "create").ok).toBe(true);
    expect(errs(validateDefinition({ ...base, method: "DELETE" }, "create"))).toContain("method");
    expect(validateDefinition({ ...base, method: "GET" }, "create").ok).toBe(true);
  });

  it("an event webhook has no object, no template, no headers and always POSTs", () => {
    const ev = { kind: "event", name: "Feed", url: "https://dw.example.com/in" };
    expect(validateDefinition(ev, "create")).toMatchObject({ ok: true, value: { object_types: ["*"] } });
    expect(validateDefinition({ ...ev, object_types: ["accounts", "quotes"] }, "create")).toMatchObject({ ok: true });
    expect(errs(validateDefinition({ ...ev, object_types: ["secrets"] }, "create"))).toContain("object_types");
    expect(errs(validateDefinition({ ...ev, object_type: "accounts" }, "create"))).toContain("object_type");
    expect(errs(validateDefinition({ ...ev, method: "PUT" }, "create"))).toContain("method");
    expect(errs(validateDefinition({ ...ev, headers: [] }, "create"))).toContain("headers");
    expect(errs(validateDefinition({ ...ev, template: "{}" }, "create"))).toContain("template");
    expect(errs(validateDefinition({ ...ev, allow_personal_data: true }, "create"))).toContain("allow_personal_data");
  });

  it("only an Accounts call webhook can be the Accounts button", () => {
    expect(validateDefinition({ ...base, button_on: "accounts" }, "create").ok).toBe(true);
    expect(errs(validateDefinition({ ...base, object_type: "standard_quotes", button_on: "accounts" }, "create"))).toContain("button_on");
    expect(errs(validateDefinition({ ...base, button_on: "quotes" }, "create"))).toContain("button_on");
  });
});

describe("update", () => {
  it("fixes the kind and the object after create", () => {
    expect(errs(validateDefinition({ kind: "event" }, "update", row()))).toContain("kind");
    expect(errs(validateDefinition({ object_type: "standard_quotes" }, "update", row()))).toContain("object_type");
    expect(validateDefinition({ kind: "call", object_type: "accounts", name: "Renamed" }, "update", row()).ok).toBe(true);
  });

  it("judges a stored template with the new personal-data switch", () => {
    const r = row({ payload_mode: "template", template: '{"e":"{{account.email}}"}', allow_personal_data: true });
    expect(errs(validateDefinition({ allow_personal_data: false }, "update", r))).toContain("template");
  });

  it("accepts active and regenerate_secret only in their strict form", () => {
    expect(validateDefinition({ active: false }, "update", row())).toMatchObject({ ok: true, value: { active: false } });
    expect(errs(validateDefinition({ active: "no" }, "update", row()))).toContain("active");
    expect(validateDefinition({ regenerate_secret: true }, "update", row())).toMatchObject({ ok: true });
    expect(errs(validateDefinition({ regenerate_secret: false }, "update", row()))).toContain("regenerate_secret");
  });
});

describe("headers", () => {
  it("accepts up to ten and keeps a blank value as 'keep'", () => {
    expect(parseHeaderInput([{ name: "X-Api-Key", value: "abc" }, { name: "Accept", value: "" }])).toEqual({ ok: true, value: [{ name: "X-Api-Key", value: "abc" }, { name: "Accept", value: null }] });
    expect(parseHeaderInput(Array.from({ length: 11 }, (_, i) => ({ name: `H${i}`, value: "v" }))).ok).toBe(false);
  });

  it("refuses names BPMSquare owns, bad names, duplicates and line breaks", () => {
    for (const name of ["Host", "content-length", "X-BPMSquare-Signature", "x-bpmsquare-anything", "Transfer-Encoding", "bad name", "bad:name", ""]) {
      expect(parseHeaderInput([{ name, value: "v" }]).ok, name).toBe(false);
    }
    expect(parseHeaderInput([{ name: "A", value: "1" }, { name: "a", value: "2" }]).ok).toBe(false);
    expect(parseHeaderInput([{ name: "A", value: "x\r\nInjected: 1" }]).ok).toBe(false);
    expect(parseHeaderInput([{ name: "A", value: "x".repeat(1025) }]).ok).toBe(false);
    expect(parseHeaderInput("nope").ok).toBe(false);
  });
});
