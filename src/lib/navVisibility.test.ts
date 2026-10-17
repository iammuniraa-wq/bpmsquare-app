import { describe, expect, it } from "vitest";
import { NAV, type NavItem } from "./constants";
import { isNavItemHidden, navState, toggleNavItem } from "./navVisibility";

const parent = (label: string): NavItem => {
  const p = NAV.flatMap((g) => g.items).find((i) => i.label === label && i.children?.length);
  if (!p) throw new Error(`no nav parent ${label}`);
  return p;
};
const kids = (p: NavItem) => p.children!.map((c) => c.href);

describe.each(["Sales", "Marketing", "Workforce", "Service", "Master data"])("%s parent", (label) => {
  const p = parent(label);

  it("shares its href with its first child (the bug this logic exists for)", () => {
    expect(p.href).toBe(p.children![0].href);
  });

  it("switching the parent off hides every child, and on shows them all again", () => {
    const off = toggleNavItem([], p);
    expect(navState(off, p)).toBe("off");
    for (const k of kids(p)) expect(off).toContain(k);
    expect(isNavItemHidden(off, p)).toBe(true);
    const on = toggleNavItem(off, p);
    expect(on).toEqual([]);
    expect(navState(on, p)).toBe("on");
  });

  it("hiding only the first child leaves the group visible, as mixed", () => {
    const hidden = toggleNavItem([], p.children![0]);
    expect(hidden).toEqual([p.children![0].href]);
    expect(navState(hidden, p)).toBe("mixed");
    expect(isNavItemHidden(hidden, p)).toBe(false);
  });

  it("hiding the last visible child turns the parent off", () => {
    let hidden: string[] = [];
    for (const c of p.children!) hidden = toggleNavItem(hidden, c);
    expect(navState(hidden, p)).toBe("off");
  });

  it("a mixed parent switches off on the next click", () => {
    const mixed = toggleNavItem([], p.children![0]);
    const off = toggleNavItem(mixed, p);
    expect(navState(off, p)).toBe("off");
  });
});

describe("eligible children", () => {
  const sales = parent("Sales");
  const hasRfq = (c: { featureKey?: string }) => c.featureKey !== "rfq";

  it("judges the group by the children this workspace has, but hides all of them", () => {
    const off = toggleNavItem([], sales, hasRfq);
    expect(off).toContain(sales.children!.find((c) => c.featureKey === "rfq")!.href);
    const withoutRfqHidden = off.filter((h) => h !== sales.children!.find((c) => c.featureKey === "rfq")!.href);
    expect(navState(withoutRfqHidden, sales, hasRfq)).toBe("off");
  });

  it("leaves other hidden entries alone", () => {
    const off = toggleNavItem(["/somewhere-else"], sales);
    expect(off).toContain("/somewhere-else");
    expect(toggleNavItem(off, sales)).toEqual(["/somewhere-else"]);
  });
});

describe("leaf rows", () => {
  const leaf = NAV[0].items[0];
  it("toggle their own href", () => {
    expect(toggleNavItem([], leaf)).toEqual([leaf.href]);
    expect(toggleNavItem([leaf.href], leaf)).toEqual([]);
    expect(navState([leaf.href], leaf)).toBe("off");
  });
});
