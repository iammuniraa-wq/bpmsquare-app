import { describe, expect, it } from "vitest";
import { listKindFor, normaliseName, propose, typeCompat } from "./propose";
import type { MapRow, SourceField, TargetField } from "./types";

const S = (key: string, type: SourceField["type"] = "text", label = key.replace(/_/g, " ")): SourceField => ({ key, label, type, custom: key.startsWith("cf_") });
const T = (path: string, type: TargetField["type"] = "text", over: Partial<TargetField> = {}): TargetField => ({
  path, label: over.label ?? path, type, required: false, creatable: true, ...over,
});

const quoteSource: SourceField[] = [
  S("name"), S("ref"), S("title"), S("customer_name"), S("description"), S("total", "number"), S("valid_until", "date"), S("currency", "enum"),
];

describe("normaliseName", () => {
  it("strips custom prefixes on the target side only", () => {
    expect(normaliseName("msdyn_subject", "target")).toBe("subject");
    expect(normaliseName("new_sitecode", "target")).toBe("site");
    expect(normaliseName("cr1a2_discount", "target")).toBe("discount");
    expect(normaliseName("address1_city", "target")).toBe("city");
    expect(normaliseName("customer_name", "source")).toBe("customername");
    expect(normaliseName("cf_site_code", "source")).toBe("site");
  });
  it("drops @odata.bind, a leading underscore, _value and a trailing id or code", () => {
    expect(normaliseName("customerid_account@odata.bind", "target")).toBe("customer");
    expect(normaliseName("_customerid_value", "target")).toBe("customer");
    expect(normaliseName("transactioncurrencyid", "target")).toBe("transactioncurrency");
    expect(normaliseName("uomcode", "target")).toBe("uom");
  });
  it("does not mistake the words of a PascalCase name for a prefix, and keeps short names whole", () => {
    expect(normaliseName("ProductNumber", "target")).toBe("productnumber");
    expect(normaliseName("id", "target")).toBe("id");
    expect(normaliseName("code", "source")).toBe("code");
  });
});

describe("typeCompat", () => {
  it("same family needs no converter", () => {
    expect(typeCompat("text", "text")).toEqual({ score: 1, convert: null });
    expect(typeCompat("number", "number")).toEqual({ score: 1, convert: null });
  });
  it("convertible pairs get their converter", () => {
    expect(typeCompat("text", "number")).toMatchObject({ score: 0.8, convert: { kind: "number" } });
    expect(typeCompat("number", "text")).toMatchObject({ score: 0.8, convert: { kind: "number", asText: true } });
    expect(typeCompat("date", "text")).toMatchObject({ convert: { kind: "date", format: "iso-date" } });
    expect(typeCompat("text", "enum", "unit")).toMatchObject({ convert: { kind: "value_list", list: "unit" } });
  });
  it("arrays, objects and lookups never fit a scalar", () => {
    for (const t of ["array", "object", "lookup"] as const) {
      expect(typeCompat("text", t).score).toBe(0);
      expect(typeCompat(t, "text").score).toBe(0);
    }
    expect(typeCompat("text", "boolean").score).toBe(0);
  });
});

describe("propose", () => {
  const target: TargetField[] = [
    T("name", "text", { required: true }), T("description", "text"), T("totalamount", "number"), T("effectiveto", "datetime"),
    T("transactioncurrencyid", "enum", { label: "Currency", enum: ["INR", "USD", "EUR"] }), T("msdyn_subject", "text", { label: "Subject" }),
    T("customerid", "lookup", { lookup: "account" }), T("pricelevelid", "lookup", { required: true, label: "Price list" }),
  ];

  it("matches by name, label, known pair and shared word, with confidence words", () => {
    const r = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out" });
    const by = Object.fromEntries(r.rows.map((x) => [x.target, x]));
    expect(by.name).toMatchObject({ source: "name", confidence: "sure", origin: "proposed", convert: null });
    expect(by.description).toMatchObject({ source: "description", confidence: "sure" });
    expect(by.totalamount).toMatchObject({ source: "total", confidence: "likely" });
    expect(by.effectiveto).toMatchObject({ source: "valid_until", confidence: "likely", convert: { kind: "date", format: "iso-datetime" } });
    expect(by.transactioncurrencyid).toMatchObject({ source: "currency", convert: { kind: "value_list", list: "currency" } });
  });

  it("never proposes a scalar into a lookup, and flags the required field nobody fills", () => {
    const r = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out" });
    expect(r.rows.find((x) => x.target === "customerid")).toBeUndefined();
    expect(r.missingRequired).toEqual(["Price list"]);
  });

  it("fields the engine sets itself are not reported missing", () => {
    const r = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out", engineSets: ["pricelevelid"] });
    expect(r.missingRequired).toEqual([]);
  });

  it("uses each target and each source once", () => {
    const r = propose({ source: [S("name"), S("title")], target: [T("name"), T("msdyn_subject", "text", { label: "Subject" })], existing: [], mode: "fill", direction: "out" });
    expect(new Set(r.rows.map((x) => x.target)).size).toBe(r.rows.length);
    expect(new Set(r.rows.map((x) => x.source)).size).toBe(r.rows.length);
    expect(r.rows.find((x) => x.target === "name")?.source).toBe("name");
    expect(r.rows.find((x) => x.target === "msdyn_subject")?.source).toBe("title");
  });

  it("is deterministic: the same input twice gives identical rows, whatever order the lists arrive in", () => {
    const a = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out" });
    const b = propose({ source: [...quoteSource].reverse(), target: [...target].reverse(), existing: [], mode: "fill", direction: "out" });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("fill keeps rows already there and only fills the empty ones; replace starts again", () => {
    const mine: MapRow = { id: "u1", target: "description", source: "title", convert: null, ifEmpty: null, origin: "user", confidence: null };
    const fill = propose({ source: quoteSource, target, existing: [mine], mode: "fill", direction: "out" });
    expect(fill.rows.find((x) => x.target === "description")).toEqual(mine);
    expect(fill.rows.some((x) => x.target === "msdyn_subject" && x.source === "title")).toBe(false);
    const replace = propose({ source: quoteSource, target, existing: [mine], mode: "replace", direction: "out" });
    expect(replace.rows.find((x) => x.target === "description")?.source).toBe("description");
  });

  it("an enum target proposes a value list: the ERP's own values, matched to BPMSquare's by name", () => {
    const r = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out", known: { currency: ["INR", "USD", "AED"] } });
    expect(r.lists).toHaveLength(1);
    expect(r.lists[0]).toMatchObject({ kind: "currency", proposed: true });
    expect(r.lists[0].rows).toEqual([
      { bpm: "INR", erp: "INR", inbound: true }, { bpm: "USD", erp: "USD", inbound: true }, { bpm: "", erp: "EUR", inbound: true },
    ]);
  });

  it("does not propose a list that already exists", () => {
    const r = propose({ source: quoteSource, target, existing: [], mode: "fill", direction: "out", existingLists: ["currency"] });
    expect(r.lists).toEqual([]);
  });

  it("lines: quantity, unit and rate by their known pairs", () => {
    const src = [S("description"), S("qty", "number"), S("rate", "number"), S("uom", "enum")];
    const tgt = [T("productdescription"), T("quantity", "number"), T("priceperunit", "number"), T("uomcode", "enum", { enum: ["EA", "M"] })];
    const r = propose({ source: src, target: tgt, existing: [], mode: "fill", direction: "out" });
    const by = Object.fromEntries(r.rows.map((x) => [x.target, x.source]));
    expect(by).toMatchObject({ quantity: "qty", priceperunit: "rate", uomcode: "uom", productdescription: "description" });
    expect(r.rows.find((x) => x.target === "uomcode")?.convert).toEqual({ kind: "value_list", list: "unit" });
  });

  it("inbound proposes only converters that can be read back", () => {
    const src = [S("name"), S("city")];
    const tgt = [T("name"), T("address1_city"), T("telephone1")];
    const r = propose({ source: [...src, S("phone")], target: tgt, existing: [], mode: "fill", direction: "in" });
    expect(r.rows.map((x) => [x.target, x.source])).toEqual([["address1_city", "city"], ["name", "name"], ["telephone1", "phone"]]);
    // boolean -> text has a converter that is reversible, a split or concat never is proposed at all
    for (const x of r.rows) expect(["constant", "concat", "split"]).not.toContain(x.convert?.kind);
  });

  it("a field the ERP no longer has or cannot create is never proposed", () => {
    const r = propose({ source: [S("name")], target: [T("name", "text", { state: "missing" }), T("other", "text", { creatable: false })], existing: [], mode: "fill", direction: "out" });
    expect(r.rows).toEqual([]);
  });

  it("a custom field matches by its words", () => {
    const r = propose({ source: [S("cf_site_code", "text", "Site code")], target: [T("new_sitecode", "text", { label: "Site Code" })], existing: [], mode: "fill", direction: "out" });
    expect(r.rows[0]).toMatchObject({ target: "new_sitecode", source: "cf_site_code", confidence: "sure" });
  });
});

describe("listKindFor", () => {
  it("names the standard kinds from the field, a custom kind otherwise", () => {
    expect(listKindFor({ path: "uomid", label: "Unit" })).toBe("unit");
    expect(listKindFor({ path: "transactioncurrencyid", label: "Currency" })).toBe("currency");
    expect(listKindFor({ path: "address1_country", label: "Country" })).toBe("country");
    expect(listKindFor({ path: "paymenttermscode", label: "Payment Terms" })).toBe("payment_terms");
    expect(listKindFor({ path: "msdyn_incoterms", label: "Incoterms" })).toBe("incoterms");
    expect(listKindFor({ path: "statuscode", label: "Status Reason" })).toBe("status");
    expect(listKindFor({ path: "new_SiteType@odata.bind", label: "Site type" })).toBe("custom:new_sitetype");
  });
});
