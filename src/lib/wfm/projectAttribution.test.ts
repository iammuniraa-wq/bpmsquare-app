import { describe, it, expect } from "vitest";
import {
  projectCoversDate,
  resolveAttribution,
  resolveProjectId,
  type ProjectLink,
  type PunchContext,
} from "./projectAttribution";

const DATE = "2026-09-04";

const link = (over: Partial<ProjectLink> = {}): ProjectLink => ({
  project_id: "p1",
  project_status: "active",
  project_start: null,
  project_end: null,
  site_id: null,
  employee_id: null,
  shift_id: null,
  ...over,
});

const ctx = (over: Partial<PunchContext> = {}): PunchContext => ({
  employeeId: "e1",
  siteId: "s1",
  shiftId: "sh1",
  date: DATE,
  ...over,
});

describe("projectCoversDate", () => {
  it("is inclusive at both ends", () => {
    const l = link({ project_start: "2026-09-01", project_end: "2026-09-30" });
    expect(projectCoversDate(l, "2026-09-01")).toBe(true);
    expect(projectCoversDate(l, "2026-09-30")).toBe(true);
  });

  it("excludes dates outside the window", () => {
    const l = link({ project_start: "2026-09-01", project_end: "2026-09-30" });
    expect(projectCoversDate(l, "2026-08-31")).toBe(false);
    expect(projectCoversDate(l, "2026-10-01")).toBe(false);
  });

  it("treats either end as open when unset", () => {
    expect(projectCoversDate(link(), "2099-01-01")).toBe(true);
    expect(projectCoversDate(link({ project_start: "2026-01-01" }), "2099-01-01")).toBe(true);
    expect(projectCoversDate(link({ project_end: "2026-12-31" }), "1999-01-01")).toBe(true);
  });
});

describe("the ladder, rung by rung", () => {
  it("1 — the roster wins outright, without consulting any link", () => {
    const r = resolveAttribution("rostered", [], ctx());
    expect(r).toEqual({ project_id: "rostered", source: "roster", ambiguous: false });
  });

  it("1 — the roster beats a person link that says otherwise", () => {
    const links = [link({ project_id: "byPerson", employee_id: "e1" })];
    expect(resolveAttribution("rostered", links, ctx()).project_id).toBe("rostered");
  });

  it("2 — a person link beats shift and site", () => {
    const links = [
      link({ project_id: "byPerson", employee_id: "e1" }),
      link({ project_id: "byShift", shift_id: "sh1" }),
      link({ project_id: "bySite", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBe("byPerson");
    expect(r.source).toBe("employee");
  });

  it("3 — a shift link beats site", () => {
    const links = [
      link({ project_id: "byShift", shift_id: "sh1" }),
      link({ project_id: "bySite", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBe("byShift");
    expect(r.source).toBe("shift");
  });

  it("4 — the site is the quiet default when nothing else applies", () => {
    const links = [link({ project_id: "bySite", site_id: "s1" })];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBe("bySite");
    expect(r.source).toBe("site");
  });

  it("5 — nothing linked means unassigned", () => {
    expect(resolveAttribution(null, [], ctx())).toEqual({ project_id: null, source: "none", ambiguous: false });
  });

  it("ignores links belonging to a different person, shift or site", () => {
    const links = [
      link({ project_id: "other", employee_id: "someone-else" }),
      link({ project_id: "other2", shift_id: "another-shift" }),
      link({ project_id: "other3", site_id: "another-site" }),
    ];
    expect(resolveAttribution(null, links, ctx()).project_id).toBeNull();
  });
});

describe("ambiguity is never guessed", () => {
  it("two projects at one site resolves to unassigned", () => {
    const links = [
      link({ project_id: "a", site_id: "s1" }),
      link({ project_id: "b", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.source).toBe("site");
  });

  it("two projects on one person resolves to unassigned", () => {
    const links = [
      link({ project_id: "a", employee_id: "e1" }),
      link({ project_id: "b", employee_id: "e1" }),
    ];
    expect(resolveAttribution(null, links, ctx()).ambiguous).toBe(true);
  });

  // The specific signal named several jobs. Answering with a vaguer one would
  // contradict it, so resolution stops rather than falling through.
  it("an ambiguous person link does NOT fall through to an unambiguous site", () => {
    const links = [
      link({ project_id: "a", employee_id: "e1" }),
      link({ project_id: "b", employee_id: "e1" }),
      link({ project_id: "clear", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBeNull();
    expect(r.source).toBe("employee");
  });

  it("the SAME project reached twice is one answer, not ambiguity", () => {
    const links = [
      link({ project_id: "p1", employee_id: "e1" }),
      link({ project_id: "p1", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBe("p1");
    expect(r.ambiguous).toBe(false);
  });
});

describe("only a live project collects", () => {
  it.each(["completed", "cancelled", "on_hold", "planned"])(
    "does not attribute to a %s project",
    (status) => {
      const links = [link({ site_id: "s1", project_status: status })];
      expect(resolveAttribution(null, links, ctx()).project_id).toBeNull();
    }
  );

  it("picks the one active project when a closed one shares the site", () => {
    const links = [
      link({ project_id: "done", site_id: "s1", project_status: "completed" }),
      link({ project_id: "live", site_id: "s1" }),
    ];
    expect(resolveAttribution(null, links, ctx()).project_id).toBe("live");
  });

  it("does not collect before the project starts", () => {
    const links = [link({ site_id: "s1", project_start: "2026-10-01" })];
    expect(resolveAttribution(null, links, ctx()).project_id).toBeNull();
  });

  it("does not collect after the project ends", () => {
    const links = [link({ site_id: "s1", project_end: "2026-08-31" })];
    expect(resolveAttribution(null, links, ctx()).project_id).toBeNull();
  });

  it("collects inside the window", () => {
    const links = [link({ site_id: "s1", project_start: "2026-09-01", project_end: "2026-09-30" })];
    expect(resolveAttribution(null, links, ctx()).project_id).toBe("p1");
  });

  // A finished job must not make an otherwise-clear site look ambiguous.
  it("an out-of-window project does not create false ambiguity", () => {
    const links = [
      link({ project_id: "old", site_id: "s1", project_end: "2026-08-31" }),
      link({ project_id: "live", site_id: "s1" }),
    ];
    const r = resolveAttribution(null, links, ctx());
    expect(r.project_id).toBe("live");
    expect(r.ambiguous).toBe(false);
  });
});

describe("missing context", () => {
  it("skips the shift rung when the employee has no shift", () => {
    const links = [
      link({ project_id: "byShift", shift_id: "sh1" }),
      link({ project_id: "bySite", site_id: "s1" }),
    ];
    expect(resolveAttribution(null, links, ctx({ shiftId: null })).project_id).toBe("bySite");
  });

  it("skips the site rung when the punch matched no site", () => {
    const links = [link({ project_id: "bySite", site_id: "s1" })];
    expect(resolveAttribution(null, links, ctx({ siteId: null })).project_id).toBeNull();
  });
});

describe("resolveProjectId", () => {
  it("returns just the id for the punch routes", () => {
    expect(resolveProjectId(null, [link({ site_id: "s1" })], ctx())).toBe("p1");
    expect(resolveProjectId(null, [], ctx())).toBeNull();
  });
});
