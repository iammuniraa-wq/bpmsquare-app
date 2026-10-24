import { describe, expect, it } from "vitest";
import { describeValue, fieldNotes, reviewCounts, reviewRows } from "./intakeReview";
import { CHAINLINK_FENCE_STARTER } from "@/lib/estimator/starterTemplates";
import { clampIntakeV2 } from "@/lib/estimator/aiIntake";

const inputs = CHAINLINK_FENCE_STARTER.inputs;
const email = "A 2.4 m high fence, about 600 m, high security mesh, around the yard.";
const missing = { status: "missing", value: null, source: null };
const proposal = clampIntakeV2(inputs, {
  name: "", sender: null, assumptions: [],
  values: Object.fromEntries(inputs.map((i) => [i.key, missing])),
}, email);
const read = clampIntakeV2(inputs, {
  name: "", sender: null, assumptions: [],
  values: {
    ...Object.fromEntries(inputs.map((i) => [i.key, missing])),
    total_length_m: { status: "found", value: 600, source: "about 600 m" },
    fabric_height_m: { status: "found", value: 2.4, source: "2.4 m high" },
    mesh: { status: "likely", value: "high_security", source: "high security mesh" },
    closed_perimeter: { status: "likely", value: true, source: "around the yard" },
  },
}, email);

describe("review rows", () => {
  it("has one row per input, missing first, then likely, then found", () => {
    const rows = reviewRows(inputs, read);
    expect(rows).toHaveLength(inputs.length);
    const order = rows.map((r) => r.status);
    expect(order).toEqual([...order].sort((a, b) => ({ missing: 0, likely: 1, found: 2 }[a] - { missing: 0, likely: 1, found: 2 }[b])));
    expect(rows.at(-1)!.status).toBe("found");
    expect(rows[0].status).toBe("missing");
  });

  it("shows what was read in the template's words, with the email's own words", () => {
    const rows = reviewRows(inputs, read);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.total_length_m).toMatchObject({ status: "found", statusLabel: "Found", value: "600 m", source: "about 600 m" });
    expect(by.fabric_height_m.value).toBe("2.4 m");
    expect(by.mesh).toMatchObject({ status: "likely", value: "High security 25x25, 3.0 mm" });
    expect(by.closed_perimeter.value).toBe("Yes");
  });

  it("a missing row has no value and no source, only the default as a placeholder", () => {
    const row = reviewRows(inputs, read).find((r) => r.key === "straining_spacing_m")!;
    expect(row).toMatchObject({ status: "missing", value: "", source: null, placeholder: "100 m" });
  });

  it("nothing read at all: everything is missing", () => {
    expect(reviewCounts(reviewRows(inputs, proposal))).toEqual({ found: 0, likely: 0, missing: inputs.length });
  });

  it("counts", () => {
    expect(reviewCounts(reviewRows(inputs, read))).toEqual({ found: 2, likely: 2, missing: inputs.length - 4 });
  });

  it("falls back to likely for a value without a verdict (the older reader)", () => {
    const rows = reviewRows(inputs, { values: { total_length_m: 600 } });
    expect(rows.find((r) => r.key === "total_length_m")!.status).toBe("likely");
  });

  it("describes values by type", () => {
    expect(describeValue(inputs[0], 1234.5678)).toBe("1,234.568 m");
    expect(describeValue(inputs[1], false)).toBe("No");
    expect(describeValue(inputs[2], undefined)).toBe("");
  });
});

describe("field notes", () => {
  it("marks missing and likely inputs on the form, never found ones", () => {
    const notes = fieldNotes(inputs, read);
    expect(notes.total_length_m).toBeUndefined();
    expect(notes.mesh).toContain("high security mesh");
    expect(notes.straining_spacing_m).toMatch(/did not say/);
    expect(notes.straining_spacing_m).toContain("100 m");
  });
});
