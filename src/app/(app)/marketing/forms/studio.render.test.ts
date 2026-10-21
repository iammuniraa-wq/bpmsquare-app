import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import FormStudio, { type FormStudioProps } from "./FormStudio";
import PublicFormView from "@/components/marketing/PublicFormView";
import PreferencesForm from "@/components/marketing/PreferencesForm";
import { defaultAfterSubmit, defaultFields, type PublicForm } from "@/lib/marketing/forms/types";
import { FORM_TIPS } from "@/lib/marketing/forms/tips";

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
  it("renders the five option groups, each a row with its own button and an i, and prints none of their explanations", () => {
    nav.search = "";
    const out = renderToString(createElement(FormStudio, props()));
    for (const title of ["Basics", "Fields", "Consent", "After sending", "Share"]) {
      expect(out).toMatch(new RegExp(`class="bpm-og-title"[^>]*>${title}</button><button[^>]*aria-label="About ${title}"`));
    }
    expect(out.match(/class="bpm-og(?: [a-z]+)*"/g)!.length).toBe(5);
    for (const text of [FORM_TIPS.fields, FORM_TIPS.consent, FORM_TIPS.consentWords, FORM_TIPS.consentRequired, FORM_TIPS.status, FORM_TIPS.embed]) expect(out).not.toContain(text);
    expect(out).toContain("Show me how");
    expect(out).toContain("Desktop");
    expect(out).toContain("Phone");
  });

  it("has the page tabs Design and Answers (N) and the phone's strip for the five groups", () => {
    nav.search = "";
    const out = renderToString(createElement(FormStudio, props()));
    expect(out).toMatch(/role="tablist" aria-label="Form"/);
    expect(out).toMatch(/role="tab"[^>]*class="bpm-tab"[^>]*>Design/);
    expect(out).toMatch(/role="tab"[^>]*class="bpm-tab"[^>]*>Answers<span class="bpm-tab-count">1<\/span>/);
    expect(out).toMatch(/role="tablist" aria-label="Options"/);
    for (const t of ["Basics", "Fields", "Consent", "After sending", "Share"]) expect(out).toMatch(new RegExp(`role="tab"[^>]*class="bpm-tab"[^>]*>${t}`));
  });

  it("says consent topic on the consent side, keeps only constraints under the controls, and drops the Details fold", () => {
    nav.search = "";
    const out = renderToString(createElement(FormStudio, props()));
    expect(out).toContain(">Consent topics<");
    expect(out).not.toContain(">Topics this covers<");
    expect(out).toContain("Changing it breaks shared links");
    expect(out).not.toContain("Details");
    expect(out).not.toContain("The form as a visitor sees it.");
  });

  it("shows the hosted address and the embed code in Share on a saved form", () => {
    nav.search = "";
    const out = renderToString(createElement(FormStudio, props()));
    expect(out).toContain("https://crm.alnoor.test/f/contact");
    expect(out).toContain("&lt;iframe src=&quot;https://crm.alnoor.test/f/contact?embed=1&quot;");
  });

  it("lists the answers on the Answers tab, not under the design", () => {
    nav.search = "tab=answers";
    const out = renderToString(createElement(FormStudio, props()));
    expect(out).toContain("ali@gulf.test");
    expect(out).not.toContain('id="basicsSec"');
    nav.search = "";
    expect(renderToString(createElement(FormStudio, props()))).not.toContain("ali@gulf.test");
  });

  it("asks to save before it can offer an address, and is read-only without permission", () => {
    nav.search = "";
    expect(renderToString(createElement(FormStudio, props({ id: null, ref: null, createdAt: null }, { submissions: [] })))).toContain("Save the form to get its address and embed code.");
    nav.search = "tab=answers";
    expect(renderToString(createElement(FormStudio, props({ id: null, ref: null, createdAt: null }, { submissions: [] })))).toContain("Save the form to start collecting answers.");
    nav.search = "";
    expect(renderToString(createElement(FormStudio, props({}, { canEdit: false })))).toContain("You can look at this form but not change it.");
  });

  it("escapes a hostile name, heading and consent wording", () => {
    nav.search = "";
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
