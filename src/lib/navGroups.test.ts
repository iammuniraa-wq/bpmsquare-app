import { describe, expect, it } from "vitest";
import { NAV, ROUTES } from "./constants";
import { NAV_GROUP_LABELS, buildNavGroups, isItemViewable } from "./navGroups";

const every = Object.fromEntries(
  NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]))
    .flatMap((i) => (i.featureKey ? [[i.featureKey, true]] : [])),
) as Record<string, boolean>;

describe("NAV groups", () => {
  it("are the eight groups of the navigation spec, in order", () => {
    expect(NAV.map((g) => g.group)).toEqual([
      "WORKSPACE", "SALES & PROCUREMENT", "SERVICE", "MARKETING", "MASTER DATA", "WORKFORCE", "INSIGHTS", "ADMIN",
    ]);
  });

  it("every group has a short label", () => {
    for (const g of NAV) expect(NAV_GROUP_LABELS[g.group]).toBeTruthy();
  });

  it("Insights holds Analytics and Pricing; Admin holds Data Workbench, Audit & Users, Settings", () => {
    const labels = (k: string) => NAV.find((g) => g.group === k)!.items.map((i) => i.label);
    expect(labels("INSIGHTS")).toEqual(["Analytics", "Pricing"]);
    expect(labels("ADMIN")).toEqual(["Data Workbench", "Audit & Users", "Settings"]);
  });

  it("lists Employees once under Master data; Workforce has 'Workforce employees' for supervisors", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => (i.children?.length ? i.children : [i]).map((l) => ({ ...l, group: g.group }))));
    expect(leaves.filter((l) => l.label === "Employees").map((l) => l.group)).toEqual(["MASTER DATA"]);
    const wf = leaves.find((l) => l.href === ROUTES.wfmEmployees)!;
    expect(wf.group).toBe("WORKFORCE");
    expect(wf.label).toBe("Workforce employees");
    expect(wf.supervisorOnly).toBe(true);
  });

  it("keeps Inventory under Master data", () => {
    const md = NAV.find((g) => g.group === "MASTER DATA")!.items[0].children!;
    expect(md.some((c) => c.href === ROUTES.inventory)).toBe(true);
  });

  it("never repeats a href", () => {
    const hrefs = buildNavGroups(every, "all", true).flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("buildNavGroups", () => {
  it("shows an unrestricted admin Settings, last in Admin", () => {
    const admin = buildNavGroups({ ...every, administration: true }, "all", false).find((g) => g.key === "ADMIN")!;
    expect(admin.items.at(-1)!.href).toBe(ROUTES.settings);
  });

  it("hides Settings from a member restricted to some workcenters", () => {
    const g = buildNavGroups(every, ["quotations", "administration"], false);
    expect(g.flatMap((x) => x.items).some((i) => i.href === ROUTES.settings)).toBe(false);
    expect(g.find((x) => x.key === "ADMIN")!.items.map((i) => i.href)).toEqual([ROUTES.administration]);
  });

  it("keeps featureKey gating: a module that is off never appears", () => {
    const g = buildNavGroups({ ...every, rfq: false }, "all", true);
    expect(g.flatMap((x) => x.items).some((i) => i.href === ROUTES.rfqs)).toBe(false);
  });

  it("keeps supervisor-only rows away from a plain employee", () => {
    const hrefs = buildNavGroups(every, "all", false).flatMap((x) => x.items.map((i) => i.href));
    expect(hrefs).toContain(ROUTES.wfmMe);
    expect(hrefs).not.toContain(ROUTES.wfmEmployees);
  });

  it("drops a group with nothing visible (a WFM-only tenant sees no Sales)", () => {
    const keys = buildNavGroups({ wfm: true }, "all", true).map((g) => g.key);
    expect(keys).toContain("WORKFORCE");
    expect(keys).not.toContain("SALES & PROCUREMENT");
    expect(keys).not.toContain("INSIGHTS");
  });
});

describe("isItemViewable adminOnly", () => {
  const settings = NAV.flatMap((g) => g.items).find((i) => i.href === ROUTES.settings)!;
  it("is true only for unrestricted access", () => {
    expect(isItemViewable(settings, "all")).toBe(true);
    expect(isItemViewable(settings, ["cases"])).toBe(false);
  });
});

describe("buildNavGroups with hidden hrefs", () => {
  it("leaves hidden leaves out and drops a group left empty", () => {
    const all = buildNavGroups(every, "all", true);
    const first = all.flatMap((g) => g.items.map((i) => i.href));
    const hidden = [first[1]];
    const after = buildNavGroups(every, "all", true, hidden).flatMap((g) => g.items.map((i) => i.href));
    expect(after).not.toContain(first[1]);
    expect(after.length).toBe(first.length - 1);
  });
  it("never hides Settings", () => {
    const hrefs = buildNavGroups({ ...every, administration: true }, "all", false, ["/settings"]).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/settings");
  });
});
