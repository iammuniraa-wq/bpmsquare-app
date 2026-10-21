import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { ABM_TIPS, copiedListTip, ownerTip, resultsTip } from "./tips";
import { PROGRAM_STATUS_LABEL, PROGRESS_LABEL } from "./types";

describe("the ABM explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(ABM_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so do the ones built from the program's own facts", () => {
    for (const unchanged of [true, false]) for (const s of ["coverage", "program", "manual"] as const) expect(tipTextProblems(ownerTip(s, unchanged)), `${s} ${unchanged}`).toEqual([]);
    expect(tipTextProblems(copiedListTip(true, "03 Oct 2026"))).toEqual([]);
    expect(tipTextProblems(copiedListTip(false, "03 Oct 2026"))).toEqual([]);
    expect(tipTextProblems(resultsTip(0, 0))).toEqual([]);
    expect(tipTextProblems(resultsTip(12, 345))).toEqual([]);
  });
});

describe("the vocabulary", () => {
  it("calls a target that has answered Responding, and a program that is switched on Live, finished Done", () => {
    expect(PROGRESS_LABEL.engaged).toBe("Responding");
    expect(PROGRAM_STATUS_LABEL.active).toBe("Live");
    expect(PROGRAM_STATUS_LABEL.completed).toBe("Done");
  });
  it("uses the new word in the tip that names it, never the old one", () => {
    expect(ABM_TIPS.requiredRoles).toContain("Responding");
    expect(ABM_TIPS.requiredRoles).not.toContain("Engaged");
  });
});
