import { describe, expect, it } from "vitest";
import { differsByPct, pinChipLabel, pinState } from "./review";
import { DRAWING_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";

describe("a new release changes nothing by itself", () => {
  it("a line pinned to the released revision is current", () => {
    expect(pinState({ pinnedRevId: "b", currentRevId: "b", dismissedRevId: null })).toBe("current");
  });
  it("a later release flags the line for review until it is applied or dismissed", () => {
    expect(pinState({ pinnedRevId: "b", currentRevId: "c", dismissedRevId: null })).toBe("review");
    expect(pinState({ pinnedRevId: "b", currentRevId: "c", dismissedRevId: "c" })).toBe("dismissed");
  });
  it("a dismissal holds for THAT release only: a still later one asks again", () => {
    expect(pinState({ pinnedRevId: "b", currentRevId: "d", dismissedRevId: "c" })).toBe("review");
  });
  it("a line with no pin has no state", () => {
    expect(pinState({ pinnedRevId: null, currentRevId: "c", dismissedRevId: null })).toBeNull();
  });
  it("the chip says what to do", () => {
    expect(pinChipLabel("review", "DWG-1", "B", "C")).toBe("Rev C released: review changes");
    expect(pinChipLabel("current", "DWG-1", "B", "B")).toBe("DWG-1 B");
    expect(pinChipLabel("dismissed", "DWG-1", "B", "C")).toContain("C reviewed");
  });
});

describe("the model quantity beside the client's", () => {
  it("differs by n percent, or not at all", () => {
    expect(differsByPct(100, 112)).toBe(12);
    expect(differsByPct(100, 88)).toBe(-12);
    expect(differsByPct(100, 100)).toBeNull();
    expect(differsByPct(0, 5)).toBeNull();
    expect(differsByPct(null, 5)).toBeNull();
    expect(differsByPct(10, null)).toBeNull();
  });
});

describe("the register's explanations", () => {
  it.each(Object.entries(DRAWING_TIPS))("%s holds to the InfoTip limit", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
