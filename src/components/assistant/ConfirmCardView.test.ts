import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConfirmCardView from "./ConfirmCardView";
import { missingRequired, type ConfirmCard } from "@/lib/assistant/cards";

const card: ConfirmCard = {
  id: "c1", token: "t", action: "create", object: "account", noun: "account",
  title: "New account: Tesla Germany", summary: "Create the account Tesla Germany.",
  fields: [
    { key: "name", label: "Name", value: "Tesla Germany", required: true, widget: "text" },
    { key: "type", label: "Account type", value: "", required: true, widget: "enum", options: [{ value: "direct", label: "Direct customer" }] },
    { key: "city", label: "City", value: "Berlin", required: false, widget: "text" },
    { key: "industry", label: "Industry", value: "", required: false, widget: "text" },
  ],
  duplicates: [{ id: "d1", label: "Tesla GmbH (ACC-0042)", href: "/accounts/d1" }],
  notices: ["Several accounts match. Pick one."],
  primaryLabel: "Create account", risk: "write",
};

const html = renderToStaticMarkup(createElement(ConfirmCardView, { card, onOpen: () => {}, onAsk: () => {} }));

describe("the confirm card", () => {
  it("shows each field with its value, required ones flagged, and one button named after the act", () => {
    expect(html).toContain("New account: Tesla Germany");
    expect(html).toContain("Create the account Tesla Germany.");
    expect(html).toContain("Name *");
    expect(html).toContain("Account type *");
    expect(html).toContain('value="Tesla Germany"');
    expect(html).toContain('value="Berlin"');
    expect(html).toContain("Create account");
    expect(html).toContain("Cancel");
  });

  it("keeps empty optional fields behind 'More fields' and shows what blocks the press", () => {
    expect(html).toContain("More fields (1)");
    expect(html).not.toContain('aria-label="Industry"');
    expect(html).toContain("Fill in: Account type");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create account<\/button>/);
  });

  it("lists similar records with an open-instead button, and notices in the open", () => {
    expect(html).toContain("Similar already exists");
    expect(html).toContain("Tesla GmbH (ACC-0042)");
    expect(html).toContain("Open instead");
    expect(html).toContain("Several accounts match. Pick one.");
  });

  it("an enum is a pick list of the workspace's options", () => {
    expect(html).toContain('<option value="direct">Direct customer</option>');
  });

  it("finds the required fields still empty", () => {
    expect(missingRequired(card.fields, { name: "x", type: "" })).toEqual(["type"]);
    expect(missingRequired(card.fields, { name: "x", type: "direct" })).toEqual([]);
  });

  it("carries no 'i': the duplicate warning, the missing-field notice and the buttons are visible text (owner 2026-10-22)", () => {
    expect(html).not.toContain('aria-label="About');
  });

  it("reads markdown in the summary and notices instead of printing the markers, and escapes markup", () => {
    const md: ConfirmCard = { ...card, title: "**New** account", summary: "Create **Tesla Germany** <img src=x onerror=alert(1)>.", notices: ["Pick *one* of `these`."] };
    const out = renderToStaticMarkup(createElement(ConfirmCardView, { card: md, onOpen: () => {}, onAsk: () => {} }));
    expect(out).toContain("<strong>Tesla Germany</strong>");
    expect(out).toContain("<em>one</em>");
    expect(out).not.toContain("**");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

const draw = (c: ConfirmCard) => renderToStaticMarkup(createElement(ConfirmCardView, { card: c, onOpen: () => {}, onAsk: () => {} }));

const change: ConfirmCard = {
  id: "c2", token: "t", action: "update", object: "account", noun: "account", title: "Change account: Acme Industrial",
  summary: "Change the city of Acme Industrial to Dammam.",
  fields: [
    { key: "city", label: "City", value: "Dammam", before: "Riyadh", required: false, widget: "text" },
    { key: "website", label: "Website", value: "https://acme.example", before: "", required: false, widget: "text" },
  ],
  duplicates: [], notices: ["Already set, left out: Industry."], primaryLabel: "Save changes", risk: "write",
  info: "Shows what the record holds now and what it will hold. Nothing changes until you press Save changes.",
};

describe("the change card", () => {
  const out = draw(change);

  it("shows each field with its new value and what it holds now, and one button named after the act", () => {
    expect(out).toContain("Change account: Acme Industrial");
    expect(out).toContain('value="Dammam"');
    expect(out).toContain("Now: Riyadh");
    expect(out).toContain("Now: empty");
    expect(out).toContain("Save changes");
    expect(out).toContain("Cancel");
    expect(out).toContain("Already set, left out: Industry.");
  });

  it("has nothing hidden behind 'More fields', and does not say anything was created", () => {
    expect(out).not.toContain("More fields");
    expect(out).not.toContain("Create");
  });

  it("explains itself behind one i, and the controls carry data-guide ids", () => {
    expect(out).toContain('aria-label="About Change account: Acme Industrial"');
    expect(out).toContain('data-guide="assistant.card.primary"');
    expect(out).toContain('data-guide="assistant.card.cancel"');
  });

  it("a create card has no before lines and no i", () => {
    expect(html).not.toContain("Now:");
    expect(html).not.toContain('aria-label="About');
  });
});

const step: ConfirmCard = {
  id: "c3", token: "t", action: "verb", object: "submit_bid", noun: "bid version", title: "Submit bid: OPP-0035 Valves for Plant 5",
  summary: "Submit bid version 1 for OPP-0035.",
  facts: [{ label: "Version", value: "1" }, { label: "Lines", value: "3" }, { label: "Total", value: "SAR 1,600" }],
  checks: ["1 line has no price.", "No approved go decision."],
  fields: [{ key: "note", label: "Note", value: "", required: false, widget: "textarea" }],
  duplicates: [], notices: [], primaryLabel: "Submit bid", risk: "write", info: "Saves the deal's lines as the next bid version and moves the tender to Submitted.",
};

describe("the tender step card", () => {
  const out = draw(step);

  it("lists the facts it acts on and the checks that are not a pass, in plain visible text", () => {
    expect(out).toContain("SAR 1,600");
    expect(out).toContain('data-guide="assistant.card.facts"');
    expect(out).toContain("Before you go on");
    expect(out).toContain("1 line has no price.");
    expect(out).toContain("No approved go decision.");
    expect(out).toContain('data-guide="assistant.card.checks"');
  });

  it("the button is named after the step and stays enabled despite the warnings (they warn, never block)", () => {
    expect(out).toMatch(/<button(?![^>]*disabled)[^>]*>Submit bid<\/button>/);
  });

  it("a step with nothing to fill in has no fields and no 'More fields'", () => {
    const bare = draw({ ...step, fields: [], checks: [] });
    expect(bare).not.toContain("More fields");
    expect(bare).not.toContain("Before you go on");
  });

  it("a required field still blocks the press, as for a create", () => {
    const needs = draw({ ...step, fields: [{ key: "revision_reason", label: "Why the bid is revised", value: "", required: true, widget: "textarea" }] });
    expect(needs).toContain("Fill in: Why the bid is revised");
    expect(needs).toMatch(/<button[^>]*disabled=""[^>]*>Submit bid<\/button>/);
  });
});
