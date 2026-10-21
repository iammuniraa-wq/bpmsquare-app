import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { WA_SETUP_TIPS, WA_TEMPLATE_TIPS } from "./tips";
import { CATEGORY_HINT } from "./template";

describe("the WhatsApp explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(WA_SETUP_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    for (const [key, text] of Object.entries(WA_TEMPLATE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    for (const [key, text] of Object.entries(CATEGORY_HINT)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
