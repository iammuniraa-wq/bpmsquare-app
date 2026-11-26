import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CHECK_TIPS } from "./tips";
import { VERDICT_LABEL, VERDICT_TONE, VERDICTS } from "./types";

describe("Supplier check explanations", () => {
  it("every text behind an 'i' fits the limit (two sentences, 160 characters)", () => {
    for (const [key, text] of Object.entries(CHECK_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });

  it("the caveat that this is a risk indicator, not a legal finding, is behind the 'i'", () => {
    expect(CHECK_TIPS.overall).toMatch(/risk indicator/);
    expect(CHECK_TIPS.overall).toMatch(/not a legal finding/);
  });

  it("the verdict words say 'could not verify' and 'concerning', never an accusation, and each verdict has a tone", () => {
    expect(VERDICT_LABEL.unverified).toBe("Could not verify");
    expect(VERDICT_LABEL.concerning).toBe("Concerning");
    for (const v of VERDICTS) {
      expect(VERDICT_LABEL[v]).not.toMatch(/fraud|scam|fake|criminal/i);
      expect(VERDICT_TONE[v]).toBeTruthy();
    }
  });
});
