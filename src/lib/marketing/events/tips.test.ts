import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { EVENT_TIPS, eventDateTip } from "./tips";
import { KIND_HINT, STATUS_HINT } from "./rules";

describe("the event form explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(EVENT_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    for (const [key, text] of Object.entries(KIND_HINT)) expect(tipTextProblems(text), key).toEqual([]);
    for (const [key, text] of Object.entries(STATUS_HINT)) expect(tipTextProblems(text), key).toEqual([]);
    expect(tipTextProblems(eventDateTip("Asia/Riyadh"))).toEqual([]);
  });
});
