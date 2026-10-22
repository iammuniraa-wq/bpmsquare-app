import { describe, it, expect } from "vitest";
import { ALL_ACCOUNT_TYPES, campaignNameFor, cleanEmails, oneOffRule, parseEmailText, ruleFromGroup } from "./sendAudience";

describe("the audience of the Send panel", () => {
  it("is everyone we hold an address for when nothing is chosen", () => {
    const r = oneOffRule({});
    expect(r.account_types).toEqual([...ALL_ACCOUNT_TYPES]);
    expect(r.manual_emails).toEqual([]);
    expect(r.filters).toEqual([]);
  });

  it("takes only the account types it knows, once each", () => {
    expect(oneOffRule({ account_types: ["oem", "oem", "robot", 4] }).account_types).toEqual(["oem"]);
  });

  it("with only typed addresses sends to those and no account type", () => {
    const r = oneOffRule({ account_types: [], manual_emails: ["A@One.example", "bad", "a@one.example"] });
    expect(r.account_types).toEqual([]);
    expect(r.manual_emails).toEqual(["a@one.example"]);
  });

  it("reads typed text with commas, semicolons and lines", () => {
    expect(parseEmailText("a@x.example, b@x.example;c@x.example\nnot-an-email  b@x.example")).toEqual(["a@x.example", "b@x.example", "c@x.example"]);
    expect(cleanEmails("nope")).toEqual([]);
  });

  it("carries a saved group's whole rule and adds the typed addresses to it", () => {
    const r = ruleFromGroup({
      account_types: ["direct"], include_account_ids: ["a1"], exclude_account_ids: ["a2"], manual_emails: ["g@x.example"],
      filters: [{ id: "f1", field: "type", operator: "equals", value: "oem" }, { nonsense: true }], match: "any",
    }, ["extra@x.example", "g@x.example"]);
    expect(r).toMatchObject({ account_types: ["direct"], include_account_ids: ["a1"], exclude_account_ids: ["a2"], match: "any" });
    expect(r.manual_emails).toEqual(["g@x.example", "extra@x.example"]);
    expect(r.filters).toHaveLength(1);
  });

  it("names the campaign row after the newsletter and the day", () => {
    expect(campaignNameFor("October update", new Date("2026-10-22T09:00:00Z"))).toBe("October update · 22 Oct 2026");
    expect(campaignNameFor("  ", new Date("2026-01-03T00:00:00Z"))).toBe("Newsletter · 3 Jan 2026");
  });
});
