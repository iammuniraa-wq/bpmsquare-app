import { describe, it, expect } from "vitest";
import { effortBand, NEW_HOOK, BAND_DAYS } from "./effort";
import {
  templateTasks, normaliseExtraTasks, schedulePhases, firstWorkingDay, endOfWorkingDays, totalWorkingDays, isWorkingDay,
  type PlanContext,
} from "./plan";
import { PHASES } from "./types";

const known = { hooks: new Set(["quoteExtraSection", "beforeSaveAccount"]), connectors: new Set(["dynamics365", "gmail"]) };

describe("effort bands are a rule from the kind of change", () => {
  it("setting and own fields are Small", () => {
    expect(effortBand("setting", { extensionHook: null, connector: null }, known)).toBe("small");
    expect(effortBand("own_fields", { extensionHook: null, connector: null }, known)).toBe("small");
  });
  it("a tenant extension on an existing hook is Medium; a new hook is Large", () => {
    expect(effortBand("extension", { extensionHook: "quoteExtraSection", connector: null }, known)).toBe("medium");
    expect(effortBand("extension", { extensionHook: NEW_HOOK, connector: null }, known)).toBe("large");
    expect(effortBand("extension", { extensionHook: "madeUpHook", connector: null }, known)).toBe("large");
    expect(effortBand("extension", { extensionHook: null, connector: null }, known)).toBe("large");
  });
  it("a new build is Large", () => {
    expect(effortBand("new_build", { extensionHook: null, connector: null }, known)).toBe("large");
  });
  it("an integration on an existing connector is Medium, otherwise Large", () => {
    expect(effortBand("integration", { extensionHook: null, connector: "dynamics365" }, known)).toBe("medium");
    expect(effortBand("integration", { extensionHook: null, connector: "sap" }, known)).toBe("large");
    expect(effortBand("integration", { extensionHook: null, connector: null }, known)).toBe("large");
  });
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ modules: new Set(), areas: new Set(), changes: [], ...over });

describe("template tasks", () => {
  it("always has foundations and go-live, and nothing for modules that were not cited", () => {
    const t = templateTasks(ctx());
    expect(new Set(t.map((x) => x.phase))).toEqual(new Set(["foundations", "go_live"]));
    expect(t.every((x) => x.from_template)).toBe(true);
  });

  it("adds the sales and workforce tasks only when those modules were cited", () => {
    const t = templateTasks(ctx({ modules: new Set(["estimator", "wfm"]) }));
    const phases = new Set(t.map((x) => x.phase));
    expect(phases.has("sales")).toBe(true);
    expect(phases.has("workforce")).toBe(true);
    expect(phases.has("service_production")).toBe(false);
    expect(t.some((x) => x.name === "Build your estimate templates")).toBe(true);
  });

  it("turns kept changes into tasks: integrations in their own phase, the rest as customisations, days by band", () => {
    const t = templateTasks(ctx({
      changes: [
        { id: "1", kind: "setting", title: "Bid approval rule", effort_band: "small" },
        { id: "2", kind: "integration", title: "Delivery plan to the ERP", effort_band: "large" },
      ],
    }));
    const a = t.find((x) => x.name === "Bid approval rule");
    const b = t.find((x) => x.name === "Delivery plan to the ERP");
    expect(a).toMatchObject({ phase: "customisations", duration_days: BAND_DAYS.small, owner: "bpmsquare" });
    expect(b).toMatchObject({ phase: "integrations", duration_days: BAND_DAYS.large });
  });
});

describe("extra tasks from the model are made safe", () => {
  it("clamps days, drops unknown phases and duplicates of template tasks", () => {
    const { tasks, warnings } = normaliseExtraTasks([
      { phase: "sales", name: "Load the Excel price sheet", owner: "client", duration_days: 99, milestone: false },
      { phase: "nowhere", name: "Mystery", owner: "client", duration_days: 2 },
      { phase: "go_live", name: "go live", owner: "client", duration_days: 1 },
      { phase: "workforce", name: "Train the yard supervisor", owner: "bpmsquare", duration_days: 0 },
    ], [{ name: "Go live" }]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].duration_days).toBe(30);
    expect(tasks[1].duration_days).toBe(1);
    expect(tasks.every((t) => t.from_template === false)).toBe(true);
    expect(warnings.join(" ")).toMatch(/unknown phase/);
  });
});

describe("dates are computed from working days", () => {
  // 2026-11-01 is a Sunday. Friday + Saturday weekend: Sunday is a working day.
  it("counts working days with the chosen weekend", () => {
    expect(isWorkingDay(new Date(Date.UTC(2026, 10, 1)), "fri_sat")).toBe(true);
    expect(isWorkingDay(new Date(Date.UTC(2026, 10, 6)), "fri_sat")).toBe(false); // Friday
    expect(isWorkingDay(new Date(Date.UTC(2026, 10, 1)), "sat_sun")).toBe(false); // Sunday
    expect(firstWorkingDay("2026-11-06", "fri_sat")).toBe("2026-11-08");
    expect(firstWorkingDay("2026-11-01", "sat_sun")).toBe("2026-11-02");
  });

  it("a block of one day ends the day it starts; five days skip the weekend", () => {
    expect(endOfWorkingDays("2026-11-02", 1, "sat_sun")).toBe("2026-11-02");
    expect(endOfWorkingDays("2026-11-02", 5, "sat_sun")).toBe("2026-11-06");
    expect(endOfWorkingDays("2026-11-02", 6, "sat_sun")).toBe("2026-11-09");
    expect(endOfWorkingDays("2026-11-02", 3, "fri_sat")).toBe("2026-11-04");
    expect(endOfWorkingDays("2026-11-04", 3, "fri_sat")).toBe("2026-11-08"); // Wed, Thu, then Sun
  });

  it("schedules phases one after another in the fixed order and drops empty ones", () => {
    const phases = schedulePhases([
      { phase: "go_live", duration_days: 2 },
      { phase: "foundations", duration_days: 3 },
      { phase: "sales", duration_days: 5 },
    ], "2026-11-02", "sat_sun");
    expect(phases.map((p) => p.phase)).toEqual(["foundations", "sales", "go_live"]);
    expect(phases[0]).toMatchObject({ start: "2026-11-02", end: "2026-11-04", days: 3 });
    expect(phases[1]).toMatchObject({ start: "2026-11-05", end: "2026-11-11", days: 5 });
    expect(phases[2]).toMatchObject({ start: "2026-11-12", end: "2026-11-13", days: 2 });
    expect(totalWorkingDays(phases)).toBe(10);
  });

  it("moves every date when a duration changes", () => {
    const a = schedulePhases([{ phase: "foundations", duration_days: 2 }, { phase: "go_live", duration_days: 1 }], "2026-11-02", "sat_sun");
    const b = schedulePhases([{ phase: "foundations", duration_days: 6 }, { phase: "go_live", duration_days: 1 }], "2026-11-02", "sat_sun");
    expect(a[1].start).toBe("2026-11-04");
    expect(b[1].start).toBe("2026-11-10");
  });

  it("knows the fixed phase order", () => {
    expect(PHASES[0]).toBe("foundations");
    expect(PHASES[PHASES.length - 1]).toBe("go_live");
  });
});
