import { describe, it, expect } from "vitest";
import { DEFAULT_PDF_DESIGN, sanitizePdfDesign } from "./design";
import { resolvePdfFrame, revisionText, type FrameInput } from "./frame";
import { readPdfDesign, pickEntity } from "./frameServer";
import { tipTextProblems } from "@/lib/infoTip";
import { PDF_TIPS } from "./tips";
import { cleanExtraIds } from "./extraIds";
import type { TenantEntity } from "@/lib/constants";

const entity: TenantEntity = {
  id: "e1", name: "Acme <Co>", short_name: "AC", name_ar: "شركة", address: "1 Road\nBox 5", phone: "+1 2", email: "a@x.test", crn: "123", vat_number: "999", is_default: true,
  extra_ids: [
    { id: "always1", label: "Cert no.", value: "C-1", print: "always" },
    { id: "vendor1", label: "Vendor no.", value: "100 428 64", print: "selected_customers" },
  ],
};
const input = (over: Partial<FrameInput> = {}): FrameInput => ({
  design: DEFAULT_PDF_DESIGN, entity, companyInfo: { name: "Acme", web: "acme.test" }, tenantName: "Acme", logoDataUri: null, printIds: [],
  title: "QUOTATION", referenceLabel: "RFQ #", reference: "167 / 2026", revision: null, fonts: null, ...over,
});

describe("resolvePdfFrame", () => {
  it("returns null for a workspace with no design, so every renderer keeps today's path", () => {
    expect(resolvePdfFrame(input({ design: null }))).toBeNull();
    expect(resolvePdfFrame(input({ design: undefined }))).toBeNull();
    expect(readPdfDesign({})).toBeNull();
    expect(readPdfDesign(undefined)).toBeNull();
    expect(readPdfDesign({ pdf_design: undefined })).toBeNull();
  });

  it("prints an id marked for selected customers only for the accounts that ticked it, and an 'always' id for everyone", () => {
    const without = resolvePdfFrame(input())!;
    expect(without.headerHtml).toContain("C-1");
    expect(without.headerHtml).not.toContain("100 428 64");
    const withTick = resolvePdfFrame(input({ printIds: ["vendor1"] }))!;
    expect(withTick.headerHtml).toContain("100 428 64");
    expect(withTick.headerHtml).toContain("Vendor no.");
  });

  it("escapes every value it prints and marks tenant text for automatic direction", () => {
    const f = resolvePdfFrame(input({ title: "<script>x</script>", reference: '"><img src=x>' }))!;
    expect(f.headerHtml).not.toContain("<script>");
    expect(f.headerHtml).not.toContain("<img src=x>");
    expect(f.headerHtml).toContain("Acme &lt;Co&gt;");
    expect(f.headerHtml).toContain('dir="auto"');
    expect(f.headerHtml).toContain("شركة");
  });

  it("prints the revision beside the reference when the workspace keeps revisions", () => {
    expect(revisionText(0)).toBe("Rev. No. 00");
    expect(revisionText(12)).toBe("Rev. No. 12");
    expect(revisionText(null)).toBeNull();
    expect(resolvePdfFrame(input({ revision: "Rev. No. 02" }))!.headerHtml).toContain("RFQ # 167 / 2026 Rev. No. 02");
    expect(resolvePdfFrame(input())!.headerHtml).not.toContain("Rev. No.");
  });

  it("keeps the footer to the entity's own details and a Page X of Y field", () => {
    const f = resolvePdfFrame(input())!;
    expect(f.footerHtml).toContain("C.R. No.:");
    expect(f.footerHtml).toContain("VAT No.:");
    expect(f.footerHtml).toContain("acme.test");
    expect(f.footerHtml).toContain('class="pageNumber"');
    expect(f.footerHtml).toContain('class="totalPages"');
    expect(resolvePdfFrame(input({ design: { ...DEFAULT_PDF_DESIGN, footer: { ...DEFAULT_PDF_DESIGN.footer, page_numbers: false } } }))!.footerHtml).not.toContain("pageNumber");
  });

  it("never lets the header or footer outgrow its margin", () => {
    const small = resolvePdfFrame(input({ design: { ...DEFAULT_PDF_DESIGN, page: { ...DEFAULT_PDF_DESIGN.page, margins_mm: { top: 20, right: 12, bottom: 14, left: 19 } } } }))!;
    expect(small.marginsMm.top).toBeGreaterThanOrEqual(30);
    expect(small.marginsMm.bottom).toBeGreaterThanOrEqual(16);
    expect(small.marginsMm.left).toBe(19);
  });

  it("uses the bundled font only when it is handed over, and A4 or Letter as chosen", () => {
    expect(resolvePdfFrame(input())!.headerHtml).not.toContain("@font-face");
    expect(resolvePdfFrame(input({ fonts: { regular: "data:font/woff2;base64,AA", bold: "data:font/woff2;base64,BB" } }))!.headerHtml).toContain("@font-face");
    expect(resolvePdfFrame(input({ design: { ...DEFAULT_PDF_DESIGN, page: { ...DEFAULT_PDF_DESIGN.page, size: "Letter" } } }))!.pageFormat).toBe("Letter");
  });

  it("scopes its class names so the Settings preview cannot restyle the app", () => {
    const f = resolvePdfFrame(input())!;
    const css = f.previewHeaderHtml + f.previewFooterHtml;
    expect(css).not.toMatch(/\.band\{|\.row\{|\.cols\{|\.strip\{/);
    expect(css).toContain(".pfh-band{");
  });
});

describe("sanitizePdfDesign", () => {
  it("clamps numbers, refuses bad colours, drops unknown tokens", () => {
    const d = sanitizePdfDesign({
      page: { size: "Legal", margins_mm: { top: 999, right: -5, bottom: "x", left: 19 } }, font: "comic", base_pt: 12,
      colors: { band: "red", text: "#ABCDEF" }, header: { logo: "diagonal", logo_height_mm: 1000, lines: ["extra_ids", "<script>", "text:Hello", "extra_ids"] },
      footer: { left: ["address", "nope"], strip: ["#112233", "blue"] },
    })!;
    expect(d.page.size).toBe("A4");
    expect(d.page.margins_mm).toEqual({ top: 60, right: 8, bottom: DEFAULT_PDF_DESIGN.page.margins_mm.bottom, left: 19 });
    expect(d.font).toBe("arial_like");
    expect(d.base_pt).toBe(10);
    expect(d.colors.band).toBe(DEFAULT_PDF_DESIGN.colors.band);
    expect(d.colors.text).toBe("#abcdef");
    expect(d.header.logo).toBe("left");
    expect(d.header.logo_height_mm).toBe(30);
    expect(d.header.lines).toEqual(["extra_ids", "text:Hello"]);
    expect(d.footer.left).toEqual(["address"]);
    expect(d.footer.strip).toEqual(["#112233"]);
  });
  it("is not a design for anything that is not an object", () => {
    for (const v of [null, undefined, "x", 3, [], true]) expect(sanitizePdfDesign(v)).toBeNull();
  });
  it("accepts its own default unchanged", () => {
    expect(sanitizePdfDesign(DEFAULT_PDF_DESIGN)).toEqual(DEFAULT_PDF_DESIGN);
  });
});

describe("entities", () => {
  it("picks the named entity, else the default, else the first, else none", () => {
    const a = { ...entity, id: "a", is_default: false };
    const b = { ...entity, id: "b", is_default: true };
    expect(pickEntity({ entities: [a, b] }, "a")?.id).toBe("a");
    expect(pickEntity({ entities: [a, b] }, "zzz")?.id).toBe("b");
    expect(pickEntity({ entities: [a] }, null)?.id).toBe("a");
    expect(pickEntity({ entities: [] }, null)).toBeNull();
    expect(pickEntity(undefined, null)).toBeNull();
  });
  it("cleans extra ids: needs label and value, a known print rule, at most six", () => {
    const out = cleanExtraIds([{ id: "k1", label: " Vendor ", value: "1 2", print: "always" }, { label: "", value: "x" }, { id: "k1", label: "Dup", value: "y", print: "nope" }, "junk"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: "k1", label: "Vendor", value: "1 2", print: "always" });
    expect(out[1].id).not.toBe("k1");
    expect(out[1].print).toBe("selected_customers");
    expect(cleanExtraIds("x")).toEqual([]);
    expect(cleanExtraIds(Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, value: `${i}` })))).toHaveLength(6);
  });
});

describe("the explanations behind the i", () => {
  it("every PDF documents tip holds to the limit", () => {
    for (const [k, v] of Object.entries(PDF_TIPS)) expect(tipTextProblems(v), k).toEqual([]);
  });
});
