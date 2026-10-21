import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CONSENT_SETTINGS_TIPS } from "./consentSettingsTips";
import { JURISDICTIONS, JURISDICTION_RULES } from "./jurisdictions";

describe("the consent settings explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(CONSENT_SETTINGS_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so does the sentence for each country group, which sits behind the country's i", () => {
    for (const code of JURISDICTIONS) expect(tipTextProblems(JURISDICTION_RULES[code].plain), code).toEqual([]);
  });
});
