import { describe, it, expect } from "vitest";
import {
  isObsolete, isEmployeeInRange, isEmployeeActiveOn, clipDatesToValidity, obsoleteLabel, statusLabel,
  inRangeOrFilter, markObsoleteEmbeds, reconcileObsoletePatch, restoreNote,
} from "./obsolete";

const active = { status: "active", valid_to: null };
const obs = (valid_to: string | null) => ({ status: "inactive", valid_to });

describe("isEmployeeInRange", () => {
  it("an active employee is always in range, whatever their validity dates", () => {
    expect(isEmployeeInRange(active, "2026-10-01", "2026-10-31")).toBe(true);
    expect(isEmployeeInRange({ status: "active", valid_to: "2025-01-01" }, "2026-10-01", "2026-10-31")).toBe(true);
  });

  it("includes an obsolete employee when valid_to is inside the range", () => {
    expect(isEmployeeInRange(obs("2026-10-15"), "2026-10-01", "2026-10-31")).toBe(true);
  });

  it("the valid_to day itself is included: a range that starts on it still counts them", () => {
    expect(isEmployeeInRange(obs("2026-10-15"), "2026-10-15", "2026-10-31")).toBe(true);
  });

  it("the day after valid_to is excluded", () => {
    expect(isEmployeeInRange(obs("2026-10-15"), "2026-10-16", "2026-10-31")).toBe(false);
  });

  it("an obsolete employee with valid_to after the range is still in it", () => {
    expect(isEmployeeInRange(obs("2026-12-31"), "2026-10-01", "2026-10-31")).toBe(true);
  });

  it("an obsolete employee with no valid_to keeps the old behaviour: excluded", () => {
    expect(isEmployeeInRange(obs(null), "2026-10-01", "2026-10-31")).toBe(false);
  });

  it("an inverted range matches nobody", () => {
    expect(isEmployeeInRange(active, "2026-10-31", "2026-10-01")).toBe(false);
  });
});

describe("isEmployeeActiveOn (live board, pickers)", () => {
  it("shows through valid_to and not after", () => {
    expect(isEmployeeActiveOn(obs("2026-10-23"), "2026-10-23")).toBe(true);
    expect(isEmployeeActiveOn(obs("2026-10-23"), "2026-10-24")).toBe(false);
  });
});

describe("clipDatesToValidity", () => {
  const dates = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
  it("keeps every day for an active employee", () => {
    expect(clipDatesToValidity(dates, active)).toEqual(dates);
  });
  it("drops the days after valid_to and keeps valid_to itself", () => {
    expect(clipDatesToValidity(dates, obs("2026-10-15"))).toEqual(["2026-10-14", "2026-10-15"]);
  });
  it("gives nothing for an obsolete employee with no date", () => {
    expect(clipDatesToValidity(dates, obs(null))).toEqual([]);
  });
});

describe("labels", () => {
  it("names an obsolete employee, leaves an active one alone", () => {
    expect(obsoleteLabel("Asha Rao", obs("2026-10-15"))).toBe("Asha Rao (obsolete)");
    expect(obsoleteLabel("Asha Rao", active)).toBe("Asha Rao");
  });
  it("shows one word for the status", () => {
    expect(statusLabel(active)).toBe("Active");
    expect(statusLabel(obs("2026-10-15"))).toBe("Obsolete");
    expect(isObsolete(obs(null))).toBe(true);
  });
});

describe("inRangeOrFilter", () => {
  it("is the PostgREST twin of isEmployeeInRange", () => {
    expect(inRangeOrFilter("2026-10-01")).toBe("status.eq.active,and(status.eq.inactive,valid_to.gte.2026-10-01)");
  });
  it("refuses anything that is not a date, since it is spliced into a filter", () => {
    expect(() => inRangeOrFilter("2026-10-01),status.eq.x")).toThrow();
  });
});

describe("markObsoleteEmbeds", () => {
  it("appends (obsolete) to the surname of an obsolete employee only", () => {
    const rows = [
      { id: 1, employees: { first_name: "Asha", last_name: "Rao", status: "inactive" } },
      { id: 2, employees: { first_name: "Ben", last_name: "Lee", status: "active" } },
      { id: 3, employees: null },
    ];
    const out = markObsoleteEmbeds(rows);
    expect(out[0].employees).toMatchObject({ first_name: "Asha", last_name: "Rao (obsolete)" });
    expect(out[1].employees).toMatchObject({ last_name: "Lee" });
    expect(out[2].employees).toBeNull();
    expect(rows[0].employees?.last_name).toBe("Rao");
  });
  it("falls back to the first name when there is no surname", () => {
    const out = markObsoleteEmbeds([{ employees: { first_name: "Madonna", last_name: "", status: "inactive" } }]);
    expect(out[0].employees?.first_name).toBe("Madonna (obsolete)");
  });
  it("tolerates null input", () => {
    expect(markObsoleteEmbeds(null)).toEqual([]);
  });
});

describe("reconcileObsoletePatch: make obsolete / make active date handling", () => {
  const TODAY = "2026-10-23";

  it("make obsolete stamps today when valid_to is empty", () => {
    expect(reconcileObsoletePatch(active, { status: "inactive" }, TODAY)).toMatchObject({ valid_to: TODAY });
  });

  it("make obsolete stamps today when valid_to is in the future", () => {
    expect(reconcileObsoletePatch({ status: "active", valid_to: "2026-12-31" }, { status: "inactive" }, TODAY).valid_to).toBe(TODAY);
  });

  it("make obsolete never overwrites an earlier valid_to", () => {
    const patch = reconcileObsoletePatch({ status: "active", valid_to: "2026-09-30" }, { status: "inactive" }, TODAY);
    expect("valid_to" in patch).toBe(false);
  });

  it("make obsolete keeps a valid_to that is exactly today", () => {
    const patch = reconcileObsoletePatch({ status: "active", valid_to: TODAY }, { status: "inactive" }, TODAY);
    expect("valid_to" in patch).toBe(false);
  });

  it("an editor that sends the unchanged valid_to along is treated the same as not sending it", () => {
    const patch = reconcileObsoletePatch({ status: "active", valid_to: "2026-09-30" }, { status: "inactive", valid_to: "2026-09-30" }, TODAY);
    expect(patch.valid_to).toBe("2026-09-30");
  });

  it("a valid_to typed in the same save wins", () => {
    const patch = reconcileObsoletePatch(active, { status: "inactive", valid_to: "2026-10-20" }, TODAY);
    expect(patch.valid_to).toBe("2026-10-20");
  });

  it("clearing valid_to while making obsolete still leaves a date", () => {
    const patch = reconcileObsoletePatch({ status: "active", valid_to: "2026-09-30" }, { status: "inactive", valid_to: null }, TODAY);
    expect(patch.valid_to).toBe(TODAY);
  });

  it("make active again clears a valid_to that is in the past", () => {
    expect(reconcileObsoletePatch(obs("2026-10-01"), { status: "active" }, TODAY).valid_to).toBeNull();
  });

  it("make active again clears a valid_to that is today", () => {
    expect(reconcileObsoletePatch(obs(TODAY), { status: "active" }, TODAY).valid_to).toBeNull();
  });

  it("make active again leaves a future valid_to alone", () => {
    const patch = reconcileObsoletePatch(obs("2026-12-31"), { status: "active" }, TODAY);
    expect("valid_to" in patch).toBe(false);
  });

  it("make active again honours a valid_to chosen in the same save", () => {
    expect(reconcileObsoletePatch(obs("2026-10-01"), { status: "active", valid_to: "2027-03-31" }, TODAY).valid_to).toBe("2027-03-31");
  });

  it("never touches the validity of an employee who stays active", () => {
    const patch = reconcileObsoletePatch({ status: "active", valid_to: "2026-12-31" }, { status: "active", valid_to: "2026-12-31" }, TODAY);
    expect(patch.valid_to).toBe("2026-12-31");
    const noStatus = reconcileObsoletePatch({ status: "active", valid_to: "2025-01-01" }, { valid_to: "2025-01-01" }, TODAY);
    expect(noStatus.valid_to).toBe("2025-01-01");
  });

  it("an already-obsolete legacy row with no date gets one", () => {
    expect(reconcileObsoletePatch(obs(null), { status: "inactive" }, TODAY).valid_to).toBe(TODAY);
  });
});

describe("restoreNote", () => {
  it("says the date is cleared when it is past or today", () => {
    expect(restoreNote("2026-10-01", "2026-10-23")).toMatch(/cleared/);
    expect(restoreNote("2026-10-23", "2026-10-23")).toMatch(/cleared/);
  });
  it("says a future date stays", () => {
    expect(restoreNote("2026-12-31", "2026-10-23")).toMatch(/stays/);
  });
  it("is empty when there is no date", () => {
    expect(restoreNote(null, "2026-10-23")).toBe("");
  });
});
