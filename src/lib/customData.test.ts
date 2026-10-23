import { describe, expect, it } from "vitest";
import { cfOnly, mergeCfValues } from "./customData";

describe("cfOnly", () => {
  it("keeps only tenant-defined cf_ keys", () => {
    expect(cfOnly({ cf_region: "North", tenant_id: "x", notes: "y", cf_x: 1 })).toEqual({ cf_region: "North", cf_x: 1 });
  });

  it("returns undefined for anything that is not a plain object", () => {
    for (const bad of [undefined, null, "cf_a", 3, ["cf_a"]]) expect(cfOnly(bad)).toBeUndefined();
  });

  it("an object with no cf_ keys is an empty set, not 'nothing sent'", () => {
    expect(cfOnly({ a: 1 })).toEqual({});
  });
});

describe("mergeCfValues", () => {
  it("merges file values over the stored ones and keeps the rest", () => {
    expect(mergeCfValues({ cf_a: "old", cf_b: "keep" }, { id: "1", cf_a: " new ", name: "ignored" })).toEqual({ cf_a: "new", cf_b: "keep" });
  });

  it("a blank cell never clears a stored value", () => {
    expect(mergeCfValues({ cf_a: "old" }, { cf_a: "   " })).toBeNull();
  });

  it("starts from nothing when the record has no custom data yet", () => {
    expect(mergeCfValues(null, { cf_a: "1" })).toEqual({ cf_a: "1" });
    expect(mergeCfValues(undefined, { cf_a: "1" })).toEqual({ cf_a: "1" });
  });
});
