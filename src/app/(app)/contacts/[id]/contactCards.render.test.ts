import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import EmailHealthCard from "./EmailHealthCard";
import ConsentCard from "./ConsentCard";
import type { ContactHealth } from "@/lib/marketing/contactHealth";
import type { ContactConsent } from "@/lib/marketing/contactConsent";
import { EMAIL_STATUS_COPY } from "@/lib/marketing/emailHealth";

const health = (over: Partial<ContactHealth> = {}): ContactHealth => ({
  available: true, status: "valid", at: "2026-10-01T10:00:00Z", reason: null, blocked: false, lastEvent: null, ...over,
});
const healthHtml = (h: ContactHealth, canEdit = true) => renderToString(createElement(EmailHealthCard, { contactId: "c1", email: "a@b.com", health: h, canEdit }));

describe("the Email health card", () => {
  it("shows the status and the Check address action, and prints none of the button explanations", () => {
    const out = healthHtml(health());
    expect(out).toContain(EMAIL_STATUS_COPY.valid.label);
    expect(out).toContain(">Check address<");
    expect(out).not.toContain("Check this address");
    expect(out).not.toContain("Nothing is sent");
    expect(out).not.toContain("Type the right address");
    expect(out).not.toContain("Use this when you confirmed");
  });
  it("puts the status explanation behind the i when nothing is wrong", () => {
    const out = healthHtml(health());
    expect(out).toContain('aria-label="About Email health"');
    expect(out).not.toContain(EMAIL_STATUS_COPY.valid.plain);
  });
  it("keeps the problem and what to do on screen when the address bounced", () => {
    const out = healthHtml(health({ status: "bounced", blocked: true }));
    expect(out).toContain(EMAIL_STATUS_COPY.bounced.plain);
    expect(out).toContain("What to do: ");
    expect(out).toContain("No email will be sent");
    expect(out).not.toContain(">Mark as checked<");
  });
  it("says it is waiting for a database update as an empty state", () => {
    const out = healthHtml(health({ available: false }));
    expect(out).toContain("Waiting for a database update");
  });
});

const consent = (over: Partial<ContactConsent> = {}): ContactConsent => ({
  available: true,
  rows: [{ channel: "email", topic: "offers", status: "granted", since: "2026-09-12T00:00:00Z", basis: "consent", source: "rep", note: "Trade show card" }],
  history: Array.from({ length: 7 }, (_, i) => ({ channel: "email", topic: "offers", status: "granted" as const, basis: "consent", source: "rep", note: null, at: `2026-09-0${i + 1}T00:00:00Z` })),
  topics: [{ key: "offers", label: "Offers" }], bases: ["consent", "existing_customer"], jurisdiction: "other", jurisdictionLabel: "Qatar", ...over,
});
const consentHtml = (c: ContactConsent) => renderToString(createElement(ConsentCard, { contactId: "c1", consent: c, canEdit: true }));

describe("the Consent card", () => {
  it("names the topic column Consent topic, keeps the intro behind the i, and renders both the table and the phone rows", () => {
    const out = consentHtml(consent());
    expect(out).toContain("Consent topic");
    expect(out).toContain('aria-label="About Consent"');
    expect(out).not.toContain("Every answer is kept");
    expect(out).not.toContain("Use these to write down");
    expect(out).toContain("bpm-rows-table");
    expect(out).toContain("bpm-rows-cards");
    expect(out).toContain('aria-label="About how we know: Email, Offers"');
    expect(out).toContain("They agreed");
  });
  it("keeps the no-answer blocker on screen", () => {
    const out = consentHtml(consent({ rows: [], history: [] }));
    expect(out).toContain("No answer recorded yet, so we do not email this person");
  });
  it("shows the five newest history lines and offers Show all", () => {
    const out = consentHtml(consent()).replace(/<!-- -->/g, "");
    expect(out.match(/Agreed · Email · Offers/g)!.length).toBe(5);
    expect(out).toContain("Show all (7)");
  });
});
