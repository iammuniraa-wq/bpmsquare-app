import { describe, it, expect } from "vitest";
import { tabTarget, scrollTargetFor, landingTab, estimateTabs, newEstimateTab, ESTIMATE_TAB_IDS } from "./tabTargets";

describe("the estimate's tabs", () => {
  it("are four at most, the working page first", () => {
    expect(estimateTabs({ schedule: true, saved: true }).map((t) => t.label)).toEqual(["Estimate", "Materials", "Schedule & risk", "Details & activity"]);
    expect(estimateTabs({ schedule: false, saved: true }).map((t) => t.id)).toEqual(["estimate", "materials", "activity"]);
  });
  it("a new estimate shows the saved-only tabs disabled, with the reason behind an i", () => {
    const tabs = estimateTabs({ schedule: true, saved: false, needsSaveTip: "Available once the estimate is saved." });
    expect(tabs.filter((t) => t.disabled).map((t) => t.id)).toEqual(["materials", "activity"]);
    expect(tabs.find((t) => t.id === "materials")!.info).toBe("Available once the estimate is saved.");
    expect(estimateTabs({ schedule: true, saved: true }).some((t) => t.disabled)).toBe(false);
  });
  it("a new estimate is only ever on the working page or the schedule", () => {
    expect(newEstimateTab("materials", true)).toBe("estimate");
    expect(newEstimateTab("activity", true)).toBe("estimate");
    expect(newEstimateTab("schedule", true)).toBe("schedule");
    expect(newEstimateTab("schedule", false)).toBe("estimate");
  });
});

describe("old ?tab= links", () => {
  it("land on the tab their content moved to", () => {
    expect(tabTarget("bom")).toEqual({ tab: "materials" });
    expect(tabTarget("simulation")).toEqual({ tab: "schedule" });
    expect(tabTarget("overview")).toEqual({ tab: "activity" });
  });
  it("scroll to the parts that are on the working page", () => {
    expect(tabTarget("costing")).toEqual({ tab: "estimate", scroll: "price", openPrice: true });
    expect(tabTarget("inputs")).toEqual({ tab: "estimate", scroll: "about" });
    expect(tabTarget("quote")).toEqual({ tab: "estimate", scroll: "price-card" });
  });
  it("leave today's tab ids and anything else alone", () => {
    for (const id of ESTIMATE_TAB_IDS) expect(tabTarget(id)).toBeNull();
    expect(tabTarget("nonsense")).toBeNull();
    expect(tabTarget(undefined)).toBeNull();
    expect(tabTarget("")).toBeNull();
  });
  it("only ever name a tab that exists", () => {
    for (const t of ["bom", "costing", "simulation", "overview", "inputs", "quote"]) expect(ESTIMATE_TAB_IDS).toContain(tabTarget(t)!.tab);
  });
  it("a ?line= link goes to the model on the working page", () => {
    expect(scrollTargetFor(null, true)).toBe("villa");
    expect(scrollTargetFor(null, false)).toBeNull();
    expect(scrollTargetFor({ tab: "schedule" }, true)).toBe("villa");
    expect(landingTab({ tab: "schedule" }, true)).toBe("estimate");
    expect(landingTab({ tab: "schedule" }, false)).toBe("schedule");
    expect(scrollTargetFor({ tab: "materials" }, true)).toBeNull();
    expect(landingTab({ tab: "materials" }, true)).toBe("materials");
    expect(scrollTargetFor({ tab: "estimate", scroll: "about" }, false)).toBe("about");
    expect(landingTab(null, true)).toBeNull();
  });
});
