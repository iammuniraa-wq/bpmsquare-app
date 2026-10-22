import { describe, expect, it } from "vitest";
import {
  canAddCustom, customKindFromLabel, diffRows, isListKind, listToCsv, listUsedBy, listKindsUsed, mergeUnknownIn, parseListCsv, stillUnknown, unusedCount, validateListInput,
} from "./valueLists";
import type { MapRow, ValueList } from "./types";

const row = (target: string, list?: string): MapRow => ({ id: target, target, source: target, convert: list ? { kind: "value_list", list } : null, ifEmpty: null, origin: "user", confidence: null });

describe("validateListInput", () => {
  it("accepts a clean list and keeps order", () => {
    const r = validateListInput([{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "M", inbound: true }], null);
    expect(r).toMatchObject({ ok: true, default_in: null });
    expect(r.ok && r.rows.map((x) => x.bpm)).toEqual(["Nos", "Mtr"]);
  });

  it("a lone row is the answer for its code whether or not it was marked", () => {
    const r = validateListInput([{ bpm: "Nos", erp: "EA" }, { bpm: "Mtr", erp: "M", inbound: false }], null);
    expect(r.ok && r.rows.every((x) => x.inbound)).toBe(true);
  });

  it("two BPMSquare values may share one ERP code, but exactly one is the inbound answer", () => {
    expect(validateListInput([{ bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Metre", erp: "M", inbound: false }], null).ok).toBe(true);
    const none = validateListInput([{ bpm: "Mtr", erp: "M" }, { bpm: "Metre", erp: "M" }], null);
    expect(none).toMatchObject({ ok: false });
    expect(!none.ok && none.errors[0].message).toMatch(/No row for the ERP code 'M'/);
    const two = validateListInput([{ bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Metre", erp: "m", inbound: true }], null);
    expect(!two.ok && two.errors[0].message).toMatch(/Two rows/);
  });

  it("one BPMSquare value cannot have two codes, whatever the case", () => {
    const r = validateListInput([{ bpm: "Mtr", erp: "M", inbound: true }, { bpm: "MTR", erp: "X", inbound: true }], null);
    expect(!r.ok && r.errors[0]).toMatchObject({ row: 1 });
  });

  it("an empty ERP code saves (shown red), it only blocks the send of that value", () => {
    const r = validateListInput([{ bpm: "Box", erp: "" }], null);
    expect(r).toMatchObject({ ok: true });
  });

  it("refuses non-lists, oversize lists and bad cells", () => {
    expect(validateListInput("x", null)).toMatchObject({ ok: false });
    expect(validateListInput(Array(2001).fill({ bpm: "a", erp: "b" }), null)).toMatchObject({ ok: false });
    expect(validateListInput([{ bpm: "", erp: "b" }], null)).toMatchObject({ ok: false });
    expect(validateListInput([{ bpm: "a", erp: { x: 1 } }], null)).toMatchObject({ ok: false });
    expect(validateListInput([null], null)).toMatchObject({ ok: false });
    expect(validateListInput([{ bpm: "a".repeat(201), erp: "b" }], null)).toMatchObject({ ok: false });
    expect(validateListInput([{ bpm: "a", erp: "b", inbound: "yes" }], null)).toMatchObject({ ok: false });
  });

  it("keeps the default for unknown inbound codes", () => {
    expect(validateListInput([], " Nos ")).toMatchObject({ ok: true, default_in: "Nos" });
    expect(validateListInput([], 5)).toMatchObject({ ok: false });
  });
});

describe("kinds", () => {
  it("knows the standard kinds and custom slugs, nothing else", () => {
    expect(isListKind("unit")).toBe(true);
    expect(isListKind("custom:site_type")).toBe(true);
    for (const k of ["custom:", "custom:A B", "Unit", "custom:../x", 5, null]) expect(isListKind(k)).toBe(false);
  });
  it("makes a custom kind from a label and caps the number of custom lists", () => {
    expect(customKindFromLabel(" Site Type! ")).toBe("custom:site_type");
    expect(customKindFromLabel("!!!")).toBeNull();
    expect(canAddCustom(Array.from({ length: 19 }, (_, i) => `custom:k${i}`))).toBe(true);
    expect(canAddCustom(Array.from({ length: 20 }, (_, i) => `custom:k${i}`))).toBe(false);
    expect(canAddCustom(["unit", "currency"])).toBe(true);
  });
});

describe("CSV round trip", () => {
  const list = { rows: [
    { bpm: "Nos", erp: "EA", inbound: true },
    { bpm: "Box, large", erp: "BX", inbound: true },
    { bpm: "-5 mm", erp: "=M", inbound: true },
    { bpm: 'Quote "x"', erp: "Q", inbound: false },
    { bpm: "Mtr", erp: "M", inbound: false },
    { bpm: "Metre", erp: "M", inbound: true },
  ] };

  it("exports with the header and writes cells through csvCell (formula guard)", () => {
    const csv = listToCsv(list);
    expect(csv.split("\n")[0]).toBe("bpm_value,erp_code,inbound");
    expect(csv).toContain('"Box, large"');
    expect(csv).toContain("'-5 mm");
    expect(csv).toContain("'=M");
  });

  it("reads back the same rows, including the guard characters and the inbound flag", () => {
    const back = parseListCsv(listToCsv(list));
    expect(back.ok && back.rows).toEqual(list.rows);
  });

  it("a hand-written file without the inbound column leaves the flag for the save to settle", () => {
    const r = parseListCsv("bpm_value,erp_code\nNos,EA\nMtr,M\n");
    expect(r.ok && r.rows).toEqual([{ bpm: "Nos", erp: "EA" }, { bpm: "Mtr", erp: "M" }]);
    expect(validateListInput(r.ok ? r.rows : [], null).ok).toBe(true);
  });

  it("refuses a file without the columns, an empty file and too many rows", () => {
    expect(parseListCsv("a,b\n1,2")).toMatchObject({ ok: false });
    expect(parseListCsv("")).toMatchObject({ ok: false });
    const big = "bpm_value,erp_code\n" + Array.from({ length: 2001 }, (_, i) => `v${i},c${i}`).join("\n");
    expect(parseListCsv(big)).toMatchObject({ ok: false });
  });

  it("the preview counts what the file would add, change and remove", () => {
    const before = [{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Box", erp: "BX", inbound: true }];
    const after = [{ bpm: "nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "MT", inbound: true }, { bpm: "Kg", erp: "KG", inbound: true }];
    expect(diffRows(before, after)).toEqual({ added: 1, changed: 1, removed: 1 });
  });
});

describe("usage and the unknown-code book", () => {
  const docs = [
    { document: "quote", doc: { header: [row("currencycode", "currency")], lines: [row("uomcode", "unit"), row("name")] } },
    { document: "products", doc: { header: [row("uom", "unit")], lines: [] } },
  ];
  it("finds where a list is used, by document and field", () => {
    expect(listUsedBy("unit", docs)).toEqual([{ document: "quote", field: "uomcode" }, { document: "products", field: "uom" }]);
    expect(listUsedBy("country", docs)).toEqual([]);
    expect([...listKindsUsed(docs[0].doc).keys()].sort()).toEqual(["currency", "unit"]);
  });
  it("counts a list's rows as unused when no field row references it", () => {
    const l = { kind: "country", rows: [{ bpm: "India", erp: "IN", inbound: true }] } as ValueList;
    expect(unusedCount(l, new Set(["unit"]))).toBe(1);
    expect(unusedCount(l, new Set(["country"]))).toBe(0);
  });
  it("keeps the last 50 distinct unknown inbound codes, newest last", () => {
    expect(mergeUnknownIn(["A", "B"], ["B", "C"])).toEqual(["A", "B", "C"]);
    const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const out = mergeUnknownIn([], many);
    expect(out).toHaveLength(50);
    expect(out[49]).toBe("c59");
  });
  it("a code that gained a row is no longer unknown", () => {
    expect(stillUnknown({ rows: [{ bpm: "Nos", erp: "EA", inbound: true }], unknown_in: ["EA", "ZZ"] })).toEqual(["ZZ"]);
  });
});
