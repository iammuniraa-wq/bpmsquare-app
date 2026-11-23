import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement as create, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StandardQuoteFramedBody from "@/components/StandardQuoteFramedBody";
import { PCBS_BLOCKS, PCBS_PDF_DESIGN, PCBS_SAMPLE_DOC_SECTIONS } from "../../../scripts/pcbs-pdf-design.data";
import { FRAME_FONTS, buildFrameFromSnapshot } from "./frameServer";
import { buildStandardQuoteSnapshot, snapshotForPrint } from "@/lib/revisions/snapshot";
import { resolvePdfFrame, esc } from "./frame";
import { frameTitleParts } from "./framedQuote";
import { renderPdf } from "./renderPdf";
import type { Account, Contact, StandardQuote, StandardQuoteLine } from "@/lib/types";
import type { TenantEntity } from "@/lib/constants";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;

// Renders real sample PDFs with the real browser. Skipped unless PDF_SAMPLES_DIR names a folder to write into; the
// fixtures are invented (no real customer). PDF_SAMPLE_LOGO may name a PNG to use as the logo.
const OUT = process.env.PDF_SAMPLES_DIR;
const run = OUT ? describe : describe.skip;

const entity: TenantEntity = {
  id: "e1", name: "Precast Building Systems Co. Ltd", short_name: "PCBS", name_ar: "الشركة السعودية للأنظمة الخرسانية الجاهزة", is_default: true,
  address: "Dammam Industrial Area - Al-Riyadh Highway\nP.O. Box: 32139, Al-Khobar 31952, KSA",
  phone: "+966 13 820-7480/71/72", email: "info@pcbs.com.sa", crn: "2051037037", vat_number: "305490221900003",
  extra_ids: [{ id: "v1", label: "PCBS'S ARAMCO VENDOR NO.", value: "100 428 64", print: "selected_customers" }],
};

const quote = (over: Partial<StandardQuote> = {}) => ({
  id: "q1", tenant_id: "t1", ref: "167 / 2026", account_id: "a1", contact_id: "c1", status: "sent",
  valid_until: "2026-09-30T12:00:00Z", terms: null, notes: null, subtotal: 1058000, total: 1058000,
  created_at: "2026-08-10T12:00:00Z", updated_at: "2026-08-10T12:00:00Z", sent_at: null, template_id: null,
  header_discount_pct: 0, tax_pct: 0, shipping_amount: 0, intro_text: null, inquiry_date: null, closed_at: null, print_options: null, created_by: null,
  project_title: "PRECAST FOUNDATIONS - 400 PCS", subject: "QUOTATION FOR FABRICATION (EX-FACTORY) ONLY FOR FOUNDATION", entity_id: "e1",
  ...over,
}) as unknown as StandardQuote;
const line = (n: number, d: string, qty: number, rate: number): StandardQuoteLine => ({
  id: `l${n}`, tenant_id: "t1", standard_quote_id: "q1", sl_no: String(n), description: d, uom: "No's", qty, rate, discount_pct: 0, amount: qty * rate,
  is_selected: true, show_on_pdf: true, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null,
}) as unknown as StandardQuoteLine;
const lines = [line(1, "10m High Pole Precast Foundation with Deformed Rebar\n1000 X 1000 X 1200mm base, Grey Concrete Struck-Off Mould finish as per ACI / PCI Std.", 400, 2645)];
const account = { id: "a1", name: "M/S. TEST CUSTOMER", phone: "+966 13 000 0000" } as unknown as Account;
const contact = { id: "c1", name: "HAIDI", phone: "+966 53 000 xxxx", email: "test@outlook.com" } as unknown as Contact;

function html(frameCss: string, fontCss: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}${frameCss}html,body{margin:0}</style></head><body>${body}</body></html>`;
}

async function sample(name: string, revisionNo: number | null) {
  const logoFile = process.env.PDF_SAMPLE_LOGO;
  const logo = logoFile && fs.existsSync(logoFile) ? `data:image/png;base64,${fs.readFileSync(logoFile).toString("base64")}` : null;
  const { title, referenceLabel } = frameTitleParts(PCBS_BLOCKS);
  const q = quote();
  const frame = resolvePdfFrame({
    design: PCBS_PDF_DESIGN, entity, companyInfo: { name: "PCBS", web: "www.pcbs.com.sa" }, tenantName: "PCBS", logoDataUri: logo,
    printIds: ["v1"], title, referenceLabel, reference: q.ref, revision: revisionNo === null ? null : `Rev. No. ${String(revisionNo).padStart(2, "0")}`, fonts: FRAME_FONTS,
  })!;
  const body = renderToStaticMarkup(createElement(StandardQuoteFramedBody, { quote: q, lines, account, contact, blocks: PCBS_BLOCKS, docSections: PCBS_SAMPLE_DOC_SECTIONS, currency: "SAR" }));
  const pdf = await renderPdf({ source: { kind: "html", html: html(frame.bodyCss, frame.fontFaceCss, body), timeoutMs: 30_000 }, margin: { top: "0", bottom: "0", left: "0", right: "0" }, settle: true, frame });
  fs.mkdirSync(OUT!, { recursive: true });
  fs.writeFileSync(path.join(OUT!, name), pdf);
  return pdf;
}

// Slice 2: revision 2 goes through the real path -- built into a snapshot, read back from it, framed from what it froze.
async function revisionSample(name: string, revisionNo: number) {
  const logoFile = process.env.PDF_SAMPLE_LOGO;
  const logo = logoFile && fs.existsSync(logoFile) ? `data:image/png;base64,${fs.readFileSync(logoFile).toString("base64")}` : null;
  const q = quote({ total: 1190250, subtotal: 1190250 } as Partial<StandardQuote>);
  const rev2Lines = [line(1, "10m High Pole Precast Foundation with Deformed Rebar\n1000 X 1000 X 1200mm base, Grey Concrete Struck-Off Mould finish as per ACI / PCI Std.", 450, 2645)];
  const snap = buildStandardQuoteSnapshot({
    quote: q as unknown as Record<string, unknown>, lines: rev2Lines as unknown as Record<string, unknown>[], account: account as unknown as Record<string, unknown>, contact: contact as unknown as Record<string, unknown>,
    template: { id: null, name: "PCBS quotation", accent_color: null, logo_position: "left", blocks: PCBS_BLOCKS },
    frame: { design: PCBS_PDF_DESIGN, entity, company_info: { name: "PCBS", web: "www.pcbs.com.sa", logo_url: logo ?? undefined }, tenant_name: "PCBS", logo_url: null, print_ids: ["v1"] },
    currency: "SAR",
  });
  snap.quote.doc_sections = PCBS_SAMPLE_DOC_SECTIONS;
  const frame = (await buildFrameFromSnapshot(snap, revisionNo))!;
  const p = snapshotForPrint(snap, { quoteId: "q1", tenantId: "t1", status: "sent" });
  const body = renderToStaticMarkup(createElement(StandardQuoteFramedBody, { quote: p.quote, lines: p.lines, account: p.account, contact: p.contact, blocks: snap.template.blocks, docSections: snap.quote.doc_sections, currency: snap.currency }));
  const pdf = await renderPdf({ source: { kind: "html", html: html(frame.bodyCss, frame.fontFaceCss, body), timeoutMs: 30_000 }, margin: { top: "0", bottom: "0", left: "0", right: "0" }, settle: true, frame });
  fs.mkdirSync(OUT!, { recursive: true });
  fs.writeFileSync(path.join(OUT!, name), pdf);
  return pdf;
}

run("sample PDFs", () => {
  it("slice 1: a framed quotation", async () => {
    const pdf = await sample("slice1-quotation.pdf", null);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeLessThan(500_000);
    expect(esc("<")).toBe("&lt;");
  }, 90_000);
  it("slice 2: revision 2", async () => {
    const pdf = await revisionSample("slice2-quotation-rev02.pdf", 2);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 90_000);
});
