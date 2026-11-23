import { describe, expect, it } from "vitest";
import { compareElements, modelQtyByCode, summaryText, type CompareEl } from "./compare";

const el = (o: Partial<CompareEl>): CompareEl => ({ model_uid: null, element_code: null, element_type: "Wall panel", building: "B1", level: "L1", qty: 1, unit: null, volume_m3: 2, area_m2: null, length_m: null, weight_t: 5, ...o });

describe("comparing two revisions", () => {
  it("added, removed, changed and unchanged, matched by element code", () => {
    const from = [el({ element_code: "WP-001" }), el({ element_code: "WP-002", volume_m3: 3 }), el({ element_code: "WP-003" })];
    const to = [el({ element_code: "WP-001" }), el({ element_code: "WP-002", volume_m3: 3.5 }), el({ element_code: "WP-004" })];
    const c = compareElements(from, to);
    expect(c.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1, notMatched: 0 });
    const changed = c.rows.find((r) => r.kind === "changed");
    expect(changed).toMatchObject({ kind: "changed", changes: [{ field: "volume_m3", from: 3, to: 3.5 }] });
    expect(c.rows.find((r) => r.kind === "added")).toMatchObject({ key: "code:WP-004" });
    expect(c.rows.find((r) => r.kind === "removed")).toMatchObject({ key: "code:WP-003" });
  });

  it("matches by model id first: a renamed code is a change, not an add and a remove", () => {
    const c = compareElements([el({ model_uid: "g1", element_code: "WP-001" })], [el({ model_uid: "g1", element_code: "WP-001A" })]);
    expect(c.counts).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });

  it("never guesses: two different model ids with the same code are two elements", () => {
    const c = compareElements([el({ model_uid: "g1", element_code: "WP-001" })], [el({ model_uid: "g2", element_code: "WP-001" })]);
    expect(c.counts).toMatchObject({ added: 1, removed: 1, changed: 0, unchanged: 0 });
  });

  it("elements with neither an id nor a code are listed as not matched, on either side", () => {
    const c = compareElements([el({}), el({ element_code: "A" })], [el({}), el({ element_code: "A" })]);
    expect(c.counts.notMatched).toBe(2);
    expect(c.notMatched.map((n) => n.side).sort()).toEqual(["from", "to"]);
    expect(c.counts.unchanged).toBe(1);
  });

  it("a repeated code is taken once each, in order", () => {
    const c = compareElements([el({ element_code: "S", qty: 1 }), el({ element_code: "S", qty: 2 })], [el({ element_code: "S", qty: 1 }), el({ element_code: "S", qty: 2 }), el({ element_code: "S", qty: 3 })]);
    expect(c.counts).toMatchObject({ added: 1, unchanged: 2 });
  });

  it("tiny numeric noise is not a change, a real one is, and null to a number is", () => {
    expect(compareElements([el({ element_code: "A", volume_m3: 1 })], [el({ element_code: "A", volume_m3: 1.0000000001 })]).counts.changed).toBe(0);
    expect(compareElements([el({ element_code: "A", volume_m3: 1 })], [el({ element_code: "A", volume_m3: 1.01 })]).counts.changed).toBe(1);
    expect(compareElements([el({ element_code: "A", area_m2: null })], [el({ element_code: "A", area_m2: 4 })]).counts.changed).toBe(1);
    expect(compareElements([el({ element_code: "A", level: "" })], [el({ element_code: "A", level: null })]).counts.changed).toBe(0);
  });

  it("totals by building and type use pieces times the per-piece figure", () => {
    const c = compareElements(
      [el({ element_code: "A", qty: 10, volume_m3: 2, weight_t: 5 })],
      [el({ element_code: "A", qty: 12, volume_m3: 2, weight_t: 5 }), el({ element_code: "B", qty: 1, building: "B2", element_type: "Slab", volume_m3: 10, weight_t: 25 })],
    );
    expect(c.totals).toEqual({ count_from: 10, count_to: 13, volume_from: 20, volume_to: 34, weight_from: 50, weight_to: 85 });
    const b1 = c.groups.find((g) => g.building === "B1")!;
    expect(b1).toMatchObject({ count_from: 10, count_to: 12, volume_from: 20, volume_to: 24 });
    expect(c.groups.map((g) => g.building)).toEqual(["B1", "B2"]);
  });

  it("the summary reads in words", () => {
    expect(summaryText({ added: 3, removed: 1, changed: 2 })).toBe("3 added, 1 removed, 2 changed");
    expect(summaryText({ added: 0, removed: 0, changed: 0 })).toBe("no change");
    expect(summaryText(null)).toBe("");
  });

  it("the model quantity of a code is the pieces added up", () => {
    const m = modelQtyByCode([{ element_code: "A", qty: 2 }, { element_code: "A", qty: 3 }, { element_code: "B", qty: 1 }, { element_code: null, qty: 9 }]);
    expect(m.get("A")).toBe(5);
    expect(m.get("B")).toBe(1);
    expect(m.size).toBe(2);
  });
});
