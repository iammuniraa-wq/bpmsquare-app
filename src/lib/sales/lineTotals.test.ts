import { describe, it, expect } from "vitest";
import { selectedLines, documentTotal, normalizeSelection, isOfferedBreak, type SelectableLine } from "./lineTotals";

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

describe("lineTotals: quantity breaks (offers, never charged -- 2026-09-06)", () => {
  const base: L = { id: "base", amount: 22365 };
  const break10: L = { id: "b10", amount: 21200, break_of: "base", break_qty: 10 };
  const break50: L = { id: "b50", amount: 20100, break_of: "base", break_qty: 50 };

  it("totals the base line only, whatever the breaks say", () => {
    expect(documentTotal([base, break10, break50])).toBe(22365);
    expect(documentTotal([base, break10, { ...break50, is_selected: true }])).toBe(22365);
    expect(selectedLines([base, { ...break10, is_selected: true }, break50]).map((l) => l.id)).toEqual(["base"]);
  });

  it("a base line with breaks counts even if its own flag was left false by the old chosen-break model", () => {
    expect(documentTotal([{ ...base, is_selected: false }, { ...break10, is_selected: true }])).toBe(22365);
  });

  it("a break family alongside an unrelated plain line", () => {
    const plain: L = { id: "other", amount: 999 };
    expect(documentTotal([base, break10, plain])).toBe(22365 + 999);
  });

  it("isOfferedBreak reads the break's own flag, absent meaning offered", () => {
    expect(isOfferedBreak(break10)).toBe(true);
    expect(isOfferedBreak({ ...break10, is_selected: false })).toBe(false);
    expect(isOfferedBreak(base)).toBe(false);
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

  it("keeps a break's offered flag and forces the base line on", () => {
    const lines: L[] = [
      { id: "base", amount: 22365, is_selected: false },
      { id: "b10", amount: 21200, break_of: "base" },
      { id: "b50", amount: 20100, break_of: "base", is_selected: false },
    ];
    const normalized = normalizeSelection(lines);
    expect(normalized.map((l) => [l.id, l.is_selected])).toEqual([["base", true], ["b10", true], ["b50", false]]);
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
    expect(documentTotal(normalized)).toBe(22365 + 1000);
  });
});

describe("lineTotals: quantity breaks inside an alternative option (0118)", () => {
  const lines: L[] = [
    { id: "a", amount: 1000, group_id: "optA", group_type: "alternative", is_selected: true },
    { id: "a10", amount: 9000, group_id: "optA", group_type: "alternative", break_of: "a", is_selected: true },
    { id: "b", amount: 2000, group_id: "optB", group_type: "alternative", is_selected: false },
    { id: "b10", amount: 18000, group_id: "optB", group_type: "alternative", break_of: "b", is_selected: true },
  ];

  it("counts only the chosen option's base line", () => {
    expect(selectedLines(lines).map((l) => l.id)).toEqual(["a"]);
    expect(documentTotal(lines)).toBe(1000);
  });

  it("normalizeSelection marks the unchosen option false but leaves every break's offered flag alone", () => {
    const out = normalizeSelection(lines);
    expect(out.map((l) => [l.id, l.is_selected])).toEqual([["a", true], ["a10", true], ["b", false], ["b10", true]]);
  });

  it("switching the option switches which base line is charged", () => {
    const switched: L[] = lines.map((l) => (l.break_of ? l : { ...l, is_selected: l.group_id === "optB" }));
    expect(selectedLines(switched).map((l) => l.id)).toEqual(["b"]);
  });
});
