import { describe, it, expect } from "vitest";
import {
  linkCoversDate,
  pickSiteDefaultProject,
  resolveProject,
  type SiteProjectLink,
} from "./projectAttribution";

const link = (over: Partial<SiteProjectLink> = {}): SiteProjectLink => ({
  project_id: "p1",
  site_id: "s1",
  from_date: "2026-09-01",
  to_date: null,
  project_status: "active",
  ...over,
});

describe("linkCoversDate", () => {
  it("is inclusive at both ends", () => {
    const l = link({ from_date: "2026-09-01", to_date: "2026-09-30" });
    expect(linkCoversDate(l, "2026-09-01")).toBe(true);
    expect(linkCoversDate(l, "2026-09-30")).toBe(true);
  });

  it("excludes dates outside the range", () => {
    const l = link({ from_date: "2026-09-01", to_date: "2026-09-30" });
    expect(linkCoversDate(l, "2026-08-31")).toBe(false);
    expect(linkCoversDate(l, "2026-10-01")).toBe(false);
  });

  it("treats a null to_date as open-ended", () => {
    expect(linkCoversDate(link({ to_date: null }), "2099-01-01")).toBe(true);
  });
});

describe("pickSiteDefaultProject", () => {
  it("attributes a site with exactly one active project", () => {
    expect(pickSiteDefaultProject([link()], "s1", "2026-09-03")).toBe("p1");
  });

  it("returns null when two different projects are active at the site", () => {
    const links = [link({ project_id: "p1" }), link({ project_id: "p2" })];
    expect(pickSiteDefaultProject(links, "s1", "2026-09-03")).toBeNull();
  });

  it("still attributes when the SAME project is linked twice (re-mobilisation)", () => {
    const links = [
      link({ from_date: "2026-01-01", to_date: "2026-03-31" }),
      link({ from_date: "2026-09-01", to_date: null }),
    ];
    expect(pickSiteDefaultProject(links, "s1", "2026-09-03")).toBe("p1");
  });

  it("ignores links belonging to a different site", () => {
    expect(pickSiteDefaultProject([link({ site_id: "other" })], "s1", "2026-09-03")).toBeNull();
  });

  it("ignores a project whose link has expired", () => {
    const l = link({ from_date: "2026-01-01", to_date: "2026-06-30" });
    expect(pickSiteDefaultProject([l], "s1", "2026-09-03")).toBeNull();
  });

  // A finished project must stop absorbing hours the day it finishes, with
  // nobody having to remember to unlink the site.
  it.each(["completed", "cancelled", "on_hold", "planned"])(
    "does not auto-attribute a %s project",
    (status) => {
      expect(pickSiteDefaultProject([link({ project_status: status })], "s1", "2026-09-03")).toBeNull();
    }
  );

  it("picks the one active project when an inactive one shares the site", () => {
    const links = [
      link({ project_id: "done", project_status: "completed" }),
      link({ project_id: "live", project_status: "active" }),
    ];
    expect(pickSiteDefaultProject(links, "s1", "2026-09-03")).toBe("live");
  });
});

describe("resolveProject", () => {
  it("prefers the roster assignment over the site default", () => {
    expect(resolveProject("rostered", [link()], "s1", "2026-09-03")).toBe("rostered");
  });

  it("falls back to the site default when the roster says nothing", () => {
    expect(resolveProject(null, [link()], "s1", "2026-09-03")).toBe("p1");
  });

  it("returns unassigned when there is no roster row and no site", () => {
    expect(resolveProject(null, [link()], null, "2026-09-03")).toBeNull();
  });

  it("returns unassigned rather than guessing between two site projects", () => {
    const links = [link({ project_id: "p1" }), link({ project_id: "p2" })];
    expect(resolveProject(null, links, "s1", "2026-09-03")).toBeNull();
  });

  // The roster is the supervisor's explicit instruction: it wins even where
  // the site default would have produced a different, unambiguous answer.
  it("honours a roster project that contradicts the site default", () => {
    expect(resolveProject("elsewhere", [link({ project_id: "p1" })], "s1", "2026-09-03")).toBe("elsewhere");
  });
});
