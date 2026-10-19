import { describe, it, expect } from "vitest";
import { validateOriginInput, checkSourceLineIds, quoteLabel, itemsSummary, searchText, originHref, isDocumentOrigin } from "./linking";

const A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const B = "11111111-2222-4333-8444-555555555555";

describe("validateOriginInput", () => {
  it("lets a manual RFQ stand without a record", () => {
    expect(validateOriginInput("manual", null)).toBeNull();
    expect(validateOriginInput("pricing", undefined)).toBeNull();
  });
  it("requires the record for every document origin", () => {
    for (const t of ["standard_quote", "quote", "opportunity", "case", "work_order", "fence_project", "inspection_report"] as const) {
      expect(validateOriginInput(t, null)).toMatch(/must be linked/);
      expect(validateOriginInput(t, "")).toMatch(/must be linked/);
      expect(validateOriginInput(t, A)).toBeNull();
    }
  });
  it("rejects an id that is not a uuid", () => {
    expect(validateOriginInput("quote", "SQ-0007")).toMatch(/not valid/);
    expect(validateOriginInput("quote", "1; drop table")).toMatch(/not valid/);
  });
});

describe("checkSourceLineIds", () => {
  it("accepts none, and ignores blanks", () => {
    expect(checkSourceLineIds("standard_quote", [{}, { source_line_id: null }, { source_line_id: "" }])).toEqual({ ok: true, ids: [] });
    expect(checkSourceLineIds("manual", [{ source_line_id: null }])).toEqual({ ok: true, ids: [] });
  });
  it("returns the ids of a quote, standard quote or deal", () => {
    expect(checkSourceLineIds("quote", [{ source_line_id: A }, { source_line_id: B }])).toEqual({ ok: true, ids: [A, B] });
    expect(checkSourceLineIds("opportunity", [{ source_line_id: A }]).ok).toBe(true);
  });
  it("refuses duplicates, bad ids, and origins that have no document lines", () => {
    expect(checkSourceLineIds("quote", [{ source_line_id: A }, { source_line_id: A.toUpperCase() }]).ok).toBe(false);
    expect(checkSourceLineIds("quote", [{ source_line_id: "abc" }]).ok).toBe(false);
    expect(checkSourceLineIds("manual", [{ source_line_id: A }]).ok).toBe(false);
    expect(checkSourceLineIds("case", [{ source_line_id: A }]).ok).toBe(false);
  });
});

describe("labels", () => {
  it("builds the quote label, or says there is none", () => {
    expect(quoteLabel("standard_quote", "SQ-0007")).toBe("Standard Quote SQ-0007");
    expect(quoteLabel("quote", "QT-12")).toBe("Quotation QT-12");
    expect(quoteLabel("opportunity", null)).toBe("Deal");
    expect(quoteLabel("manual", "ignored")).toBe("No quote");
  });
  it("summarises the items as first plus how many more", () => {
    expect(itemsSummary([])).toBe("—");
    expect(itemsSummary(["PTFE sheet"])).toBe("PTFE sheet");
    expect(itemsSummary(["PTFE sheet", " ", "Gasket", "Bolt"])).toBe("PTFE sheet +2");
  });
  it("searches on ref, title, quote label and every item", () => {
    const t = searchText({ ref: "RFQ-0012", title: "PTFE sheet + 1 more", origin_type: "standard_quote", origin_label: "SQ-0007", item_names: ["PTFE sheet", "Gasket 50mm"] });
    for (const q of ["rfq-0012", "sq-0007", "standard quote", "gasket"]) expect(t).toContain(q);
    expect(searchText({ title: "x", origin_type: "manual" })).toContain("no quote");
  });
  it("links to the origin record", () => {
    expect(originHref("standard_quote", A)).toBe(`/standard-quotes/${A}`);
    expect(originHref("quote", A)).toBe(`/quotations/${A}`);
    expect(originHref("manual", A)).toBeNull();
    expect(originHref("quote", null)).toBeNull();
    expect(isDocumentOrigin("manual")).toBe(false);
  });
});
