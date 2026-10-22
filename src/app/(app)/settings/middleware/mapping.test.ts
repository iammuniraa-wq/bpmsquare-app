import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { MapRow, SourceField, TargetField } from "@/lib/middleware/mapping/types";
import { normalizeMappingDoc, type EngineRows } from "./api";
import {
  acceptRow, addSuggestions, aiProblemWords, blankRow, changeChips, cleanRows, confidenceWord, convertLabel, converterExample, describeSource, documentChoices,
  errorsByRow, fetchedWord, generatedTemplate, inboundChoices, isMapDirty, legacyEdits, legacyEngine, listChoices, missingBar, onlyPlainChanges, parseManualText, sampleFieldMap, schemaBar,
  setRowConvert, setRowTarget, stillMissing, tryBlocker, usedListKinds, viewRows,
} from "./mappingLogic";
import {
  addMissingValue, addRow, addableKinds, cleanListRows, counterLine, csvPreviewLine, draftOf, isListDirty, listProblems, mergeProposed, needsCode, newCustomList,
  normalizeInbound, removeRow, setErp, setInbound,
} from "./valueListLogic";
import { FieldBlock, visibleRows } from "./MappingFields";
import { ListTable } from "./MappingValueLists";
import { SchemaBar } from "./SchemaBar";
import AiReviewSheet from "./AiReviewSheet";
import { TryResultView } from "./TryItPanel";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

// ── Fixtures ────────────────────────────────────────────────────────────────

const src: SourceField[] = [
  { key: "ref", label: "Reference", type: "text", custom: false }, { key: "currency", label: "Currency", type: "text", custom: false },
  { key: "valid_until", label: "Valid until", type: "date", custom: false }, { key: "cf_site", label: "Site code", type: "text", custom: true },
];
const tgt: TargetField[] = [
  { path: "name", label: "Name", type: "text", required: true, creatable: true },
  { path: "currencycode", label: "Currency", type: "text", required: false, creatable: true, state: "new" },
  { path: "effectiveto", label: "Effective to", type: "date", required: false, creatable: true },
  { path: "pricelevelid@odata.bind", label: "Price list", type: "lookup", required: true, creatable: true },
];
const row = (over: Partial<MapRow>): MapRow => ({ id: "r1", target: "name", source: "ref", convert: null, ifEmpty: null, origin: "standard", confidence: null, ...over });
const rows = (): EngineRows => ({
  header: [
    row({ id: "std:header:name" }),
    row({ id: "p1", target: "currencycode", source: "currency", origin: "proposed", confidence: "sure", convert: { kind: "value_list", list: "currency" } }),
    row({ id: "j1", target: "description", source: null, convert: { kind: "concat", parts: [{ field: "ref" }, { text: " " }, { field: "currency" }] } }),
  ],
  lines: [],
});

// ── Fields: the pure parts ──────────────────────────────────────────────────

describe("the field rows the screen draws", () => {
  it("shows one line per BPMSquare field, mapped or not, plus the rows that read no single field", () => {
    const v = viewRows(rows().header, src);
    expect(v.map((x) => x.label)).toEqual(["Reference, Currency", "Reference", "Currency", "Valid until", "Site code"]);
    expect(v[0].rowId).toBe("j1");
    expect(v[3]).toMatchObject({ rowId: null, source: "valid_until", target: null });
  });
  it("names a join by its fields and a fixed value by its value", () => {
    expect(describeSource({ kind: "concat", parts: [{ field: "ref" }, { text: "-" }] }, src)).toBe("Reference");
    expect(describeSource({ kind: "constant", value: "EUR" }, src)).toBe("Fixed value: EUR");
  });
  it("gives a field its first row, clears it by removing the row, and marks a changed row as the person's", () => {
    let id = 0;
    const v = viewRows(rows().header, src);
    const added = setRowTarget(rows().header, v[3], "effectiveto", () => `n${++id}`);
    expect(added.at(-1)).toMatchObject({ id: "n1", target: "effectiveto", source: "valid_until", origin: "user" });
    expect(setRowTarget(rows().header, v[2], null, () => "x").some((r) => r.id === "p1")).toBe(false);
    expect(setRowTarget(rows().header, v[2], "effectiveto", () => "x").find((r) => r.id === "p1")).toMatchObject({ target: "effectiveto", origin: "user", confidence: null });
    expect(acceptRow(rows().header, "p1").find((r) => r.id === "p1")).toMatchObject({ origin: "user", confidence: null });
    expect(setRowConvert(rows().header, "p1", { kind: "date", format: "iso-date" }, "  ").find((r) => r.id === "p1")).toMatchObject({ convert: { kind: "date" }, ifEmpty: null });
  });
  it("is dirty only when the rows differ, ignoring a blank fixed-value row that has no target yet", () => {
    const base = rows();
    expect(isMapDirty(base, rows())).toBe(false);
    expect(isMapDirty(base, { ...rows(), header: [...rows().header, blankRow("b")] })).toBe(false);
    expect(isMapDirty(base, { ...rows(), header: acceptRow(rows().header, "p1") })).toBe(true);
    expect(cleanRows({ header: [blankRow("b"), row({})], lines: [] }).header).toHaveLength(1);
  });
  it("adds accepted AI lines once, marked AI, and skips a target already mapped", () => {
    let id = 0;
    const out = addSuggestions(rows(), [
      { source: "valid_until", target: "effectiveto", reason: "same meaning", convert: { kind: "date", format: "iso-date" }, block: "header" },
      { source: "ref", target: "name", reason: "dupe", convert: null, block: "header" },
    ], () => `a${++id}`);
    expect(out.header).toHaveLength(4);
    expect(out.header.at(-1)).toMatchObject({ id: "a1", origin: "ai", convert: { kind: "date" } });
    expect(confidenceWord(out.header.at(-1) as MapRow)).toBe("AI");
  });
  it("speaks confidence in plain words, once, and a converter in a short label", () => {
    expect(confidenceWord(row({ origin: "proposed", confidence: "guess" }))).toBe("Guess");
    expect(confidenceWord(row({ origin: "user", confidence: "sure" }))).toBeNull();
    expect(convertLabel(null)).toBe("–");
    expect(convertLabel({ kind: "value_list", list: "unit" })).toBe("Unit list");
    expect(convertLabel({ kind: "text", op: "truncate", max: 5 })).toBe("Shorten");
    expect(converterExample({ kind: "text", op: "upper" }, src[0], undefined)).toContain("→   FENCE");
    expect(converterExample({ kind: "value_list", list: "unit" }, src[0], { kind: "unit", label: "Unit", rows: [{ bpm: "Mtr", erp: "M", inbound: true }], default_in: null, unknown_in: [] })).toBe("Mtr → M");
  });
  it("offers every list a converter may point at, and knows which lists the rows use", () => {
    expect(listChoices(["custom:region"], ["unit"]).map((l) => l.kind)).toContain("custom:region");
    expect(usedListKinds(rows())).toEqual(["currency"]);
  });
});

describe("the bars and words", () => {
  it("names the missing fields in one line, minus what the person has since mapped", () => {
    expect(missingBar([])).toBeNull();
    expect(missingBar(["Customer", "Price list"])).toContain("Customer, Price list");
    expect(stillMissing(["Price list", "Name"], tgt, rows().header)).toEqual(["Price list"]);
    expect(stillMissing(["Price list"], tgt, [row({ target: "pricelevelid@odata.bind" })])).toEqual([]);
  });
  it("sums the field list up in a compact bar with new/missing chips", () => {
    const target = { kind: "openapi" as const, entity: "/quotes", linesPath: "items", schema: { fetchedAt: new Date().toISOString(), sourceUrl: null, counts: { total: 0, new: 0, missing: 0 } } };
    const bar = schemaBar(target, { total: 112, new: 3, missing: 1 });
    expect(bar.count).toBe("112 fields");
    expect(bar.fetched).toMatch(/^today \d\d:\d\d$/);
    expect(changeChips(bar)).toEqual(["3 new", "1 missing"]);
    expect(schemaBar({ ...target, kind: "adapter" }, { total: 0, new: 0, missing: 0 })).toMatchObject({ count: "No field list yet", fetched: null });
    expect(fetchedWord("nope")).toBeNull();
  });
  it("blocks Try it while there are unsaved changes, and speaks a refused AI call plainly", () => {
    expect(tryBlocker(true, false)).toContain("Save the mapping first");
    expect(tryBlocker(false, true)).toBe("No fields to try yet.");
    expect(tryBlocker(false, false)).toBeNull();
    expect(aiProblemWords(402, "x")).toContain("allowance");
    expect(aiProblemWords(403, "x")).toContain("not switched on");
    expect(aiProblemWords(503, "x")).toContain("not set up");
    expect(aiProblemWords(500, "x")).toBe("x");
  });
  it("sorts a refused save into row messages and general ones", () => {
    const m = errorsByRow([{ rowId: "p1", message: "Unknown field." }, { message: "Too many rows." }, { rowId: "p1", message: "second" }]);
    expect(m).toEqual({ byRow: { p1: "Unknown field." }, general: ["Too many rows."] });
  });
  it("offers the document, the inbound entities and each quote webhook", () => {
    const c = documentChoices("Dynamics 365", "Quote", "dynamics365", [{ id: "w1", name: "ERP push" }]);
    expect(c[0]).toEqual({ key: "quote", label: "Quote → Dynamics 365 Quote", document: "quote", connection: "dynamics365" });
    expect(c.map((x) => x.key)).toEqual(["quote", "customers", "contacts", "products", "projects", "webhook:w1"]);
    expect(c.at(-1)).toMatchObject({ document: "quote", connection: "webhook:w1" });
    expect(sampleFieldMap(rows())).toEqual({ ref: "name", currency: "currencycode" });
  });
  it("parses typed fields one per line, with a type, a required mark and a lines prefix", () => {
    const m = parseManualText("name text*\ncity\nitems.qty number", "items");
    expect(m.problem).toBeNull();
    expect(m.fields).toEqual([{ path: "name", type: "text", required: true }, { path: "city", type: "text" }, { path: "qty", type: "number", block: "lines" }]);
    expect(parseManualText("bad name!", "").problem).toContain("bad name!");
    expect(parseManualText("", "").problem).toBe("Add at least one field.");
  });
  it("builds the webhook's body with a token where each value goes", () => {
    const t = JSON.parse(generatedTemplate({ header: rows().header, lines: [row({ id: "l", target: "qty", source: "qty" })] }, "items")) as Record<string, unknown>;
    expect(t).toEqual({ name: "{{ref}}", currencycode: "{{currency}}", description: "{{ref}} {{currency}}", items: [{ qty: "{{qty}}" }] });
    expect(generatedTemplate({ header: [row({ target: "a.__proto__.x" })], lines: [] }, null)).not.toContain("__proto__");
  });
});

describe("while the database update is pending", () => {
  const view = normalizeMappingDoc({
    needsDatabaseUpdate: true, bundle: "run-bundle-12-mapping-2026-10-21.sql",
    document: { key: "quote" }, sections: [{ key: "header", rows: [{ id: "name", bpm: { name: "ref", label: "Reference" }, erp: { name: "name", label: "Name" } }, { id: "desc", bpm: { name: "description" }, erp: null }] }],
    engine: { active: false }, target: { kind: "adapter", entity: "quotes", schema: {} }, rows: { header: [row({ id: "std:header:name" })], lines: [] },
  });
  it("reads the bundle from the 200 answer and keeps the engine rows", () => {
    expect(view.pending).toEqual({ bundle: "run-bundle-12-mapping-2026-10-21.sql" });
    expect(view.engine?.rows.header).toHaveLength(1);
    expect(view.engine?.target.schema.counts).toEqual({ total: 0, new: 0, missing: 0 });
  });
  it("turns a plain field change into the older per-section save, and refuses anything more", () => {
    const now: EngineRows = { header: [row({ id: "std:header:name" }), row({ id: "u1", target: "description", source: "description", origin: "user" })], lines: [] };
    expect(legacyEdits(view, now)).toEqual([{ section: "header", rows: [{ id: "name", erp: "name" }, { id: "desc", erp: "description" }] }]);
    expect(onlyPlainChanges(view.engine!.rows, now)).toBe(true);
    expect(onlyPlainChanges(view.engine!.rows, { header: [row({ id: "std:header:name", convert: { kind: "text", op: "upper" } })], lines: [] })).toBe(false);
  });
});

describe("a preset-only connector (SAP S/4HANA) in the same blocks", () => {
  const view = normalizeMappingDoc({
    document: { key: "customers", label: "Customers", targetLabel: "SAP S/4HANA Customers" },
    sections: [{ key: "header", label: "Fields", rows: [
      { id: "name", bpm: { label: "Name", name: "name" }, erp: { label: "Business partner name", name: "BusinessPartnerFullName" }, standard: true },
      { id: "city", bpm: { label: "City", name: "city" }, erp: null, standard: true },
    ] }],
    erpFields: { header: [{ label: "Business partner name", name: "BusinessPartnerFullName" }, { label: "City", name: "CityName" }], lines: [] },
    usingStandard: true, missingRequired: [],
  });
  it("turns the two-column view into engine data: one row per mapped field, the SAP fields as targets, no AI, no lists", () => {
    const eng = legacyEngine(view)!;
    expect(view.engine).toBeNull();
    expect(eng.rows.header).toEqual([{ id: "name", target: "BusinessPartnerFullName", source: "name", convert: null, ifEmpty: null, origin: "standard", confidence: null }]);
    expect(eng.sourceFields.header.map((f) => f.key)).toEqual(["name", "city"]);
    expect(eng.targetFields.header.map((f) => f.path)).toEqual(["BusinessPartnerFullName", "CityName"]);
    expect(eng.target.schema.counts.total).toBe(2);
    expect(eng.ai.available).toBe(false);
    expect(eng.engine.usingStandard).toBe(true);
    expect(legacyEngine(normalizeMappingDoc({ connected: false }))).toBeNull();
  });
  it("saves a changed field through the older per-section route, as the SAP route expects", () => {
    const eng = legacyEngine(view)!;
    const now = { header: [...eng.rows.header, { id: "u1", target: "CityName", source: "city", convert: null, ifEmpty: null, origin: "user" as const, confidence: null }], lines: [] };
    expect(legacyEdits(view, now)).toEqual([{ section: "header", rows: [{ id: "name", erp: "BusinessPartnerFullName" }, { id: "city", erp: "CityName" }] }]);
  });
  it("offers only the inbound documents, in the shape the selector reads", () => {
    expect(inboundChoices("SAP S/4HANA", "sap_s4")).toEqual([
      { key: "customers", label: "Customers (from SAP S/4HANA)", document: "customers", connection: "sap_s4" },
      { key: "vendors", label: "Suppliers (from SAP S/4HANA)", document: "vendors", connection: "sap_s4" },
      { key: "products", label: "Products (from SAP S/4HANA)", document: "products", connection: "sap_s4" },
    ]);
  });
});

// ── Value mapping: the pure parts ───────────────────────────────────────────

describe("value lists", () => {
  const list = draftOf({ kind: "unit", label: "Unit", rows: [{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Metre", erp: "M", inbound: false }], default_in: null });
  it("keeps exactly one inbound row per ERP code, and moves it with the radio", () => {
    expect(normalizeInbound([{ bpm: "a", erp: "X", inbound: false }, { bpm: "b", erp: "X", inbound: false }, { bpm: "c", erp: "", inbound: true }]).map((r) => r.inbound)).toEqual([true, false, false]);
    expect(setInbound(list, 2).rows.map((r) => r.inbound)).toEqual([true, false, true]);
    expect(setErp(list, 0, "M").rows.map((r) => r.inbound)).toEqual([true, false, false]);
  });
  it("flags a BPMSquare value with no code in red, and a value listed twice", () => {
    expect(needsCode({ bpm: "Box", erp: "", inbound: false })).toBe(true);
    expect(listProblems(addRow(addRow(list, "nos"), "x"))).toEqual([{ row: 3, message: "nos is already in row 1." }]);
  });
  it("is dirty on a changed row or default, clean when only blank rows were added", () => {
    expect(isListDirty(list, addRow(list))).toBe(false);
    expect(isListDirty(list, removeRow(list, 2))).toBe(true);
    expect(isListDirty(list, { ...list, default_in: "Nos" })).toBe(true);
    expect(cleanListRows(addRow(list).rows)).toHaveLength(3);
  });
  it("merges proposed rows by code, adds an unmapped value as a row to fill, and words the counters", () => {
    const m = mergeProposed(list, [{ bpm: "", erp: "M", inbound: true }, { bpm: "", erp: "BX", inbound: true }]);
    expect(m.added).toBe(1);
    expect(m.draft.rows.at(-1)).toEqual({ bpm: "", erp: "BX", inbound: true });
    expect(addMissingValue(list, "out", "Box").rows.at(-1)).toEqual({ bpm: "Box", erp: "", inbound: false });
    expect(addMissingValue(list, "in", "m").rows).toHaveLength(3);
    expect(counterLine({ rows: 11, unused: 2, unmapped: 1 })).toBe("11 rows · 2 unused · 1 unmapped");
    expect(counterLine({ rows: 1, unused: 0, unmapped: 0 })).toBe("1 row");
    expect(csvPreviewLine({ added: 2, changed: 1, removed: 0 })).toContain("2 added, 1 changed, 0 removed");
  });
  it("offers only the standard kinds not yet created, and names a custom list", () => {
    const std = [{ kind: "unit", label: "Unit", created: true }, { kind: "currency", label: "Currency", created: false }, { kind: "status", label: "Status", created: false }];
    expect(addableKinds(std, ["status"]).map((k) => k.kind)).toEqual(["currency"]);
    expect(newCustomList("Region", [])).toMatchObject({ kind: "custom:region", label: "Region" });
    expect(newCustomList("  ", [])).toEqual({ problem: "Give the list a name." });
    expect(newCustomList("Region", ["custom:region"])).toMatchObject({ problem: expect.stringContaining("already exists") });
  });
});

// ── Render checks (closed-state markup) ─────────────────────────────────────

describe("the Fields view", () => {
  const noop = () => undefined;
  const block = (over: object = {}) => html(el(FieldBlock, {
    title: "Header data", block: "header", rows: viewRows(rows().header, src), targets: tgt, errors: {}, onTarget: noop, onConvert: noop, onAccept: noop, onRemove: noop, onAdd: noop, ...over,
  }));
  it("is a table of BPMSquare field, ERP field and Convert, with label and technical name, Not sent first", () => {
    const out = block();
    expect(out).toContain("<th>BPMSquare field</th><th>ERP field</th><th>Convert</th>");
    expect(out).toContain("Reference");
    expect(out).toContain(">ref<");
    expect(out).toContain('<option value="">Not sent</option>');
    expect(out).toContain("Standard");
    expect(out).toContain("Currency list");
  });
  it("shows a proposed line's confidence in a word with Accept, and flags a new target field", () => {
    const out = block();
    expect(out).toContain(">Sure<");
    expect(out).toContain("Accept Currency");
    expect(out).toContain("(new)");
  });
  it("shows a refused row's message beside it, and reads 'ERP source field' inbound", () => {
    expect(block({ errors: { p1: "Not a field of the target." } })).toContain("Not a field of the target.");
    expect(block({ inbound: true })).toContain("ERP source field");
    expect(block({ inbound: true })).toContain("Not read");
  });
  it("cuts the unmapped fields to a few and offers Show all", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: "text" as const, custom: true }));
    const v = viewRows([], many);
    expect(visibleRows(v, false, 12).hidden).toBe(8);
    expect(visibleRows(v, true).hidden).toBe(0);
    expect(block({ rows: v })).toContain("Show all 20 fields");
  });
  it("sums the schema up in one bar with Fetch fields and the chips", () => {
    const out = html(el(SchemaBar, { bar: { count: "112 fields", fetched: "today 14:02", fresh: 3, gone: 0 }, automatic: false, busy: false, onFetch: noop }));
    expect(out).toContain("112 fields");
    expect(out).toContain("fetched today 14:02");
    expect(out).toContain("3 new");
    expect(out).toContain("Fetch fields");
    expect(html(el(SchemaBar, { bar: { count: "9 fields", fetched: null, fresh: 0, gone: 0 }, automatic: true, busy: false, onFetch: noop }))).toContain("fetched automatically");
  });
  it("lists AI suggestions one by one, each with its own Accept, and nothing added until asked", () => {
    const out = html(el(AiReviewSheet, {
      suggestions: [{ source: "valid_until", target: "effectiveto", reason: "Both are end dates.", convert: null, block: "header" }],
      labels: { source: () => "Valid until", target: () => "Effective to" }, usagePercent: 12, onApply: noop, onClose: noop,
    }));
    expect(out).toContain("Valid until");
    expect(out).toContain("Effective to");
    expect(out).toContain("Both are end dates.");
    expect(out).toContain("12% of this month");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Add accepted lines \(0\)</);
  });
  it("shows Try it in words first and the exact body behind a toggle", () => {
    const out = html(el(TryResultView, { result: { words: ["Customer Acme", "2 lines"], request: { method: "POST", url: "https://x", headers: ["X-Api-Key"], body: { a: 1 } }, problems: [{ code: "value_unmapped", message: "Unit 'Mtr' has no ERP code.", fix: "Add it in Mapping." }] } }));
    expect(out).toContain("Customer Acme");
    expect(out).toContain("Unit &#x27;Mtr&#x27; has no ERP code.");
    expect(out).toContain("Show the exact body");
    expect(out).not.toContain("https://x");
  });
});

describe("the Value mapping view", () => {
  const draft = draftOf({ kind: "unit", label: "Unit", rows: [{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Box", erp: "", inbound: false }], default_in: "Nos" });
  const out = html(el(ListTable, { draft, counts: { rows: 2, unused: 1, unmapped: 1 }, unmapped: { out: ["Mtr"], in: ["BX"] }, onChange: () => undefined }));
  it("is a two-column table with the In radio, a red row for a value without a code, and the default for unknown inbound", () => {
    expect(out).toContain("BPMSquare value");
    expect(out).toContain("ERP code");
    expect(out).toContain('type="radio"');
    expect(out).toContain("Needs a code");
    expect(out).toContain("Default for unknown inbound");
    expect(out).toContain("Keep the code");
    expect(out).toContain("2 rows · 1 unused · 1 unmapped");
  });
  it("offers each unmapped value as an Add row shortcut", () => {
    expect(out).toContain("Mtr");
    expect(out).toContain("BX");
    expect(out.match(/Add row/g)?.length).toBe(3);
  });
});
