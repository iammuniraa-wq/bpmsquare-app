import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CHANGE_KINDS, CHANGE_KIND_HINT, CHANGE_KIND_LABEL } from "./types";
import { STUDIO_TIPS, sendTip } from "./tips";

describe("the Process Design Studio explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(STUDIO_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so does the one built from the version number", () => {
    expect(tipTextProblems(sendTip(1))).toEqual([]);
    expect(tipTextProblems(sendTip(120))).toEqual([]);
  });
  it("and so does the explanation of every kind of change", () => {
    for (const k of CHANGE_KINDS) expect(tipTextProblems(CHANGE_KIND_HINT[k]), k).toEqual([]);
  });
});

describe("the kinds of change", () => {
  it("call a workspace-only change Built for you, whatever it is stored as", () => {
    expect(CHANGE_KIND_LABEL.extension).toBe("Built for you");
    expect(CHANGE_KINDS).toContain("extension");
    expect(CHANGE_KIND_HINT.extension).toContain("only for your workspace");
  });
});
