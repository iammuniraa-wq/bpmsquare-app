import { describe, it, expect } from "vitest";
import { tabTarget, scrollTargetFor, SECTION_IDS } from "./tabTargets";

describe("old ?tab= links", () => {
  it("opens the section a tab became", () => {
    expect(tabTarget("bom")).toEqual({ open: "bom" });
    expect(tabTarget("costing")).toEqual({ open: "price" });
    expect(tabTarget("simulation")).toEqual({ open: "schedule" });
    expect(tabTarget("overview")).toEqual({ open: "details" });
  });
  it("scrolls to the parts that moved onto the main page", () => {
    expect(tabTarget("inputs")).toEqual({ scroll: "about" });
    expect(tabTarget("quote")).toEqual({ scroll: "price-card" });
    expect(tabTarget("activity")).toEqual({ scroll: "activity" });
  });
  it("ignores anything else", () => {
    expect(tabTarget("nonsense")).toBeNull();
    expect(tabTarget(undefined)).toBeNull();
    expect(tabTarget("")).toBeNull();
  });
  it("only ever opens a section that exists", () => {
    for (const t of ["bom", "costing", "simulation", "overview"]) expect(SECTION_IDS).toContain(tabTarget(t)!.open);
  });
  it("a bare ?line= link goes to the villa", () => {
    expect(scrollTargetFor(null, true)).toBe("villa");
    expect(scrollTargetFor(null, false)).toBeNull();
    expect(scrollTargetFor({ open: "schedule" }, true)).toBe("villa");
    expect(scrollTargetFor({ open: "bom" }, true)).toBe("bom");
    expect(scrollTargetFor({ scroll: "about" }, false)).toBe("about");
  });
});
