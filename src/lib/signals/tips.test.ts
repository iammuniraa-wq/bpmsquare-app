import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { SIGNAL_TIPS } from "./tips";

describe("the buying signals explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(SIGNAL_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
