import { describe, expect, it } from "vitest";
import { NAV, ROUTES } from "@/lib/constants";
import { Gear } from "@/components/Icons";
import { NAV_GLYPHS, GROUP_ICON } from "@/components/navGlyphs";

// Leaves are what Spaces, the Nova rail and the mobile tab bar draw. A bundled
// parent (Sales, Service, ...) reuses its first child's href by design, so it
// is checked for an entry but not for distinctness against that child.
function leavesOf(group: (typeof NAV)[number]) {
  return group.items.flatMap((item) => (item.children?.length ? item.children : [item]));
}

describe("nav glyphs", () => {
  it("gives every NAV destination (items and children) a glyph", () => {
    const missing: string[] = [];
    for (const group of NAV) {
      for (const item of group.items) {
        for (const n of [item, ...(item.children ?? [])]) {
          if (!NAV_GLYPHS[n.href]) missing.push(`${group.group} / ${n.label} (${n.href})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("never lets two destinations in one NAV group share a glyph", () => {
    const clashes: string[] = [];
    for (const group of NAV) {
      const seen = new Map<unknown, string>();
      for (const leaf of leavesOf(group)) {
        const icon = NAV_GLYPHS[leaf.href];
        const other = seen.get(icon);
        if (other) clashes.push(`${group.group}: ${other} and ${leaf.label}`);
        else seen.set(icon, leaf.label);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("reserves Gear for Settings", () => {
    const gears = Object.entries(NAV_GLYPHS).filter(([, icon]) => icon === Gear).map(([href]) => href);
    expect(gears).toEqual([ROUTES.settings]);
    for (const icon of Object.values(GROUP_ICON)) expect(icon).not.toBe(Gear);
  });

  it("gives every space tile its own glyph, different from the destinations in its group", () => {
    const tiles = NAV.map((g) => GROUP_ICON[g.group]);
    expect(tiles.every(Boolean)).toBe(true);
    expect(new Set(tiles).size).toBe(tiles.length);
    for (const group of NAV) {
      const tile = GROUP_ICON[group.group];
      const clash = leavesOf(group).find((leaf) => NAV_GLYPHS[leaf.href] === tile);
      expect(clash?.label, `${group.group} tile repeats a destination glyph`).toBeUndefined();
    }
  });
});
