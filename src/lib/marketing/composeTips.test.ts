import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { COMPOSE_TIPS } from "./composeTips";

describe("the New campaign explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(COMPOSE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
