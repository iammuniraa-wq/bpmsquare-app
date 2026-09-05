import { describe, it, expect } from "vitest";
import { groupSpans, type SpanRow } from "./rosterSpans";

const r = (id: string, employee_id: string, date: string, extra: Partial<SpanRow> = {}): SpanRow =>
  ({ id, employee_id, date, is_day_off: false, shift_id: null, project_id: null, ...extra });

describe("groupSpans", () => {
  it("folds consecutive days on the same project into one span", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-08", { project_id: "p" }),
      r("2", "a", "2026-09-09", { project_id: "p" }),
      r("3", "a", "2026-09-10", { project_id: "p" }),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ from: "2026-09-08", to: "2026-09-10", project_id: "p" });
    expect(spans[0].rows.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("does not care what order the rows arrive in", () => {
    const spans = groupSpans([
      r("3", "a", "2026-09-10", { project_id: "p" }),
      r("1", "a", "2026-09-08", { project_id: "p" }),
      r("2", "a", "2026-09-09", { project_id: "p" }),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].rows.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  // A Monday and a Wednesday are two assignments, not one with a hole in it.
  it("starts a new span at a gap", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-08", { project_id: "p" }),
      r("2", "a", "2026-09-10", { project_id: "p" }),
    ]);
    expect(spans.map((s) => [s.from, s.to])).toEqual([["2026-09-08", "2026-09-08"], ["2026-09-10", "2026-09-10"]]);
  });

  it("starts a new span when the project changes, even on consecutive days", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-08", { project_id: "p" }),
      r("2", "a", "2026-09-09", { project_id: "q" }),
    ]);
    expect(spans.map((s) => s.project_id)).toEqual(["p", "q"]);
  });

  it("keeps a day off apart from a shift change on the neighbouring day", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-08", { shift_id: "s" }),
      r("2", "a", "2026-09-09", { is_day_off: true }),
    ]);
    expect(spans).toHaveLength(2);
  });

  it("never merges two employees", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-08", { project_id: "p" }),
      r("2", "b", "2026-09-09", { project_id: "p" }),
    ]);
    expect(spans).toHaveLength(2);
  });

  it("puts the soonest span first", () => {
    const spans = groupSpans([
      r("1", "b", "2026-09-12"),
      r("2", "a", "2026-09-08"),
    ]);
    expect(spans.map((s) => s.employee_id)).toEqual(["a", "b"]);
  });

  // The month boundary is where a naive "day + 1" string comparison fails.
  it("treats the last of the month and the first of the next as consecutive", () => {
    const spans = groupSpans([
      r("1", "a", "2026-09-30", { project_id: "p" }),
      r("2", "a", "2026-10-01", { project_id: "p" }),
    ]);
    expect(spans).toHaveLength(1);
  });
});
