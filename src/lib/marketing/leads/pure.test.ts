import { describe, it, expect } from "vitest";
import { addBusinessDays, describeDue, isLeadOverdue, slaDueFrom } from "./timing";
import { nextInRotation } from "./roundRobin";
import { eventDetail, eventWords } from "./eventWords";
import { filtersUseLeadSignals } from "./segmentSignals";
import { SEGMENT_FIELDS, offeredSegmentFields, matchesAllFilters } from "@/lib/marketingSegmentation";

describe("response time", () => {
  // 2026-10-22 is a Thursday.
  const thu = new Date("2026-10-22T09:00:00Z");

  it("adds working days and keeps the time of day", () => {
    expect(addBusinessDays(thu, 1, [0]).toISOString()).toBe("2026-10-23T09:00:00.000Z");
  });

  it("skips the weekly-off days (Friday and Saturday for a Gulf workspace)", () => {
    // Thursday + 1 working day with Fri/Sat off lands on Sunday.
    const due = addBusinessDays(thu, 1, [5, 6]);
    expect(due.getUTCDay()).toBe(0);
    expect(due.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("never lands on an off day even with zero days to add", () => {
    const sat = new Date("2026-10-24T09:00:00Z");
    expect(addBusinessDays(sat, 0, [5, 6]).getUTCDay()).toBe(0);
  });

  it("does not loop forever when every day is off", () => {
    expect(addBusinessDays(thu, 1, [0, 1, 2, 3, 4, 5, 6]).toISOString()).toBe("2026-10-23T09:00:00.000Z");
  });

  it("defaults to one working day, Sunday off", () => {
    const sat = new Date("2026-10-24T09:00:00Z");
    expect(slaDueFrom(sat, undefined).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("a lead is overdue only while it is ready and its time has passed", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(isLeadOverdue("ready", "2026-10-23T09:00:00Z", now)).toBe(true);
    expect(isLeadOverdue("ready", "2026-10-24T09:00:00Z", now)).toBe(false);
    expect(isLeadOverdue("working", "2026-10-23T09:00:00Z", now)).toBe(false);
    expect(isLeadOverdue("ready", null, now)).toBe(false);
  });

  it("describes a deadline in plain words", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(describeDue("2026-10-23T17:00:00Z", now)).toBe("due in 5 hours");
    expect(describeDue("2026-10-21T12:00:00Z", now)).toBe("2 days overdue");
  });
});

describe("round robin", () => {
  it("starts with the first member and then goes round", () => {
    const m = ["c", "a", "b"];
    expect(nextInRotation(m, null)).toBe("a");
    expect(nextInRotation(m, "a")).toBe("b");
    expect(nextInRotation(m, "b")).toBe("c");
    expect(nextInRotation(m, "c")).toBe("a");
  });

  it("carries on sensibly when the last person has left the team", () => {
    expect(nextInRotation(["a", "c"], "b")).toBe("c");
    expect(nextInRotation(["a", "b"], "z")).toBe("a");
  });

  it("returns nobody for an empty team", () => {
    expect(nextInRotation([], "a")).toBeNull();
  });
});

describe("timeline words", () => {
  it("speaks plainly, and shows an unknown event by its name rather than hiding it", () => {
    expect(eventWords("quote.opened")).toBe("Opened a quote");
    expect(eventWords("something.new")).toBe("something.new");
    expect(eventDetail("lead.stage_changed", { from: "new", to: "ready" })).toBe("new to ready");
    expect(eventDetail("email.opened", { secret: "x" })).toBeNull();
  });
});

describe("lead score and stage in campaign audiences", () => {
  it("is offered only in the marketing builder, and only with lead scoring on", () => {
    const keys = (o: Parameters<typeof offeredSegmentFields>[0]) => offeredSegmentFields(o).map((f) => f.key);
    expect(keys({ marketingBuilder: true, scoringOn: true })).toEqual(expect.arrayContaining(["lead_score", "lead_stage"]));
    expect(keys({ marketingBuilder: true, scoringOn: false })).not.toContain("lead_score");
    expect(keys({ marketingBuilder: false, scoringOn: true })).not.toContain("lead_stage");
    // Everything else is untouched for everyone.
    expect(keys({ marketingBuilder: false, scoringOn: false }).length).toBe(SEGMENT_FIELDS.filter((f) => f.scope !== "marketing" && !f.audience).length);
  });

  it("evaluates against the account's best lead", () => {
    const filters = [{ id: "1", field: "lead_score", operator: "gt" as const, value: "59" }, { id: "2", field: "lead_stage", operator: "equals" as const, value: "ready" }];
    expect(matchesAllFilters({ lead_score: 72, lead_stage: "ready" }, filters, "all")).toBe(true);
    expect(matchesAllFilters({ lead_score: 40, lead_stage: "ready" }, filters, "all")).toBe(false);
    expect(matchesAllFilters({}, filters, "all")).toBe(false);
    expect(filtersUseLeadSignals(filters)).toBe(true);
    expect(filtersUseLeadSignals([{ id: "x", field: "city", operator: "equals", value: "Doha" }])).toBe(false);
  });
});
