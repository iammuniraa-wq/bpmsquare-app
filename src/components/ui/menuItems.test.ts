import { describe, expect, it } from "vitest";
import { normalizeMenuItems, type MenuItem } from "./menuItems";

const labels = (items: MenuItem[]) => items.map((i) => (i.divider ? "|" : i.label));

describe("normalizeMenuItems", () => {
  it("drops hidden items", () => {
    expect(labels(normalizeMenuItems([
      { label: "Edit" }, { label: "Print", hidden: true }, { label: "Duplicate" },
    ]))).toEqual(["Edit", "Duplicate"]);
  });

  it("puts danger items last behind exactly one divider", () => {
    expect(labels(normalizeMenuItems([
      { label: "Delete", danger: true }, { label: "Edit" }, { label: "", divider: true }, { label: "Print" },
    ]))).toEqual(["Edit", "|", "Print", "|", "Delete"]);
  });

  it("adds no divider when there is only a danger item", () => {
    expect(labels(normalizeMenuItems([{ label: "Delete", danger: true }]))).toEqual(["Delete"]);
  });

  it("removes leading, trailing and doubled dividers", () => {
    expect(labels(normalizeMenuItems([
      { label: "", divider: true }, { label: "Edit" }, { label: "", divider: true },
      { label: "", divider: true }, { label: "Print", hidden: true }, { label: "", divider: true },
    ]))).toEqual(["Edit"]);
  });

  it("returns nothing when every item is hidden", () => {
    expect(normalizeMenuItems([{ label: "Edit", hidden: true }, { label: "Delete", danger: true, hidden: true }])).toEqual([]);
  });
});
