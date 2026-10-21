import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { WEBHOOK_TIPS, kindTip } from "./tips";
import { MIDDLEWARE_TIPS } from "../middleware/tips";

// bpmsquarecore 6b: every explanation sits behind an "i" and fits two sentences, 160 characters.
describe("the Webhooks tips", () => {
  for (const [key, text] of Object.entries(WEBHOOK_TIPS)) {
    it(`${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
  it("the kind tip fits for both kinds", () => {
    expect(tipTextProblems(kindTip("event"))).toEqual([]);
    expect(tipTextProblems(kindTip("call"))).toEqual([]);
  });
  it("the Links webhook tip fits", () => expect(tipTextProblems(MIDDLEWARE_TIPS.whichWebhook)).toEqual([]));
});
