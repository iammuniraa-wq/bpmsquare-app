import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import FormStudio, { type FormStudioProps } from "./FormStudio";
import PublicFormView from "@/components/marketing/PublicFormView";
import PreferencesForm from "@/components/marketing/PreferencesForm";
import { defaultAfterSubmit, defaultFields, type PublicForm } from "@/lib/marketing/forms/types";

const props = (over: Partial<FormStudioProps["initial"]> = {}, extra: Partial<FormStudioProps> = {}): FormStudioProps => ({
  initial: {
    id: "f1", ref: "FRM-0001", name: "Website contact", slug: "contact", status: "live", title: "Contact us", intro: "Tell us what you need.", button_label: "Send",
    fields: defaultFields(), consent: { text: "I agree to hear from Al Noor by email.", topics: ["offers"], required: false }, after_submit: defaultAfterSubmit(),
    createdAt: "2026-10-20T08:00:00Z", ...over,
  },
  topics: [{ key: "offers", label: "Offers" }, { key: "events", label: "Events" }],
  origin: "https://crm.alnoor.test", redirectHost: "crm.alnoor.test", brand: { name: "Al Noor", logoUrl: null },
  submissions: [{ id: "s1", created_at: "2026-10-20T09:00:00Z", name: "Ali", email: "ali@gulf.test", company: "Gulf", message: "Hi", consent_given: true, outcome: "created" }],
  canEdit: true, canDelete: true, ...extra,
});

describe("the form builder screen", () => {
  it("renders the five option groups, each with a button and a plain-words hint, and Show me how", () => {
    const out = renderToString(createElement(FormStudio, props()));
    for (const title of ["Basics", "Fields", "Consent", "After sending", "Share"]) expect(out).toContain(`<b>${title}</b>`);
    expect(out.match(/aria-expanded=/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).toContain("What the visitor is asked. Email is always asked; the rest are your choice.");
    expect(out).toContain("The words people agree to, and what they are agreeing to hear about. Never pre-ticked.");
    expect(out).toContain("Show me how");
    expect(out).toContain("Desktop");
    expect(out).toContain("Phone");
  });

  it("shows the hosted address, the embed code and the answers on a saved form", () => {
    const out = renderToString(createElement(FormStudio, props()));
    expect(out).toContain("https://crm.alnoor.test/f/contact");
    expect(out).toContain("&lt;iframe src=&quot;https://crm.alnoor.test/f/contact?embed=1&quot;");
    expect(out).toContain("ali@gulf.test");
  });

  it("asks to save before it can offer an address, and is read-only without permission", () => {
    expect(renderToString(createElement(FormStudio, props({ id: null, ref: null, createdAt: null }, { submissions: [] })))).toContain("Save the form to get its address and embed code.");
    expect(renderToString(createElement(FormStudio, props({}, { canEdit: false })))).toContain("You can look at this form but not change it.");
  });

  it("escapes a hostile name, heading and consent wording", () => {
    const out = renderToString(createElement(FormStudio, props({
      name: "<img src=x onerror=alert(1)>", title: "<script>alert(1)</script>", consent: { text: "<b onmouseover=x>agree</b>", topics: [], required: false },
    })));
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toMatch(/<b onmouseover/);
  });
});

describe("the public form renders text, never markup", () => {
  const form: PublicForm = {
    key: "frm_x", title: "<script>alert(1)</script>Contact", intro: "<img src=x onerror=alert(2)>", button: "<b>Send</b>",
    fields: [{ key: "name", label: "<i>Name</i>", required: true }, { key: "email", label: "Email", required: true }, { key: "message", label: "Message", required: false }],
    consent: { text: "I agree <a href=\"javascript:alert(3)\">now</a>", required: false }, renderToken: "1.u",
  };
  const out = renderToString(createElement(PublicFormView, { form, brand: { name: "<u>Co</u>", logoUrl: null } }));

  it("escapes every string", () => {
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toMatch(/<a href="javascript/);
    expect(out).not.toMatch(/<i>Name<\/i>/);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;Contact");
  });

  it("never pre-ticks the consent box and carries the trap field out of sight", () => {
    expect(out).toMatch(/type="checkbox"/);
    expect(out).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(out).toContain('name="company_website"');
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("preview mode says nothing is sent", () => {
    expect(renderToString(createElement(PublicFormView, { form, brand: { name: "Co", logoUrl: null }, preview: true }))).toContain("nothing is sent from here");
  });
});

describe("the preference centre renders the person's choices", () => {
  it("draws one switch per topic, off where the person said no, and a one-tap unsubscribe", () => {
    const out = renderToString(createElement(PreferencesForm, {
      contactId: "c1", token: "t", blocked: null,
      initial: [{ key: "offers", label: "Offers", hint: "Deals", on: true }, { key: "events", label: "<b>Events</b>", hint: "", on: false }],
    }));
    expect(out.match(/role="switch"/g)).toHaveLength(2);
    expect(out).toMatch(/checked=""[^>]*\/?>/);
    expect(out).toContain("Unsubscribe from all");
    expect(out).not.toContain("<b>Events</b>");
  });

  it("says why nothing can be switched on for a person who opted out", () => {
    const out = renderToString(createElement(PreferencesForm, { contactId: "c1", token: "t", blocked: "opted_out", initial: [{ key: "offers", label: "Offers", hint: "", on: false }] }));
    expect(out).toContain("You asked us to stop all marketing emails.");
    expect(out).toMatch(/<input[^>]*disabled/);
  });
});
