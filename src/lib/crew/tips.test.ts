import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CREW_TIPS } from "./tips";

// bpmsquarecore 6b: every explanation on an AI automation screen sits behind an "i" and is held to the InfoTip limit (two short sentences, 160 characters).

describe("the AI automation explanations", () => {
  it.each(Object.entries(CREW_TIPS))("%s fits behind an i", (_key, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
