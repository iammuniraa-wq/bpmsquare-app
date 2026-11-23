import { describe, it, expect } from "vitest";
import { boqTotalLabel, cleanDocSections, editableSections, frameTitleParts, frontValue, letterFor, resolveFramedBlocks } from "./framedQuote";
import { sanitizeStandardQuoteBlocks, layoutTooLarge, cleanBlockData } from "@/lib/standardQuoteTemplateBlocks";
import { PCBS_BLOCKS, PCBS_SAMPLE_DOC_SECTIONS } from "../../../scripts/pcbs-pdf-design.data";
import type { Account, Contact, DocSections, StandardQuote, StandardQuoteTemplateBlock } from "@/lib/types";

describe("lettering", () => {
  it("letters A, B ... Z, AA", () => {
    expect([0, 1, 25, 26, 27].map(letterFor)).toEqual(["A", "B", "Z", "AA", "AB"]);
  });

  it("letters the visible sections in order and numbers each matrix under the last item before it (C2.1, C2.2 ...)", () => {
    const r = resolveFramedBlocks(PCBS_BLOCKS, PCBS_SAMPLE_DOC_SECTIONS);
    const letters = r.filter((x) => x.kind === "section").map((x) => (x.kind === "section" ? `${x.section.letter}:${x.section.data.title}` : ""));
    expect(letters.slice(0, 4)).toEqual(["A:IMPORTANT INFORMATION", "B:REQUIREMENTS, SPECIFICATIONS AND CRITERIA", "C:SCOPE OF WORK", "D:PRICE / BILL OF QUANTITY"]);
    const numbers = r.filter((x) => x.kind === "matrix").map((x) => (x.kind === "matrix" ? x.matrix.number : ""));
    expect(numbers).toEqual(["C2.1", "C2.2", "C2.3", "C2.4"]);
  });

  it("closes the letters up when an optional section is left out of one quotation", () => {
    const blocks: StandardQuoteTemplateBlock[] = [
      { id: "s1", type: "clause_section", visible: true, data: { title: "ONE", numbered: false, items: [] } },
      { id: "s2", type: "clause_section", visible: true, data: { title: "TWO", numbered: false, items: [], optional: true } },
      { id: "s3", type: "clause_section", visible: true, data: { title: "THREE", numbered: false, items: [] } },
    ];
    const letters = (doc: DocSections) => resolveFramedBlocks(blocks, doc).map((x) => (x.kind === "section" ? `${x.section.letter}${x.section.data.title}` : ""));
    expect(letters({})).toEqual(["AONE", "BTWO", "CTHREE"]);
    expect(letters({ s2: { hidden: true } })).toEqual(["AONE", "BTHREE"]);
    // Only a section the layout marks optional can be hidden.
    expect(cleanDocSections({ s1: { hidden: true }, s2: { hidden: true } }, blocks)).toEqual({ s2: { hidden: true } });
  });

  it("folds the quotation's own text over the fixed layout text, only for items marked to edit", () => {
    const r = resolveFramedBlocks(PCBS_BLOCKS, { "sec-b": { items: { b1: { text: "Per quotation" }, b2: { text: "NOT ALLOWED" } } } });
    const b = r.find((x) => x.kind === "section" && x.section.block.id === "sec-b");
    if (!b || b.kind !== "section") throw new Error("section B missing");
    expect(b.section.items.find((i) => i.id === "b1")?.text).toBe("Per quotation");
    expect(b.section.items.find((i) => i.id === "b2")?.text).toContain("PCBS will design the precast elements");
  });

  it("collapses a part that does not apply to one row with its reason", () => {
    const r = resolveFramedBlocks(PCBS_BLOCKS, PCBS_SAMPLE_DOC_SECTIONS).filter((x) => x.kind === "matrix");
    const del = r.find((x) => x.kind === "matrix" && x.matrix.block.id === "mx-del");
    if (!del || del.kind !== "matrix") throw new Error("missing");
    expect(del.matrix.applicable).toBe(false);
    expect(del.matrix.reason).toBe("N/A");
  });
});

describe("per-quotation sections are validated", () => {
  it("keeps known ids only and clamps text", () => {
    const clean = cleanDocSections({
      "mx-prod": { ticks: { r1: 0, r2: 2, nope: 1, r3: 7 }, remarks: { r5: "x".repeat(900), zzz: "no" }, extra_rows: [{ text: "Extra" }, { text: "" }], not_applicable: undefined },
      unknown: { hidden: true },
      "sec-b": { items: { b1: { text: "t", sub: ["a", "", "b"] }, b2: { text: "fixed, ignored" }, bogus: { text: "x" } } },
    }, PCBS_BLOCKS);
    expect(Object.keys(clean).sort()).toEqual(["mx-prod", "sec-b"]);
    expect(clean["mx-prod"].ticks).toEqual({ r1: 0, r2: 2 });
    expect(clean["mx-prod"].remarks?.r5).toHaveLength(300);
    expect(clean["mx-prod"].extra_rows).toEqual([{ id: "x1", text: "Extra" }]);
    expect(clean["sec-b"].items).toEqual({ b1: { text: "t", sub: ["a", "b"] } });
  });
  it("is empty for anything that is not an object", () => {
    expect(cleanDocSections("x", PCBS_BLOCKS)).toEqual({});
    expect(cleanDocSections(null, PCBS_BLOCKS)).toEqual({});
  });
  it("offers the Document tab only the sections that are editable", () => {
    const ids = editableSections(PCBS_BLOCKS).map((e) => e.block.id);
    expect(ids).toContain("sec-b");
    expect(ids).toContain("mx-eng");
    expect(ids).not.toContain("sec-a");
    expect(ids).not.toContain("sec-h");
  });
});

describe("the BOQ total row and the front block", () => {
  it("expands the label with the total quantity and the unit", () => {
    expect(boqTotalLabel("TOTAL AMOUNT FOR {QTY} {UOM}", [{ qty: 400, uom: "PCS" }])).toBe("TOTAL AMOUNT FOR 400 PCS");
    expect(boqTotalLabel("TOTAL AMOUNT FOR {QTY} {UOM}", [{ qty: 1, uom: "M" }, { qty: 2.5, uom: "EA" }])).toBe("TOTAL AMOUNT FOR 3.5");
    expect(boqTotalLabel(undefined, [])).toBe("TOTAL");
  });
  it("reads the title band from the layout, defaulting to QUOTATION", () => {
    expect(frameTitleParts(PCBS_BLOCKS)).toEqual({ title: "QUOTATION", referenceLabel: "RFQ #" });
    expect(frameTitleParts([])).toEqual({ title: "QUOTATION", referenceLabel: "" });
  });
  it("shows what the record holds, nothing from another record", () => {
    const quote = { ref: "167 / 2026", created_at: "2026-08-10T12:00:00Z", project_title: "P", subject: "S", custom_data: { cf_site: "North" } } as unknown as StandardQuote;
    const src = { quote, account: { name: "Acme", phone: "1" } as Account, contact: { name: "Haidi", email: "h@x" } as Contact };
    expect(frontValue("date", src)).toBe("10 August 2026");
    expect(frontValue("account", src)).toBe("Acme");
    expect(frontValue("contact_email", src)).toBe("h@x");
    expect(frontValue("contact_phone", src)).toBe("");
    expect(frontValue("cf:cf_site", src)).toBe("North");
    expect(frontValue("project_title", src)).toBe("P");
  });
});

describe("layout blocks are validated", () => {
  it("lets clause sections and matrices repeat, each under its own id, and keeps every other type once", () => {
    const out = sanitizeStandardQuoteBlocks([
      { type: "clause_section", visible: true, data: { title: "A", numbered: true, items: [{ text: "x" }] } },
      { type: "clause_section", visible: true, id: "sec-keep", data: { title: "B", items: [] } },
      { type: "clause_section", visible: true, id: "sec-keep", data: { title: "C", items: [] } },
      { type: "front_block", visible: true, data: { rows: [{ label: "x", field: "subject" }, { label: "bad", field: "password" }] } },
      { type: "front_block", visible: true, data: { rows: [] } },
      { type: "nope", visible: true },
    ]);
    const secs = out.filter((b) => b.type === "clause_section");
    expect(secs).toHaveLength(3);
    expect(new Set(secs.map((s) => s.id)).size).toBe(3);
    const front = out.filter((b) => b.type === "front_block");
    expect(front).toHaveLength(1);
    expect((front[0].data as { rows: unknown[] }).rows).toHaveLength(1);
    expect(out.map((b) => b.type)).toEqual(expect.arrayContaining(["letterhead", "quote_meta", "bill_to", "line_items", "totals"]));
  });
  it("round-trips the PCBS layout unchanged", () => {
    expect(sanitizeStandardQuoteBlocks(PCBS_BLOCKS)).toEqual(PCBS_BLOCKS);
  });
  it("caps text and the size of a whole layout", () => {
    const d = cleanBlockData("clause_section", { title: "x".repeat(500), items: [{ text: "y".repeat(9000), sub: Array.from({ length: 40 }, () => "z") }] }) as { title: string; items: { text: string; sub: string[] }[] };
    expect(d.title).toHaveLength(120);
    expect(d.items[0].text).toHaveLength(4000);
    expect(d.items[0].sub).toHaveLength(14);
    expect(layoutTooLarge(PCBS_BLOCKS)).toBe(false);
    expect(layoutTooLarge([{ id: "x", type: "notes", visible: true, content: "q".repeat(160_000) }])).toBe(true);
  });
});
