import { describe, expect, it } from "vitest";
import { assembleBody, compile, describeProblems, inboundFieldMap, run, runInbound, setPath, type CompileOptions } from "./engine";
import type { ListLookup } from "./convert";
import type { MapRow, MappingDocument, SourceField, TargetField, ValueList } from "./types";

const tf = (path: string, type: TargetField["type"] = "text", over: Partial<TargetField> = {}): TargetField => ({ path, label: over.label ?? path, type, required: false, creatable: true, ...over });
const sf = (key: string, type: SourceField["type"] = "text"): SourceField => ({ key, label: key, type, custom: false });
const row = (id: string, target: string, source: string | null, over: Partial<MapRow> = {}): MapRow => ({ id, target, source, convert: null, ifEmpty: null, origin: "user", confidence: null, ...over });

const unitList: ValueList = { kind: "unit", label: "Unit", default_in: null, unknown_in: [], rows: [{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "M", inbound: true }] };
const lists: ListLookup = (k) => (k === "unit" ? unitList : undefined);

const doc = (header: MapRow[], lines: MapRow[] = [], schema: { fields?: TargetField[]; lineFields?: TargetField[]; linesPath?: string | null } = {}): MappingDocument => ({
  source: { object: "standard_quote", registryHash: "h" },
  target: {
    kind: "adapter", entity: "quotes", linesPath: schema.linesPath === undefined ? "quote_details" : schema.linesPath,
    schema: { fetchedAt: "2026-10-22T00:00:00Z", sourceUrl: null, fields: schema.fields ?? [], lineFields: schema.lineFields ?? [] },
  },
  header, lines,
});

const opts = (over: Partial<CompileOptions> = {}): CompileOptions => ({
  direction: "out", lists, sourceFields: { header: [sf("ref"), sf("title"), sf("total", "number"), sf("currency", "enum"), sf("valid_until", "date")], lines: [sf("description"), sf("qty", "number"), sf("uom", "enum")] }, ...over,
});

const FIELDS = [tf("name", "text", { required: true }), tf("description"), tf("totalamount", "number"), tf("effectiveto", "date"), tf("customerid", "lookup"), tf("fixed", "boolean")];
const LINE_FIELDS = [tf("productdescription"), tf("quantity", "number"), tf("uomcode", "enum", { enum: ["EA", "M"] })];

describe("compile", () => {
  const good = () => doc([row("h1", "name", "ref"), row("h2", "totalamount", "total")], [row("l1", "uomcode", "uom", { convert: { kind: "value_list", list: "unit" } })], { fields: FIELDS, lineFields: LINE_FIELDS });

  it("builds a program from a valid document", () => {
    const r = compile(good(), opts());
    expect(r.ok && r.program.header.map((x) => x.target)).toEqual(["name", "totalamount"]);
    expect(r.ok && r.program.listKinds).toEqual(["unit"]);
    expect(r.ok && r.program.header[0].required).toBe(true);
  });

  it("names the row that is wrong: unknown target, unknown source, two rows for one field", () => {
    const d = doc([row("a", "nope", "ref"), row("b", "name", "zzz"), row("c", "description", "title"), row("d", "description", "ref")], [], { fields: FIELDS });
    const r = compile(d, opts());
    expect(r.ok).toBe(false);
    const errs = !r.ok ? r.errors : [];
    expect(errs.find((e) => e.rowId === "a")?.message).toMatch(/not a field of the ERP/);
    expect(errs.find((e) => e.rowId === "b")?.message).toMatch(/zzz is not a BPMSquare field/);
    expect(errs.find((e) => e.rowId === "d")?.message).toMatch(/filled by two rows/);
  });

  it("refuses a type that can never fit without a converter, accepts it with one", () => {
    const bad = compile(doc([row("a", "customerid", "ref")], [], { fields: FIELDS }), opts());
    expect(bad.ok).toBe(false);
    expect(compile(doc([row("a", "totalamount", "ref", { convert: { kind: "number" } })], [], { fields: FIELDS }), opts()).ok).toBe(true);
  });

  it("refuses an unknown converter kind, a converter with a stray key and a missing list", () => {
    const hostile = [{ kind: "eval", code: "x" }, { kind: "text", op: "trim", extra: 1 }, { kind: "value_list", list: "custom:ghost" }] as never[];
    for (const convert of hostile) {
      const r = compile(doc([row("a", "name", "ref", { convert })], [], { fields: FIELDS }), opts());
      expect(r.ok, JSON.stringify(convert)).toBe(false);
    }
  });

  it("an inbound row with an outbound-only converter is refused", () => {
    const r = compile(doc([row("a", "name", "ref", { convert: { kind: "constant", value: "x" } })], [], { fields: FIELDS }), opts({ direction: "in" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0].message).toMatch(/cannot be read back/);
  });

  it("lines without a lines block in the target are refused", () => {
    const r = compile(doc([], [row("l", "quantity", "qty")], { lineFields: LINE_FIELDS, linesPath: null }), opts());
    expect(r.ok).toBe(false);
  });

  it("rows that send nothing are ignored, duplicate row ids are refused, a field that cannot be created is refused", () => {
    expect(compile(doc([row("a", "name", null)], [], { fields: FIELDS }), opts()).ok).toBe(true);
    expect(compile(doc([row("a", "name", "ref"), row("a", "description", "title")], [], { fields: FIELDS }), opts()).ok).toBe(false);
    expect(compile(doc([row("a", "name", "ref")], [], { fields: [tf("name", "text", { creatable: false })] }), opts()).ok).toBe(false);
  });

  it("a constant row needs no source; a join reads its parts", () => {
    const r = compile(doc([row("a", "fixed", null, { convert: { kind: "constant", value: true } }), row("b", "description", null, { convert: { kind: "concat", parts: [{ field: "ref" }, { text: " · " }, { field: "title" }] } })], [], { fields: FIELDS }), opts());
    expect(r.ok).toBe(true);
    const bad = compile(doc([row("b", "description", null, { convert: { kind: "concat", parts: [{ field: "ghost" }] } })], [], { fields: FIELDS }), opts());
    expect(bad.ok).toBe(false);
  });
});

describe("run", () => {
  const prog = (d: MappingDocument) => { const c = compile(d, opts()); if (!c.ok) throw new Error(JSON.stringify(c.errors)); return c.program; };

  it("fills the header and every line, with converters and defaults applied", () => {
    const p = prog(doc(
      [row("h1", "name", "ref"), row("h2", "totalamount", "total"), row("h3", "effectiveto", "valid_until", { convert: { kind: "date", format: "iso-date" } }), row("h4", "description", "title", { ifEmpty: "No title" })],
      [row("l1", "quantity", "qty"), row("l2", "uomcode", "uom", { convert: { kind: "value_list", list: "unit" } })],
      { fields: FIELDS, lineFields: LINE_FIELDS },
    ));
    const r = run(p, { header: { ref: "SQ-1", total: 125, valid_until: "2026-12-31T00:00:00Z", title: "" }, lines: [{ qty: 2, uom: "Mtr" }, { qty: 1, uom: "Nos" }] }, { lists });
    expect(r.problems).toEqual([]);
    expect(r.header).toEqual({ name: "SQ-1", totalamount: 125, effectiveto: "2026-12-31", description: "No title" });
    expect(r.lines).toEqual([{ quantity: 2, uomcode: "M" }, { quantity: 1, uomcode: "EA" }]);
    expect(assembleBody(p, r)).toMatchObject({ name: "SQ-1", quote_details: [{ quantity: 2, uomcode: "M" }, { quantity: 1, uomcode: "EA" }] });
  });

  it("an unmapped value is a problem, the row stays out of the body, the other rows still run", () => {
    const p = prog(doc([row("h1", "name", "ref")], [row("l1", "quantity", "qty"), row("l2", "uomcode", "uom", { convert: { kind: "value_list", list: "unit" } })], { fields: FIELDS, lineFields: LINE_FIELDS }));
    const r = run(p, { header: { ref: "SQ-1" }, lines: [{ qty: 1, uom: "Box" }, { qty: 2, uom: "Box" }, { qty: 3, uom: "Pail" }] }, { lists });
    expect(r.problems.map((x) => [x.code, x.value])).toEqual([["value_unmapped", "Box"], ["value_unmapped", "Pail"]]);
    expect(r.lines[0]).toEqual({ quantity: 1 });
    expect(r.header.name).toBe("SQ-1");
  });

  it("describeProblems writes the agreed Monitor wording, one sentence for several values of one list", () => {
    const p = prog(doc([], [row("l2", "uomcode", "uom", { convert: { kind: "value_list", list: "unit" } })], { lineFields: LINE_FIELDS }));
    const one = run(p, { header: {}, lines: [{ uom: "Box" }] }, { lists });
    expect(describeProblems(one.problems)).toMatchObject({ headline: "Unit 'Box' has no ERP code.", fix: "Add it in Mapping > Value mapping, then Restart.", kind: "mapping_value" });
    const many = run(p, { header: {}, lines: [{ uom: "Box" }, { uom: "Pail" }] }, { lists });
    expect(describeProblems(many.problems).headline).toBe("Unit 'Box', 'Pail' have no ERP code.");
  });

  it("a required target field still empty after the default is a problem, unless the engine sets it itself", () => {
    const p = prog(doc([row("h1", "name", "ref")], [], { fields: FIELDS }));
    const r = run(p, { header: { ref: "" }, lines: [] }, { lists });
    expect(r.problems).toMatchObject([{ code: "required_empty", field: "name" }]);
    expect(r.problems[0].message).toBe("name is required by the target and ref is empty.");
    expect(run(p, { header: { ref: "" }, lines: [] }, { lists, engineSets: ["name"] }).problems).toEqual([]);
    const withDefault = prog(doc([row("h1", "name", "ref", { ifEmpty: "Untitled" })], [], { fields: FIELDS }));
    expect(run(withDefault, { header: { ref: "" }, lines: [] }, { lists }).header.name).toBe("Untitled");
  });

  it("a bad date or number is a problem naming the value", () => {
    const p = prog(doc([row("h3", "effectiveto", "valid_until", { convert: { kind: "date", format: "iso-date" } })], [], { fields: FIELDS }));
    expect(run(p, { header: { valid_until: "soon" }, lines: [] }, { lists }).problems[0]).toMatchObject({ code: "bad_date", value: "soon" });
  });

  it("a row whose target is no longer in the ERP saves but cannot send", () => {
    const fields = FIELDS.map((f) => (f.path === "description" ? { ...f, state: "missing" as const } : f));
    const p = prog(doc([row("h", "description", "title")], [], { fields }));
    expect(run(p, { header: { title: "x" }, lines: [] }, { lists }).problems[0]).toMatchObject({ code: "target_field_missing", field: "description" });
  });

  it("a list code is sent as a number to a numeric column or choice, and as a boolean to a yes/no column", () => {
    const fields = [tf("qtytext", "integer"), tf("choice", "enum", { enum: ["100000000", "100000001"] }), tf("flag", "boolean"), tf("plain", "enum", { enum: ["A", "B"] })];
    const src = { header: [sf("a"), sf("b"), sf("c"), sf("d")], lines: [] };
    const d = doc([row("1", "qtytext", "a", { convert: { kind: "text", op: "trim" } }), row("2", "choice", "b", { convert: { kind: "text", op: "trim" } }), row("3", "flag", "c", { convert: { kind: "text", op: "lower" } }), row("4", "plain", "d")], [], { fields });
    const c = compile(d, opts({ sourceFields: src }));
    if (!c.ok) throw new Error(JSON.stringify(c.errors));
    expect(run(c.program, { header: { a: " 7 ", b: "100000001", c: "TRUE", d: "A" }, lines: [] }, { lists }).header).toEqual({ qtytext: 7, choice: 100000001, flag: true, plain: "A" });
  });

  it("no lines block in the target: the body is the header only", () => {
    const p = prog(doc([row("h1", "name", "ref")], [], { fields: FIELDS, linesPath: null }));
    expect(assembleBody(p, run(p, { header: { ref: "A" }, lines: [{ qty: 1 }] }, { lists }))).toEqual({ name: "A" });
  });
});

describe("setPath is safe against hostile paths", () => {
  it("nests dotted paths, keeps a bind as one key, and refuses prototype keys", () => {
    const o: Record<string, unknown> = {};
    expect(setPath(o, "address.city", "Doha")).toBe(true);
    expect(setPath(o, "customerid_account@odata.bind", "/accounts(1)")).toBe(true);
    expect(o).toEqual({ address: { city: "Doha" }, "customerid_account@odata.bind": "/accounts(1)" });
    for (const bad of ["__proto__.polluted", "a.__proto__.x", "constructor.prototype.y", "a..b", ".a"]) {
      expect(setPath({}, bad, 1), bad).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(setPath({ a: "text" }, "a.b", 1)).toBe(false);
  });
});

describe("runInbound", () => {
  const erpDoc = doc(
    [row("a", "name", "name"), row("b", "uomcode", "uom", { convert: { kind: "value_list", list: "unit" } }), row("c", "address.city", "city")],
    [], { fields: [tf("name"), tf("uomcode"), tf("address.city")] },
  );
  const c = compile(erpDoc, opts({ direction: "in", sourceFields: { header: [sf("name"), sf("uom", "enum"), sf("city")], lines: [] } }));
  if (!c.ok) throw new Error(JSON.stringify(c.errors));

  it("reads the ERP row through the reverse converters", () => {
    const r = runInbound(c.program, { name: "Acme", uomcode: "M", address: { city: "Doha" } }, lists);
    expect(r.values).toEqual({ name: "Acme", uom: "Mtr", city: "Doha" });
    expect(r.unknown).toEqual([]);
  });

  it("an unknown ERP code is kept raw and counted, and the pull does not fail", () => {
    const r = runInbound(c.program, { name: "Acme", uomcode: "ZZ" }, lists);
    expect(r.values.uom).toBe("ZZ");
    expect(r.unknown).toEqual([{ list: "unit", value: "ZZ" }]);
  });

  it("a blank in the ERP is null, not a wipe of a stored value (the pull keeps blank = leave)", () => {
    expect(runInbound(c.program, { name: "Acme", uomcode: "" }, lists).values.uom).toBeNull();
  });

  it("gives the older pull the field map it already understands", () => {
    expect(inboundFieldMap(c.program)).toEqual({ name: "name", uom: "uomcode", city: "address.city" });
  });
});
