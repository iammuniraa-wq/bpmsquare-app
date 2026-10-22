import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConfirmCardView from "./ConfirmCardView";
import { missingRequired, type ConfirmCard } from "@/lib/assistant/cards";
import { ASSISTANT_TIPS } from "@/lib/assistant/tips";
import { tipTextProblems } from "@/lib/infoTip";

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

  it("its explanations fit the limit", () => {
    for (const k of ["card", "cardDuplicates", "cardMore"] as const) expect(tipTextProblems(ASSISTANT_TIPS[k]), k).toEqual([]);
  });
});
