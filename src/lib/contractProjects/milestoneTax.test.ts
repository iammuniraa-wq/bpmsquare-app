import { describe, expect, it } from "vitest";
import { resolveMilestoneTax, taxBasisText, taxNote, taxOn } from "./milestoneTax";
import { invoiceBody } from "./milestones";

// Tax on an invoicing milestone. The invoice is made with the milestone amount as the NET line (the invoices object stores net lines for every
// creator); these tests hold which tax is said to come on top, the figures, and the plain "no tax configured".

const fmt = (n: number) => `SAR ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SA = { einvoicing: true, tax: undefined };

describe("which tax comes on top", () => {
  it("a Saudi e-invoicing workspace adds VAT at the standard 15 percent, whatever the tax setting says", () => {
    expect(resolveMilestoneTax(SA)).toEqual({ kind: "added", label: "VAT", rate: 15, source: "einvoice" });
    expect(resolveMilestoneTax({ einvoicing: true, tax: { label: "GST", rate: 18, inclusive: false } })).toEqual({ kind: "added", label: "VAT", rate: 15, source: "einvoice" });
  });
  it("any other workspace adds what its tax setting says", () => {
    expect(resolveMilestoneTax({ einvoicing: false, tax: { label: "GST", rate: 18, inclusive: false } })).toEqual({ kind: "added", label: "GST", rate: 18, source: "workspace" });
    expect(resolveMilestoneTax({ einvoicing: false, tax: { label: " ", rate: "12", inclusive: false } })).toEqual({ kind: "added", label: "Tax", rate: 12, source: "workspace" });
  });
  it("a setting that says amounts include tax adds nothing", () => {
    expect(resolveMilestoneTax({ einvoicing: false, tax: { label: "VAT", rate: 5, inclusive: true } })).toEqual({ kind: "included", label: "VAT", rate: 5 });
  });
  it("no setting, no rate or a zero rate is 'no tax configured'", () => {
    expect(resolveMilestoneTax({ einvoicing: false, tax: undefined })).toEqual({ kind: "none" });
    expect(resolveMilestoneTax({ einvoicing: false, tax: null })).toEqual({ kind: "none" });
    expect(resolveMilestoneTax({ einvoicing: false, tax: { label: "GST", rate: 0, inclusive: false } })).toEqual({ kind: "none" });
    expect(resolveMilestoneTax({ einvoicing: false, tax: { label: "GST", rate: "abc" } })).toEqual({ kind: "none" });
  });
});

describe("the figures", () => {
  it("INR 292,275 (20 percent of 1,461,374) with Saudi VAT: 43,841.25 on top, 336,116.25 in all", () => {
    const t = resolveMilestoneTax(SA);
    expect(taxOn(292_275, t)).toEqual({ tax: 43_841.25, gross: 336_116.25 });
  });
  it("rounds to two places and adds nothing where tax is included or not set", () => {
    expect(taxOn(100.01, { kind: "added", label: "VAT", rate: 15, source: "einvoice" })).toEqual({ tax: 15, gross: 115.01 });
    expect(taxOn(500, { kind: "included", label: "VAT", rate: 5 })).toEqual({ tax: 0, gross: 500 });
    expect(taxOn(500, { kind: "none" })).toEqual({ tax: 0, gross: 500 });
  });
});

describe("what the row, the panel and the invoice notes say", () => {
  it("the basis line says what the shown amount is before", () => {
    expect(taxBasisText(resolveMilestoneTax(SA))).toBe("Before VAT 15%");
    expect(taxBasisText({ kind: "included", label: "VAT", rate: 5 })).toBe("Includes VAT 5%");
    expect(taxBasisText({ kind: "none" })).toBe("No tax configured");
  });
  it("the note carries the three figures when tax is added, and says plainly when none is set", () => {
    const note = taxNote(resolveMilestoneTax(SA), 292_275, fmt);
    expect(note).toBe("Amount before VAT: SAR 292,275.00. VAT 15%: SAR 43,841.25. Total with VAT: SAR 336,116.25.");
    expect(taxNote({ kind: "none" }, 292_275, fmt)).toBe("No tax configured for this workspace, so none is added.");
    expect(taxNote({ kind: "included", label: "VAT", rate: 5 }, 100, fmt)).toBe("Amount includes VAT 5%.");
  });
  it("the invoice body keeps the net amount as the one line and puts the tax note after the project note", () => {
    const body = invoiceBody({
      accountId: "a", projectRef: "CPR-0001", projectName: "Riyadh villas", milestone: { title: "Advance", due_date: null }, amount: 292_275,
      taxNote: taxNote(resolveMilestoneTax(SA), 292_275, fmt),
    });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ qty: 1, rate: 292_275 });
    expect(body.notes).toBe("Contract project CPR-0001 Riyadh villas · milestone: Advance. Amount before VAT: SAR 292,275.00. VAT 15%: SAR 43,841.25. Total with VAT: SAR 336,116.25.");
    expect(invoiceBody({ accountId: "a", projectRef: null, projectName: "P", milestone: { title: "M", due_date: null }, amount: 1 }).notes).toBe("Contract project P · milestone: M");
  });
});
