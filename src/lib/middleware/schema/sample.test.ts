import { describe, expect, it } from "vitest";
import { parseManualFields, parseSample } from "./sample";

describe("parseSample", () => {
  const body = JSON.stringify({
    number: "SO-1", total: 12.5, count: 3, urgent: true, due: "2026-10-21", at: "2026-10-21T10:00:00Z", note: null,
    address: { city: "Doha", geo: { lat: 25.3 } },
    tags: ["a", "b"],
    items: [{ sku: "A", qty: 2 }, { sku: "B", qty: 1, extra: "x" }],
  });

  it("infers types from values, flattens objects and takes the first array of objects as lines", () => {
    const r = parseSample(body);
    if (!r.ok) throw new Error(r.message);
    const by = Object.fromEntries(r.fields.map((f) => [f.path, f.type]));
    expect(by).toMatchObject({ number: "text", total: "number", count: "integer", urgent: "boolean", due: "date", at: "datetime", note: "text", "address.city": "text", "address.geo.lat": "number", tags: "array" });
    expect(r.linesPath).toBe("items");
    expect(r.lineFields.map((f) => f.path).sort()).toEqual(["qty", "sku"]);
  });

  it("nothing is required: a sample cannot say", () => {
    const r = parseSample(body);
    expect(r.ok && r.fields.every((f) => !f.required)).toBe(true);
  });

  it("takes the first record of a list or of an OData answer", () => {
    expect(parseSample('[{"a":1},{"a":2}]')).toMatchObject({ ok: true, fields: [{ path: "a", type: "integer" }] });
    expect(parseSample('{"@odata.context":"x","value":[{"name":"n"}]}')).toMatchObject({ ok: true, fields: [{ path: "name" }] });
  });

  it("refuses empty, oversize, non-JSON and non-object samples", () => {
    expect(parseSample("")).toMatchObject({ ok: false });
    expect(parseSample("x".repeat(70_000))).toMatchObject({ ok: false, message: expect.stringContaining("64 KB") });
    expect(parseSample("{not json")).toMatchObject({ ok: false });
    expect(parseSample("42")).toMatchObject({ ok: false });
    expect(parseSample("[1,2]")).toMatchObject({ ok: false });
    expect(parseSample("{}")).toMatchObject({ ok: false });
  });

  it("ignores prototype keys and cuts a structure deeper than six levels", () => {
    const r = parseSample('{"__proto__":{"x":1},"constructor":"c","ok":1}');
    expect(r.ok && r.fields.map((f) => f.path)).toEqual(["ok"]);
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { n: deep };
    const d = parseSample(JSON.stringify(deep));
    expect(d.ok === false || d.notes.join(" ").includes("cut")).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("parseManualFields", () => {
  it("accepts a list with types, required marks, lines and enum values", () => {
    const r = parseManualFields([
      { path: "customer.name", type: "text", required: true }, { path: "total", type: "number" },
      { path: "qty", type: "number", block: "lines" }, { path: "unit", type: "enum", enum: ["EA"], block: "lines" },
    ], "items");
    expect(r).toMatchObject({ ok: true, linesPath: "items" });
    expect(r.ok && r.fields.map((f) => f.path)).toEqual(["customer.name", "total"]);
    expect(r.ok && r.lineFields.map((f) => f.path)).toEqual(["qty", "unit"]);
  });

  it("refuses bad names, types, duplicates, too many fields and a lines field without a lines block", () => {
    for (const bad of [
      [{ path: "a b" }], [{ path: "__proto__" }], [{ path: "a.__proto__.b" }], [{ path: "x", type: "money" }], [{ path: "x" }, { path: "x" }],
      [{ path: "x", block: "lines" }], "text", [], [null],
    ]) expect(parseManualFields(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect(parseManualFields(Array.from({ length: 201 }, (_, i) => ({ path: `f${i}` })))).toMatchObject({ ok: false });
  });

  it("allows an OData bind name", () => {
    expect(parseManualFields([{ path: "customerid_account@odata.bind", type: "lookup" }])).toMatchObject({ ok: true });
  });
});
