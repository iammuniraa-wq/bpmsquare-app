import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { EMAIL_STATUSES, needsAttention } from "./emailHealth";
import { BASIS_TIP, CONSENT_CARD_TIPS, EMAIL_HEALTH_TIPS, clipTip, consentCardTip, consentRowTip, emailStatusTip } from "./contactCardTips";

describe("the contact card explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries({ ...EMAIL_HEALTH_TIPS, ...CONSENT_CARD_TIPS })) expect(tipTextProblems(text), key).toEqual([]);
    for (const [basis, text] of Object.entries(BASIS_TIP)) expect(tipTextProblems(text), basis).toEqual([]);
  });

  it("the status explanation fits for every status that keeps it behind the i (a problem status prints its sentence instead)", () => {
    for (const s of EMAIL_STATUSES.filter((x) => !needsAttention(x))) expect(tipTextProblems(emailStatusTip(s)), s).toEqual([]);
  });

  it("every basis names its stored word, once", () => {
    for (const [basis, text] of Object.entries(BASIS_TIP)) expect(text.split(`"${basis}"`).length - 1, basis).toBe(1);
  });

  it("the card tip names the country rule when it is known, and still fits for a long country name", () => {
    expect(consentCardTip("Qatar")).toContain("rules for Qatar");
    expect(consentCardTip(null)).toBe(CONSENT_CARD_TIPS.card);
    expect(tipTextProblems(consentCardTip("The Democratic Republic of the Congo, rules for the whole region"))).toEqual([]);
  });

  it("a person's own words are clipped to the limit instead of overflowing the tip", () => {
    const note = "Agreed on the phone, then again by email, ".repeat(40);
    expect(tipTextProblems(consentRowTip({ basis: "They agreed", source: "Recorded by a person", note }))).toEqual([]);
    expect(clipTip("short")).toBe("short");
    expect(consentRowTip({ basis: "They agreed", source: null, note: null })).toBe("They agreed");
  });
});
