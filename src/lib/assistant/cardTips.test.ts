import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CARD_TIPS } from "./cardTips";
import { VERB_ACTIONS } from "@/lib/actions/registry";

describe("the card tips", () => {
  it("each is two short sentences at most, behind the i (rule 6b)", () => {
    for (const [key, text] of Object.entries(CARD_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });

  it("every tender step has its own tip, and so does a change", () => {
    for (const v of VERB_ACTIONS) expect(Object.keys(CARD_TIPS), v.verb).toContain(v.verb);
    expect(Object.keys(CARD_TIPS)).toContain("update");
  });
});
