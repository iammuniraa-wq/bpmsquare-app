import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { ESTIMATE_TIPS } from "./tips";

describe("the estimate page's explanations", () => {
  it("fit the InfoTip limit", () => {
    for (const [k, t] of Object.entries(ESTIMATE_TIPS)) expect(tipTextProblems(t), k).toEqual([]);
  });
});
