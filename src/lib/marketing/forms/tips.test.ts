import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { FORM_TIPS } from "./tips";

describe("the form builder explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(FORM_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
