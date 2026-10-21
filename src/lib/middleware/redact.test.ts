import { describe, it, expect } from "vitest";
import { redactPayload, redactText, REDACTED } from "./redact";

describe("payload redaction", () => {
  it("replaces tokens and authorization values by key", () => {
    const out = redactPayload({ Authorization: "Bearer abc.def.ghi", access_token: "xyz", client_secret: "s", nested: { password: "p", api_key: "k" }, name: "SQ-0001" }) as Record<string, unknown>;
    expect(out.Authorization).toBe(REDACTED);
    expect(out.access_token).toBe(REDACTED);
    expect(out.client_secret).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).api_key).toBe(REDACTED);
    expect(out.name).toBe("SQ-0001");
  });

  it("replaces personal-data keys (email, phone, names of people)", () => {
    const out = redactPayload({ emailaddress1: "a@b.com", telephone1: "+49 170 1234567", fullname: "Jane Roe", contact_name: "J", city: "Berlin", address1_line1: "Main St 1" }) as Record<string, unknown>;
    expect(out.emailaddress1).toBe(REDACTED);
    expect(out.telephone1).toBe(REDACTED);
    expect(out.fullname).toBe(REDACTED);
    expect(out.contact_name).toBe(REDACTED);
    expect(out.address1_line1).toBe(REDACTED);
    expect(out.city).toBe("Berlin");
  });

  it("scrubs personal data and tokens inside free text", () => {
    expect(redactText("Mail jane.roe@example.com or call +49 170 1234567 now")).toBe("Mail [email] or call [phone] now");
    expect(redactText("Authorization: Bearer abcdefgh12345678")).toContain("Bearer [redacted]");
    expect(redactText("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc")).toBe("[token]");
  });

  it("keeps record ids and ERP numbers intact", () => {
    expect(redactText("quote 0f8fad5b-d9cb-469f-a165-70867728950e is QUO-01002-D1M7V2")).toBe("quote 0f8fad5b-d9cb-469f-a165-70867728950e is QUO-01002-D1M7V2");
  });

  it("bounds depth, array length and total size", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n as Record<string, unknown>; }
    expect(JSON.stringify(redactPayload(deep))).toContain("[too deep]");
    expect((redactPayload({ rows: Array.from({ length: 80 }, (_, i) => i) }) as { rows: unknown[] }).rows).toHaveLength(51);
    expect(redactPayload({ big: Array.from({ length: 40 }, () => "x".repeat(2000)) })).toEqual({ truncated: true });
  });

  it("does not mutate its input", () => {
    const input = { token: "t", list: [{ email: "a@b.co" }] };
    redactPayload(input);
    expect(input).toEqual({ token: "t", list: [{ email: "a@b.co" }] });
  });
});
