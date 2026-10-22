import { describe, expect, it } from "vitest";
import { applyConverter, reverseConverter, validateConverter, withDefault, type ListLookup } from "./convert";
import type { Converter, ValueList } from "./types";

const unitList: ValueList = {
  kind: "unit", label: "Unit", default_in: null, unknown_in: [],
  rows: [
    { bpm: "Nos", erp: "EA", inbound: true },
    { bpm: "Mtr", erp: "M", inbound: true },
    { bpm: "Metre", erp: "M", inbound: false },
    { bpm: "Box", erp: "", inbound: false },
  ],
};
const lists: ListLookup = (k) => (k === "unit" ? unitList : undefined);
const rec = { ref: "SQ-0012", title: "Fence", sub: "" } as Record<string, string>;
const ok = (conv: Converter, v: unknown, record: Record<string, string> = rec) => {
  const r = applyConverter(conv, v as never, { record, lists });
  if (!r.ok) throw new Error(r.problem.message);
  return r.value;
};

describe("value_list", () => {
  const c: Converter = { kind: "value_list", list: "unit" };
  it("maps a BPMSquare value to its ERP code", () => {
    expect(ok(c, "Mtr")).toBe("M");
    expect(ok(c, "  nos ")).toBe("EA");
  });
  it("a value with no row is the problem value_unmapped with the agreed wording", () => {
    const r = applyConverter(c, "Pail", { record: rec, lists, rowId: "r1", field: "uomcode" });
    expect(r).toMatchObject({ ok: false, problem: { code: "value_unmapped", list: "unit", value: "Pail", rowId: "r1", message: "Unit 'Pail' has no ERP code.", fix: "Add it in Mapping > Value mapping, then Restart." } });
  });
  it("a row whose code is still empty counts as unmapped", () => {
    expect(applyConverter(c, "Box", { record: rec, lists })).toMatchObject({ ok: false, problem: { code: "value_unmapped", value: "Box" } });
  });
  it("a list that does not exist is unmapped too, with a readable name", () => {
    const r = applyConverter({ kind: "value_list", list: "custom:site_type" }, "A", { record: rec, lists });
    expect(r).toMatchObject({ ok: false, problem: { message: "Site type 'A' has no ERP code." } });
  });
  it("an empty source is not a problem", () => {
    expect(ok(c, "")).toBeNull();
    expect(ok(c, null)).toBeNull();
  });
  it("reverses through the row marked inbound, else the first", () => {
    expect(reverseConverter(c, "M", lists)).toEqual({ value: "Mtr" });
    expect(reverseConverter(c, "m", lists)).toEqual({ value: "Mtr" });
    const noMark: ValueList = { ...unitList, rows: [{ bpm: "Metre", erp: "M", inbound: false }, { bpm: "Mtr", erp: "M", inbound: false }] };
    expect(reverseConverter(c, "M", () => noMark)).toEqual({ value: "Metre" });
  });
  it("an unknown inbound code is kept raw and reported; a default replaces it and is reported too", () => {
    expect(reverseConverter(c, "ZZ", lists)).toEqual({ value: "ZZ", unknown: { list: "unit", value: "ZZ" } });
    const withDefaultIn: ValueList = { ...unitList, default_in: "Nos" };
    expect(reverseConverter(c, "ZZ", () => withDefaultIn)).toEqual({ value: "Nos", unknown: { list: "unit", value: "ZZ" } });
  });
});

describe("constant", () => {
  it("ignores the source", () => {
    expect(ok({ kind: "constant", value: true }, "anything")).toBe(true);
    expect(ok({ kind: "constant", value: "ZZ" }, null)).toBe("ZZ");
    expect(ok({ kind: "constant", value: 7 }, undefined)).toBe(7);
  });
  it("is refused on an inbound row", () => {
    expect(validateConverter({ kind: "constant", value: "ZZ" }, "in")).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "constant", value: "ZZ" }, "out")).toMatchObject({ ok: true });
  });
});

describe("concat", () => {
  const parts = [{ field: "ref" }, { text: " · " }, { field: "title" }];
  it("joins fields and text", () => {
    expect(ok({ kind: "concat", parts }, null)).toBe("SQ-0012 · Fence");
  });
  it("an empty field is empty text, or the field and its separator vanish with skipEmpty", () => {
    const r = { ref: "SQ-0012", title: "" };
    expect(ok({ kind: "concat", parts }, null, r)).toBe("SQ-0012 · ");
    expect(ok({ kind: "concat", parts, skipEmpty: true }, null, r)).toBe("SQ-0012");
  });
  it("skipEmpty keeps the separators of the fields that are there", () => {
    const p = [{ field: "a" }, { text: " - " }, { field: "b" }, { text: " / " }, { field: "c" }, { text: "!" }];
    expect(ok({ kind: "concat", parts: p, skipEmpty: true }, null, { a: "1", b: "", c: "3" })).toBe("1 / 3!");
    expect(ok({ kind: "concat", parts: p, skipEmpty: true }, null, { a: "", b: "", c: "" })).toBeNull();
    expect(ok({ kind: "concat", parts: p, skipEmpty: true }, null, { a: "1", b: "2", c: "" })).toBe("1 - 2");
    expect(ok({ kind: "concat", parts: [{ text: "(" }, { field: "a" }, { text: ")" }], skipEmpty: true }, null, { a: "x" })).toBe("(x)");
  });
  it("requireAll leaves the field out when any part is empty, as a standard template does", () => {
    const c: Converter = { kind: "concat", parts, requireAll: true };
    expect(ok(c, null)).toBe("SQ-0012 · Fence");
    expect(ok(c, null, { ref: "SQ-0012", title: "" })).toBeNull();
    expect(validateConverter({ kind: "concat", parts, requireAll: true, skipEmpty: true })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "concat", parts, requireAll: true })).toEqual({ ok: true, value: c });
  });
  it("is refused on an inbound row and over six parts", () => {
    expect(validateConverter({ kind: "concat", parts }, "in")).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "concat", parts: Array(7).fill({ text: "x" }) })).toMatchObject({ ok: false });
  });
});

describe("split", () => {
  it("takes one part, 0-based; -1 is the last", () => {
    expect(ok({ kind: "split", sep: "-", index: 1 }, "SQ-0012")).toBe("0012");
    expect(ok({ kind: "split", sep: "-", index: -1 }, "a-b-c")).toBe("c");
  });
  it("a missing part is empty, which then falls to ifEmpty", () => {
    expect(ok({ kind: "split", sep: "-", index: 5 }, "SQ-0012")).toBeNull();
    expect(withDefault(null, "N/A")).toBe("N/A");
    expect(withDefault("x", "N/A")).toBe("x");
  });
  it("the separator is a literal, never a pattern", () => {
    expect(ok({ kind: "split", sep: ".*", index: 0 }, "a.*b")).toBe("a");
    expect(ok({ kind: "split", sep: ".", index: 1 }, "a.b")).toBe("b");
  });
});

describe("date", () => {
  it("formats an ISO date", () => {
    expect(ok({ kind: "date", format: "dd.MM.yyyy" }, "2026-10-21")).toBe("21.10.2026");
    expect(ok({ kind: "date", format: "MM/dd/yyyy" }, "2026-10-21")).toBe("10/21/2026");
    expect(ok({ kind: "date", format: "dd/MM/yyyy" }, "2026-10-21")).toBe("21/10/2026");
    expect(ok({ kind: "date", format: "yyyyMMdd" }, "2026-10-21")).toBe("20261021");
  });
  it("cuts a datetime to a date, and writes a datetime in full", () => {
    expect(ok({ kind: "date", format: "iso-date" }, "2026-10-21T10:00:00Z")).toBe("2026-10-21");
    expect(ok({ kind: "date", format: "iso-datetime" }, "2026-10-21T10:00:00.250Z")).toBe("2026-10-21T10:00:00Z");
    expect(ok({ kind: "date", format: "epoch-ms" }, "2026-10-21T00:00:00Z")).toBe(Date.UTC(2026, 9, 21));
  });
  it("an unparsable or impossible date is the problem bad_date", () => {
    expect(applyConverter({ kind: "date", format: "iso-date" }, "tomorrow", { record: rec, lists })).toMatchObject({ ok: false, problem: { code: "bad_date" } });
    expect(applyConverter({ kind: "date", format: "iso-date" }, "2026-02-30", { record: rec, lists })).toMatchObject({ ok: false, problem: { code: "bad_date" } });
  });
  it("reads each format back to ISO", () => {
    expect(reverseConverter({ kind: "date", format: "dd.MM.yyyy" }, "21.10.2026", lists)).toEqual({ value: "2026-10-21" });
    expect(reverseConverter({ kind: "date", format: "MM/dd/yyyy" }, "10/21/2026", lists)).toEqual({ value: "2026-10-21" });
    expect(reverseConverter({ kind: "date", format: "yyyyMMdd" }, "20261021", lists)).toEqual({ value: "2026-10-21" });
    expect(reverseConverter({ kind: "date", format: "iso-date" }, "2026-10-21T10:00:00Z", lists)).toEqual({ value: "2026-10-21" });
    expect(reverseConverter({ kind: "date", format: "dd.MM.yyyy" }, "99.99.2026", lists)).toMatchObject({ bad: true });
  });
});

describe("number", () => {
  it("scales and rounds", () => {
    expect(ok({ kind: "number", scale: 100, decimals: 0 }, 12.5)).toBe(1250);
    expect(ok({ kind: "number", decimals: 2 }, 19.999)).toBe(20);
    expect(ok({ kind: "number", decimals: 2 }, 1.005)).toBe(1.01);
  });
  it("can send the number as text", () => {
    expect(ok({ kind: "number", decimals: 2, asText: true }, 19.999)).toBe("20.00");
    expect(ok({ kind: "number", asText: true }, 5)).toBe("5.00");
  });
  it("reads numbers typed as text, with a thousands comma", () => {
    expect(ok({ kind: "number" }, "1,250.5")).toBe(1250.5);
  });
  it("a non-number is the problem bad_number", () => {
    expect(applyConverter({ kind: "number" }, "abc", { record: rec, lists })).toMatchObject({ ok: false, problem: { code: "bad_number" } });
  });
  it("divides by the scale on the way back", () => {
    expect(reverseConverter({ kind: "number", scale: 100 }, 1250, lists)).toEqual({ value: 12.5 });
    expect(reverseConverter({ kind: "number", scale: 100 }, "x", lists)).toMatchObject({ bad: true });
  });
  it("refuses a zero or absurd scale", () => {
    expect(validateConverter({ kind: "number", scale: 0 })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "number", decimals: 9 })).toMatchObject({ ok: false });
  });
});

describe("text", () => {
  it("trims, changes case and truncates", () => {
    expect(ok({ kind: "text", op: "trim" }, "  Fence ")).toBe("Fence");
    expect(ok({ kind: "text", op: "upper" }, "Fence")).toBe("FENCE");
    expect(ok({ kind: "text", op: "lower" }, "Fence")).toBe("fence");
    expect(ok({ kind: "text", op: "truncate", max: 3 }, "Fence")).toBe("Fen");
  });
  it("only trim comes back", () => {
    expect(reverseConverter({ kind: "text", op: "trim" }, " x ", lists)).toEqual({ value: "x" });
    expect(reverseConverter({ kind: "text", op: "upper" }, "ABC", lists)).toEqual({ value: "ABC" });
  });
  it("truncate needs a length", () => {
    expect(validateConverter({ kind: "text", op: "truncate" })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "text", op: "trim", max: 3 })).toMatchObject({ ok: false });
  });
});

describe("boolean", () => {
  it("SAP style X / empty and Y / N", () => {
    const sap: Converter = { kind: "boolean", trueValue: "X", falseValue: "" };
    expect(ok(sap, true)).toBe("X");
    expect(ok(sap, false)).toBe("");
    const yn: Converter = { kind: "boolean", trueValue: "Y", falseValue: "N" };
    expect(ok(yn, "yes")).toBe("Y");
    expect(ok(yn, "no")).toBe("N");
    expect(ok(yn, 0)).toBe("N");
  });
  it("reads back by equality with the true value", () => {
    const yn: Converter = { kind: "boolean", trueValue: "Y", falseValue: "N" };
    expect(reverseConverter(yn, "Y", lists)).toEqual({ value: true });
    expect(reverseConverter(yn, "N", lists)).toEqual({ value: false });
  });
});

describe("validateConverter is strict about hostile input", () => {
  it("rejects unknown kinds, extra keys and non-objects", () => {
    for (const raw of [null, "value_list", 5, [], { kind: "eval", code: "1+1" }, { kind: "javascript", expr: "x" }, { kind: "text", op: "trim", fn: "x" }, { kind: "value_list", list: "unit", extra: 1 }]) {
      expect(validateConverter(raw), JSON.stringify(raw)).toMatchObject({ ok: false });
    }
  });
  it("rejects a list kind that is not a known shape and an oversized constant", () => {
    expect(validateConverter({ kind: "value_list", list: "../../etc" })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "value_list", list: "custom:Has Space" })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "constant", value: "x".repeat(3000) })).toMatchObject({ ok: false });
    expect(validateConverter({ kind: "constant", value: { a: 1 } })).toMatchObject({ ok: false });
  });
  it("accepts what applyConverter takes, unchanged", () => {
    const c: Converter = { kind: "number", scale: 100, decimals: 0, asText: true };
    expect(validateConverter(c)).toEqual({ ok: true, value: c });
  });
});
