import { describe, expect, it } from "vitest";
import { parseBomLineInput } from "./bomInput";

describe("parseBomLineInput", () => {
  it("accepts a full valid line and normalises it", () => {
    expect(parseBomLineInput({ qty: "2.50005", uom: " m ", scrap_pct: "5", line_kind: "used", note: " cut to length " }, { requireQty: true })).toEqual({
      ok: true,
      fields: { qty: 2.5001, uom: "m", scrap_pct: 5, line_kind: "used", note: "cut to length" },
    });
  });
  it("requires a quantity above zero on create", () => {
    expect(parseBomLineInput({}, { requireQty: true })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ qty: 0 }, { requireQty: true })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ qty: -1 })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ qty: "abc" })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ qty: 1e12 })).toMatchObject({ ok: false });
  });
  it("only validates the fields that are present on an update", () => {
    expect(parseBomLineInput({ note: "x" })).toEqual({ ok: true, fields: { note: "x" } });
    expect(parseBomLineInput({})).toEqual({ ok: true, fields: {} });
  });
  it("keeps scrap between 0 and 100, treating blank as 0", () => {
    expect(parseBomLineInput({ scrap_pct: 101 })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ scrap_pct: -0.1 })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ scrap_pct: "" })).toEqual({ ok: true, fields: { scrap_pct: 0 } });
    expect(parseBomLineInput({ scrap_pct: 100 })).toEqual({ ok: true, fields: { scrap_pct: 100 } });
  });
  it("rejects an unknown kind, an over-long unit or note, and clears with null", () => {
    expect(parseBomLineInput({ line_kind: "tool" })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ uom: "x".repeat(21) })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ note: "x".repeat(501) })).toMatchObject({ ok: false });
    expect(parseBomLineInput({ uom: null, note: "" })).toEqual({ ok: true, fields: { uom: null, note: null } });
  });
  it("validates sort_order as a whole number", () => {
    expect(parseBomLineInput({ sort_order: 3 })).toEqual({ ok: true, fields: { sort_order: 3 } });
    expect(parseBomLineInput({ sort_order: 1.5 })).toMatchObject({ ok: false });
  });
});
