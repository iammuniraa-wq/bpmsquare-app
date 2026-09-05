import { describe, it, expect } from "vitest";
import { emailOutputFor, resolveOutbound } from "./emailOutputRules";
import type { TenantConfig } from "@/lib/constants";

const cfg = (email_output?: TenantConfig["email_output"]) => ({ email_output } as TenantConfig);

describe("emailOutputFor", () => {
  it("defaults to partners when nothing is configured", () => {
    expect(emailOutputFor({ is_demo: false, config: cfg() })).toEqual({ mode: "partners", redirect_to: "", forced: false });
  });
  it("forces redirect on a demo workspace whatever the config says", () => {
    expect(emailOutputFor({ is_demo: true, config: cfg({ mode: "partners", redirect_to: "qa@x.com" }) }))
      .toEqual({ mode: "redirect", redirect_to: "qa@x.com", forced: true });
    expect(emailOutputFor({ is_demo: true, config: null })).toEqual({ mode: "redirect", redirect_to: "", forced: true });
  });
});

describe("resolveOutbound", () => {
  const msg = { to: ["Buyer@Client.com", "cc@client.com"], subject: "Invoice INV-1", text: "Dear buyer" };

  it("passes partners through untouched", () => {
    const r = resolveOutbound({ mode: "partners", redirect_to: "", forced: false }, msg);
    expect(r.ok && r.email).toMatchObject({ to: ["buyer@client.com", "cc@client.com"], redirected: false, subject: "Invoice INV-1" });
  });

  it("redirects everything to the one inbox and names the intended recipients", () => {
    const r = resolveOutbound({ mode: "redirect", redirect_to: "qa@x.com", forced: true }, msg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email.to).toEqual(["qa@x.com"]);
    expect(r.email.intended).toEqual(["buyer@client.com", "cc@client.com"]);
    expect(r.email.subject).toBe("[Redirected · for buyer@client.com, cc@client.com] Invoice INV-1");
    expect(r.email.text.startsWith("Redirected by the workspace's email output setting.")).toBe(true);
    expect(r.email.text.endsWith("Dear buyer")).toBe(true);
  });

  it("refuses to send, rather than fall through, when redirect has no inbox", () => {
    const r = resolveOutbound({ mode: "redirect", redirect_to: "", forced: true }, msg);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/demo workspace/);
  });

  it("prefixes an html body with a visible banner", () => {
    const r = resolveOutbound({ mode: "redirect", redirect_to: "qa@x.com", forced: false }, { ...msg, html: "<p>Hi</p>" });
    expect(r.ok && r.email.html).toMatch(/^<div[^>]*>Redirected by the workspace/);
    expect(r.ok && r.email.html?.endsWith("<p>Hi</p>")).toBe(true);
  });
});
