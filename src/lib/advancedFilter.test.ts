import { describe, it, expect } from "vitest";
import { parseConds, encodeConds, matchesConds, flattenForFilter, applyAdvancedFilter, type FilterCond } from "./advancedFilter";

describe("parseConds", () => {
  it("round-trips through encodeConds", () => {
    const conds: FilterCond[] = [
      { field: "name", op: "contains", t: "text", value: "pump" },
      { field: "total", op: "between", t: "number", value: "100", value2: "500" },
    ];
    expect(parseConds(encodeConds(conds))).toEqual(conds);
  });

  it("returns [] for garbage, non-arrays and missing input", () => {
    expect(parseConds(undefined)).toEqual([]);
    expect(parseConds("not json")).toEqual([]);
    expect(parseConds('{"field":"x"}')).toEqual([]);
  });

  it("drops malformed entries and unknown ops, defaults bad types to text", () => {
    const raw = JSON.stringify([
      { field: "ok", op: "eq", t: "weird", value: "1" },
      { field: "bad", op: "hack" },
      { op: "eq", t: "text" },
      "junk",
    ]);
    const out = parseConds(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "ok", op: "eq", t: "text" });
  });

  it("caps the condition count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ field: `f${i}`, op: "eq", t: "text", value: "x" }));
    expect(parseConds(JSON.stringify(many)).length).toBeLessThanOrEqual(20);
  });
});

describe("matchesConds", () => {
  const rec = { name: "Vikas Pumps", total: 250, status: "active", created_at: "2026-08-01T10:00:00Z", vip: true, notes: null };

  it("text ops are case-insensitive", () => {
    expect(matchesConds(rec, [{ field: "name", op: "contains", t: "text", value: "PUMP" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "name", op: "starts", t: "text", value: "vik" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "name", op: "ncontains", t: "text", value: "motor" }])).toBe(true);
  });

  it("number comparisons including between", () => {
    expect(matchesConds(rec, [{ field: "total", op: "gte", t: "number", value: "250" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "total", op: "between", t: "number", value: "100", value2: "300" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "total", op: "lt", t: "number", value: "250" }])).toBe(false);
  });

  it("date compares on the ISO day prefix of a timestamp", () => {
    expect(matchesConds(rec, [{ field: "created_at", op: "eq", t: "date", value: "2026-08-01" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "created_at", op: "gte", t: "date", value: "2026-08-01" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "created_at", op: "lte", t: "date", value: "2026-07-31" }])).toBe(false);
  });

  it("empty/nempty treat null, undefined and '' as empty", () => {
    expect(matchesConds(rec, [{ field: "notes", op: "empty", t: "text" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "missing", op: "empty", t: "text" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "name", op: "nempty", t: "text" }])).toBe(true);
  });

  it("checkbox matches booleans", () => {
    expect(matchesConds(rec, [{ field: "vip", op: "eq", t: "checkbox", value: "true" }])).toBe(true);
    expect(matchesConds(rec, [{ field: "vip", op: "eq", t: "checkbox", value: "false" }])).toBe(false);
  });

  it("an incomplete condition (no value) is a no-op, and conditions AND together", () => {
    expect(matchesConds(rec, [{ field: "name", op: "contains", t: "text", value: "" }])).toBe(true);
    expect(matchesConds(rec, [
      { field: "name", op: "contains", t: "text", value: "pump" },
      { field: "status", op: "eq", t: "select", value: "inactive" },
    ])).toBe(false);
  });
});

describe("flattenForFilter / applyAdvancedFilter", () => {
  it("lifts custom_data keys, standard columns win collisions", () => {
    const flat = flattenForFilter({ name: "A", custom_data: { grade: "B", name: "shadow" } });
    expect(flat.grade).toBe("B");
    expect(flat.name).toBe("A");
  });

  it("filters rows via the raw af param and passes rows through on bad input", () => {
    const rows = [{ item: { name: "Bearing", qty: 5 } }, { item: { name: "Shaft", qty: 0 } }];
    const af = encodeConds([{ field: "qty", op: "gt", t: "number", value: "0" }]);
    expect(applyAdvancedFilter(rows, af, (r) => r.item)).toHaveLength(1);
    expect(applyAdvancedFilter(rows, "garbage", (r) => r.item)).toHaveLength(2);
  });
});
