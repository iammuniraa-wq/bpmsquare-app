import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { LEAD_SCORE_TIPS, whyScoreTip } from "./tips";

describe("the lead score explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(LEAD_SCORE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so does the one that names the rules version, even for a large version number", () => {
    expect(tipTextProblems(whyScoreTip(3))).toEqual([]);
    expect(tipTextProblems(whyScoreTip(123456))).toEqual([]);
  });
});
