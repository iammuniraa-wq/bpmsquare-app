import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { SCORING_TIPS } from "./scoringTips";

describe("the scoring explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(SCORING_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
