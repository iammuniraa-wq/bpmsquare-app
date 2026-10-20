import { describe, it, expect } from "vitest";
import { allowedRedirectHosts, cleanEmailValue, cleanPhoneValue, cleanRedirectUrl, cleanText, sanitizeFormSave, sanitizeSubmission, slugify } from "./sanitize";
import { defaultFields } from "./types";

describe("cleanText -- plain text only", () => {
  it("strips tags, control and direction-override characters", () => {
    expect(cleanText("Hi <script>alert(1)</script> there<img src=x onerror=alert(1)>", 200)).toBe("Hi alert(1) there");
    expect(cleanText("a‮b\u0007c", 20)).toBe("abc");
  });
  it("keeps a plain 'less than' sign and caps the length", () => {
    expect(cleanText("5 < 6 and 7 > 3", 50)).toBe("5 < 6 and 7 > 3");
    expect(cleanText("x".repeat(500), 40)).toHaveLength(40);
  });
  it("keeps line breaks only when asked", () => {
    expect(cleanText("a\n\n\n\nb", 50, { multiline: true })).toBe("a\n\nb");
    expect(cleanText("a\nb", 50)).toBe("a b");
  });
  it("is not fooled by a non-string", () => {
    expect(cleanText({ toString: () => "x" }, 10)).toBe("");
    expect(cleanText(null, 10)).toBe("");
  });
});

describe("addresses", () => {
  it("accepts a normal address, lower-cased, and rejects the rest", () => {
    expect(cleanEmailValue("  Ali@Example.COM ")).toBe("ali@example.com");
    for (const bad of ["no-at-sign", "a@b", "a b@c.com", "<x@y.com>", "a@b.c", 42, "a@@b.com", "x@y.com, z@w.com"]) expect(cleanEmailValue(bad)).toBe("");
  });
  it("keeps only phone characters", () => {
    expect(cleanPhoneValue("+966 (50) 123-4567 ext<script>")).toBe("+966 (50) 123-4567");
  });
});

describe("sanitizeSubmission -- a visitor cannot add fields or skip required ones", () => {
  const fields = defaultFields();
  it("drops unknown keys and disabled fields", () => {
    const r = sanitizeSubmission({ name: "Ali", email: "ali@x.com", phone: "123", tenant_id: "other", is_admin: true }, fields);
    expect(r.values).toEqual({ name: "Ali", email: "ali@x.com" });
    expect(r.invalid).toEqual([]);
  });
  it("reports a missing required field and a bad email by their labels", () => {
    expect(sanitizeSubmission({ name: "", email: "nope" }, fields).invalid).toEqual(["Your name", "Email"]);
  });
  it("reads consent only from a real boolean", () => {
    expect(sanitizeSubmission({ name: "A", email: "a@b.co", consent: "true" }, fields).consent).toBe(false);
    expect(sanitizeSubmission({ name: "A", email: "a@b.co", consent: true }, fields).consent).toBe(true);
  });
});

describe("redirects stay on the workspace's own domain", () => {
  const hosts = allowedRedirectHosts({ custom_domain: "crm.client.com", is_demo: false }, "app.bpmsquare.com");
  it("allows the tenant's own host only, https only, query dropped", () => {
    expect(hosts).toEqual(["crm.client.com"]);
    expect(cleanRedirectUrl("https://crm.client.com/thanks?x=1#y", hosts)).toBe("https://crm.client.com/thanks");
    for (const bad of ["http://crm.client.com/t", "https://evil.com/t", "https://crm.client.com.evil.com/t", "https://user:pw@crm.client.com/t", "https://crm.client.com:8443/t", "javascript:alert(1)", "//crm.client.com/t", "/thanks", ""]) {
      expect(cleanRedirectUrl(bad, hosts)).toBe("");
    }
  });
  it("only a demo workspace may use the primary host", () => {
    expect(allowedRedirectHosts({ custom_domain: null, is_demo: true }, "app.bpmsquare.com")).toEqual(["app.bpmsquare.com"]);
    expect(allowedRedirectHosts({ custom_domain: null, is_demo: false }, "app.bpmsquare.com")).toEqual([]);
  });
});

describe("sanitizeFormSave", () => {
  const ctx = { topicKeys: ["offers", "events"], redirectHosts: ["crm.client.com"] };
  const good = { name: "Contact", status: "live", title: "Hi", consent: { text: "I agree", topics: ["offers", "bogus"], required: false }, after_submit: { kind: "message", message: "Thanks" } };

  it("keeps email on and required whatever is sent, and drops unknown topics", () => {
    const r = sanitizeFormSave({ ...good, fields: [{ key: "email", enabled: false, required: false, label: "Mail" }] }, ctx, "Acme");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const email = r.value.fields.find((f) => f.key === "email")!;
    expect(email).toMatchObject({ enabled: true, required: true, label: "Mail" });
    expect(r.value.consent.topics).toEqual(["offers"]);
    expect(r.value.slug).toBe("contact");
  });
  it("refuses a form with no consent words", () => {
    expect(sanitizeFormSave({ ...good, consent: { text: "  ", topics: [] } }, ctx, "Acme").ok).toBe(false);
  });
  it("refuses a redirect off the workspace's domain", () => {
    expect(sanitizeFormSave({ ...good, after_submit: { kind: "redirect", redirect_url: "https://evil.com/x" } }, ctx, "Acme").ok).toBe(false);
    const ok = sanitizeFormSave({ ...good, after_submit: { kind: "redirect", redirect_url: "https://crm.client.com/thanks" } }, ctx, "Acme");
    expect(ok.ok && ok.value.after_submit.redirect_url).toBe("https://crm.client.com/thanks");
  });
  it("strips markup from every admin-typed text", () => {
    const r = sanitizeFormSave({ ...good, title: "<b>Hello</b>", intro: "x<script>1</script>y", fields: [{ key: "name", label: "<i>Name</i>", enabled: true, required: true }] }, ctx, "Acme");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Hello");
    expect(r.value.intro).toBe("x1y");
    expect(r.value.fields.find((f) => f.key === "name")?.label).toBe("Name");
  });
  it("slugifies the address", () => {
    expect(slugify("  Contact Us / Gulf! ")).toBe("contact-us-gulf");
  });
});
