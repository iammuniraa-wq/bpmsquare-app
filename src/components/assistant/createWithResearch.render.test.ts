import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import ConfirmCardView, { fieldMeta, visibleNextSteps } from "./ConfirmCardView";
import { CreateDetailsRow, type CreateDetailsState } from "./WebResearch";
import type { ConfirmCard, NextStep } from "@/lib/assistant/cards";

// "Create with web research" in the dock: the two-chip question, and the card filled from the web. Words only: no source
// link on screen, no extra "i" (the dock keeps at most three).

const web: ConfirmCard = {
  id: "c1", token: "t", action: "create", object: "account", noun: "account",
  title: "New account: Tesla Germany", summary: "Create the account Tesla Germany.",
  fields: [
    { key: "name", label: "Name", value: "Tesla Germany", required: true, widget: "text" },
    { key: "type", label: "Account type", value: "direct", required: true, widget: "enum", options: [{ value: "direct", label: "Direct customer" }] },
    { key: "website", label: "Website", value: "https://www.tesla.com", required: false, widget: "text", origin: "web", confidence: "found" },
    { key: "city", label: "City", value: "Grünheide", required: false, widget: "text", origin: "web", confidence: "likely" },
    { key: "phone", label: "Primary phone", value: "", required: false, widget: "text", confidence: "not_found" },
    { key: "industry", label: "Industry", value: "", required: false, widget: "text", confidence: "not_found" },
  ],
  duplicates: [], notices: [], primaryLabel: "Create account", risk: "write",
};
const out = renderToStaticMarkup(createElement(ConfirmCardView, { card: web, onOpen: () => {}, onAsk: () => {} }));

describe("a card filled from a web lookup", () => {
  it("says 'From the web' with a confidence word on each web value, and nothing on the person's own", () => {
    expect(out).toContain("From the web · Found");
    expect(out).toContain("From the web · Likely");
    expect((out.match(/data-testid="field-meta"/g) ?? []).length).toBe(2);
    expect(out).toContain('value="https://www.tesla.com"');
    expect(out).toContain('value="Grünheide"');
  });

  it("flags the required fields, lists what was not found in one visible line, and keeps those empty fields behind 'More fields'", () => {
    expect(out).toContain("Name *");
    expect(out).toContain("Account type *");
    expect(out).toContain("Not found on the web: Primary phone, Industry");
    expect(out).toContain("More fields (2)");
    expect(out).not.toContain('aria-label="Primary phone"');
  });

  it("shows no source link or source address, and no 'i'", () => {
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href=");
    expect(out).not.toContain('aria-label="About');
    expect(out).not.toMatch(/reuters|source/i);
  });

  it("the small line under a label follows what the person did with the value", () => {
    expect(fieldMeta(web.fields[2], web.fields[2].value)).toBe("From the web · Found");
    expect(fieldMeta(web.fields[2], "https://www.tesla.de")).toBe("Edited by you");
    expect(fieldMeta(web.fields[4], "")).toBe("Not found");
    expect(fieldMeta(web.fields[4], "+49 30 1")).toBe("Added by you");
    expect(fieldMeta(web.fields[0], "x")).toBeNull();
  });

  it("in the web window the next steps that ask the assistant to create something are left out, the buttons that open things stay", () => {
    const next: NextStep[] = [
      { id: "open:1", label: "Open Tesla Germany", kind: "navigate", target: "/accounts/1" },
      { id: "contact:1", label: "Add a contact", kind: "ask", question: "Add a contact to the account Tesla Germany" },
      { id: "quotes:1", label: "Quotes", kind: "navigate", target: "/quotations" },
    ];
    expect(visibleNextSteps(next, "/accounts/1", false).map((n) => n.label)).toEqual(["Add a contact", "Quotes"]);
    expect(visibleNextSteps(next, "/accounts/1", true).map((n) => n.label)).toEqual(["Quotes"]);
  });
});

describe("the two-chip question under 'Create an account <name>'", () => {
  const row = (state: CreateDetailsState, disabled = false) => renderToString(createElement(CreateDetailsRow, { state, disabled, onChoice: () => {} }));

  it("is two chips of the dock's one chip pattern, with the exact labels, and no 'i' and no text field", () => {
    const html = row("pending");
    expect(html).toMatch(/<button[^>]*>I(&#x27;|')ll give the details<\/button>/);
    expect(html).toMatch(/<button[^>]*>Look it up on the web<\/button>/);
    expect((html.match(/class="bms-dock-chip"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("<input");
    expect(html).not.toContain('aria-label="About');
  });

  it("disables both while a request is in flight, and shrinks to one muted line once answered", () => {
    expect((row("pending", true).match(/disabled=""/g) ?? []).length).toBe(2);
    for (const [state, line] of [["manual", "You will give the details"], ["web", "Looking it up on the web"], ["skipped", "Not answered"]] as const) {
      const html = row(state);
      expect(html).toContain(line);
      expect(html).not.toContain("<button");
    }
  });
});
