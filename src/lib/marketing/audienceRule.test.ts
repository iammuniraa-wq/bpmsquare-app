import { describe, expect, it } from "vitest";
import { EVERYONE, ruleKey, type RuleParts } from "./audienceRule";

const rule = (over: Partial<RuleParts>): RuleParts => ({ ...EVERYONE, types: new Set(EVERYONE.types), includeIds: new Set(), excludeIds: new Set(), manualEmails: new Set(), filters: [], ...over });

describe("audience rule identity", () => {
  it("everyone is every account type with nothing added or removed", () => {
    expect(ruleKey(rule({}))).toBe(ruleKey(EVERYONE));
  });

  it("order does not matter", () => {
    expect(ruleKey(rule({ types: new Set(["oem", "direct", "prospect", "end_customer"]) }))).toBe(ruleKey(EVERYONE));
  });

  it("any change makes it a different audience", () => {
    expect(ruleKey(rule({ types: new Set(["oem"]) }))).not.toBe(ruleKey(EVERYONE));
    expect(ruleKey(rule({ manualEmails: new Set(["a@x.com"]) }))).not.toBe(ruleKey(EVERYONE));
    expect(ruleKey(rule({ excludeIds: new Set(["a1"]) }))).not.toBe(ruleKey(EVERYONE));
  });

  it("any/all only matters when there are filters", () => {
    expect(ruleKey(rule({ match: "any" }))).toBe(ruleKey(EVERYONE));
  });
});
