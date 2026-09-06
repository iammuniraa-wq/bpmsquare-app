import { describe, it, expect } from "vitest";
import { selectedLines, documentTotal, normalizeSelection, type SelectableLine } from "./lineTotals";

type L = SelectableLine & { id: string };

describe("lineTotals: plain lines", () => {
  it("counts every line by default", () => {
    const lines: L[] = [{ id: "1", amount: 100 }, { id: "2", amount: 50 }];
    expect(documentTotal(lines)).toBe(150);
  });

  it("excludes a line explicitly deselected", () => {
    const lines: L[] = [{ id: "1", amount: 100 }, { id: "2", amount: 50, is_selected: false }];
    expect(documentTotal(lines)).toBe(100);
  });

  it("additive group lines behave like plain lines: excluded only if explicitly deselected", () => {
    const lines: L[] = [
      { id: "1", amount: 100, group_id: "g1", group_type: "additive" },
      { id: "2", amount: 50, group_id: "g1", group_type: "additive", is_selected: false },
    ];
    // "additive" (unlike "alternative") is just a visual grouping heading --
    // it carries no group-level selection decision, so each line is judged
    // on its own is_selected exactly like an ungrouped line.
    expect(documentTotal(lines)).toBe(100);
  });
});

describe("lineTotals: alternative groups", () => {
  const optionA: L = { id: "a1", amount: 1000, group_id: "optA", group_type: "alternative" };
  const optionB: L = { id: "b1", amount: 2000, group_id: "optB", group_type: "alternative" };
  const plain: L = { id: "p1", amount: 500 };

  it("defaults to the first group when nothing is selected (per-line convention)", () => {
    const total = documentTotal([plain, optionA, optionB]);
    expect(total).toBe(500 + 1000); // optA is first
  });

  it("Standard Quotes convention: is_selected on the group's own lines picks the group", () => {
    const total = documentTotal([plain, optionA, { ...optionB, is_selected: true }]);
    expect(total).toBe(500 + 2000);
  });

  it("Quotations convention: selectedOptionId header column picks the group", () => {
    const total = documentTotal([plain, optionA, optionB], { selectedOptionId: "optB" });
    expect(total).toBe(500 + 2000);
  });

  it("Quotations convention falls back to the first group for a stale/unknown id", () => {
    const total = documentTotal([plain, optionA, optionB], { selectedOptionId: "does-not-exist" });
    expect(total).toBe(500 + 1000);
  });

  it("a group with multiple lines totals all of them together", () => {
    const lines: L[] = [
      { id: "a1", amount: 1000, group_id: "optA", group_type: "alternative", is_selected: true },
      { id: "a2", amount: 200, group_id: "optA", group_type: "alternative", is_selected: true },
      { id: "b1", amount: 2000, group_id: "optB", group_type: "alternative" },
    ];
    expect(documentTotal(lines)).toBe(1200);
  });
});

describe("lineTotals: quantity breaks", () => {
  const base: L = { id: "base", amount: 22365 };
  const break10: L = { id: "b10", amount: 21200, break_of: "base", break_qty: 10 };
  const break50: L = { id: "b50", amount: 20100, break_of: "base", break_qty: 50 };

  it("defaults to the base line when no break is selected", () => {
    expect(documentTotal([base, break10, break50])).toBe(22365);
  });

  it("selects the chosen break instead of the base line", () => {
    expect(documentTotal([base, break10, { ...break50, is_selected: true }])).toBe(20100);
  });

  it("selectedLines returns exactly one row from the family", () => {
    const result = selectedLines([base, { ...break10, is_selected: true }, break50]);
    expect(result.map((l) => l.id)).toEqual(["b10"]);
  });

  it("a break family alongside an unrelated plain line only resolves the family", () => {
    const plain: L = { id: "other", amount: 999 };
    expect(documentTotal([base, break10, plain])).toBe(22365 + 999);
  });
});

describe("normalizeSelection", () => {
  it("picks exactly one alternative group member and clears the rest", () => {
    const lines: L[] = [
      { id: "a1", amount: 1000, group_id: "optA", group_type: "alternative", is_selected: true },
      { id: "b1", amount: 2000, group_id: "optB", group_type: "alternative", is_selected: true },
    ];
    const normalized = normalizeSelection(lines);
    const selected = normalized.filter((l) => l.is_selected);
    expect(selected.map((l) => l.group_id)).toEqual(["optA"]); // first group wins on ambiguity
  });

  it("defaults an alternative group to its first member when none is selected", () => {
    const lines: L[] = [
      { id: "a1", amount: 1000, group_id: "optA", group_type: "alternative" },
      { id: "a2", amount: 200, group_id: "optA", group_type: "alternative" },
    ];
    const normalized = normalizeSelection(lines);
    expect(normalized.find((l) => l.id === "a1")!.is_selected).toBe(true);
    expect(normalized.find((l) => l.id === "a2")!.is_selected).toBe(true); // same group, both selected
  });

  it("resolves a break family to exactly one selected row, base line included", () => {
    const lines: L[] = [
      { id: "base", amount: 22365 },
      { id: "b10", amount: 21200, break_of: "base" },
      { id: "b50", amount: 20100, break_of: "base", is_selected: true },
    ];
    const normalized = normalizeSelection(lines);
    expect(normalized.find((l) => l.id === "base")!.is_selected).toBe(false);
    expect(normalized.find((l) => l.id === "b10")!.is_selected).toBe(false);
    expect(normalized.find((l) => l.id === "b50")!.is_selected).toBe(true);
  });

  it("defaults a break family to the base line when nothing is explicitly selected", () => {
    const lines: L[] = [
      { id: "base", amount: 22365 },
      { id: "b10", amount: 21200, break_of: "base" },
    ];
    const normalized = normalizeSelection(lines);
    expect(normalized.find((l) => l.id === "base")!.is_selected).toBe(true);
    expect(normalized.find((l) => l.id === "b10")!.is_selected).toBe(false);
  });

  it("leaves an ordinary line untouched", () => {
    const lines: L[] = [{ id: "1", amount: 100 }];
    expect(normalizeSelection(lines)).toEqual(lines);
  });

  it("output is stable input to documentTotal", () => {
    const lines: L[] = [
      { id: "base", amount: 22365 },
      { id: "b10", amount: 21200, break_of: "base", is_selected: true },
      { id: "a1", amount: 1000, group_id: "optA", group_type: "alternative" },
      { id: "b1", amount: 2000, group_id: "optB", group_type: "alternative" },
    ];
    const normalized = normalizeSelection(lines);
    expect(documentTotal(normalized)).toBe(21200 + 1000);
  });
});
