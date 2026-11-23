import type { PdfDesign } from "../src/lib/constants";
import type { ClauseItem, DocSections, StandardQuoteTemplateBlock } from "../src/lib/types";

// The PCBS page frame and quotation layout, as DATA for the workspace with slug "pcbs" (PDF redesign, slice 1). The source is
// the client's own sample ("Sales qoutation _ Sample Template.docx"): unmarked text is fixed boilerplate, text the sample marks
// dynamic (yellow, or commented "Complete section is Dynamic") is `edit: true`, written per quotation. Nothing here is code:
// scripts/seed-pcbs-pdf-design.sql carries exactly this JSON, and scripts/pcbsPdfSeed.test.ts fails if the two drift apart.
//
// Wording follows the sample. Two typos in the sample are corrected ("out offer" is printed "our offer"); the placeholder
// signatory "XYZ" is left empty for the client to fill in Settings > PDF documents > Layouts.

export const PCBS_PDF_DESIGN: PdfDesign = {
  page: { size: "A4", margins_mm: { top: 38, right: 12, bottom: 24, left: 19 } },
  font: "arial_like",
  base_pt: 10,
  colors: { text: "#000000", band: "#7f7f7f", band_text: "#ffffff", sub_band: "#ffd700", table_head: "#dbe5f1", rule: "#7f7f7f" },
  header: { logo: "left", logo_height_mm: 17, lines: ["extra_ids"], title_band: true },
  footer: { rule: true, left: ["address", "cr", "vat"], right: ["phones", "email", "web"], page_numbers: true, strip: ["#7f7f7f", "#ffd700", "#7f7f7f"] },
  table: { borders: "grid", zebra: false },
};

export const PCBS_LAYOUT_NAME = "PCBS quotation";

const item = (id: string, text: string, extra: Partial<ClauseItem> = {}): ClauseItem => ({ id, text, ...extra });

const section = (id: string, title: string, items: ClauseItem[], numbered = false): StandardQuoteTemplateBlock => ({
  id, type: "clause_section", visible: true, data: { title, numbered, items },
});
const matrix = (id: string, title: string, rows: string[]): StandardQuoteTemplateBlock => ({
  id, type: "scope_matrix", visible: true,
  data: { title, columns: ["BY PCBS", "BY CLIENT", "N/A"], remark: true, rows: rows.map((text, i) => ({ id: `r${i + 1}`, text })) },
});

export const PCBS_BLOCKS: StandardQuoteTemplateBlock[] = [
  { id: "letterhead", type: "letterhead", visible: true },
  { id: "quote_meta", type: "quote_meta", visible: true },
  { id: "bill_to", type: "bill_to", visible: true },
  {
    id: "front_block", type: "front_block", visible: true,
    data: {
      title: "QUOTATION", reference_label: "RFQ #",
      rows: [
        { label: "DATE", field: "date" },
        { label: "Company", field: "account" },
        { label: "Tel./Fax", field: "account_phone" },
        { label: "Contact", field: "contact" },
        { label: "Mobile", field: "contact_phone", label2: "Email", field2: "contact_email" },
        { label: "Project Title", field: "project_title" },
        { label: "Subject", field: "subject" },
      ],
      greeting: "Dear Sir,",
      opening: "We take this opportunity to thank you for your invitation to participate in the above project, please find below our offer, based on the info provided by you.",
    },
  },
  section("sec-a", "IMPORTANT INFORMATION", [
    item("a1", "This offer based on the current drawings provided by you, PCBS has the right to reassess if the final drawings, specifications, and project requirements have modified from the considered reference in this quotation. (See Clause B1)"),
    item("a2", "PCBS uses ACI, PCI & ASTM for design and execution. The shop drawings will be prepared in accordance with provided original drawings and design criteria. However, it is understood by the client that the above-mentioned codes will apply architecturally and structurally in our products, the tolerances of Production and Erection is as per tolerances of the PCI."),
    item("a3", "If MEP items or any accessories not mentioned and not related directly to PCBS scope. Once required, it shall be supplied to PCBS factory as well as the Clients should marking-up on the hardcopy of fabrication drawings, which will submit to the Client for approval/comments. Besides, we will place the fixation of the mentioned items embedding the precast concrete products free of charge."),
    item("a4", "PCBS highly recommends that any technical requirements and/or oral commitments about the scope of work must be determined here in order to prevent any misunderstanding or suspicion. Hence, all the mentioned points in this quotation will apply during all project stages unless otherwise stated in such further contract agreements."),
    item("a5", "PCBS will provide a warranty certificate for in-house products for 10 years after approval of our completion certificate. This Guarantee only covers the cost of repairing or removing and replacing defective products. The guarantee will remain in effect for Ten Years from above date, and any claim under this guarantee must be notified in writing to Precast Building System Co. Ltd. within that period."),
  ]),
  section("sec-b", "REQUIREMENTS, SPECIFICATIONS AND CRITERIA", [
    item("b1", "Our price is based on the provided drawings.", { heading: "LIST OF DRAWINGS:", edit: true }),
    item("b2", "PCBS will design the precast elements as per ASTM / ACI / PCI requirements, the shop drawings will be prepared in accordance with provided original drawings and design criteria.", {
      heading: "TECHNICAL INFORMATION:",
      sub: [
        "Precast Elements will manufacture in accordance with PCBS standard procedures and with due reference to your supplied information and drawings. PCBS reserve the right to change some portion(s) on your drawings whenever necessary depending upon structural design, standard manufacturing and handling, delivery and installation procedures may require. Hence, the sizes of P.C. foundation, P.C. Column, etc. is subject to confirmation by PCBS Engineering Dept.",
        "Acceptability of appearance of the produced elements and the finishing shall be within normally accepted standard as stated in Precast Concrete Institute (MNL116-99 4th Edition, MNL 117-96 3rd Edition).",
        "The precast/prestressed units shall be produced & installed within the dimensional tolerances detailed in Precast Concrete Institute (MNL-120-04 6th Edition, MNL-135-00, MNL116-99 4th Edition, MNL 117-96 3rd Edition).",
        "It's important to realize that the concrete components have made from natural materials, it's normal and most prospect the precast elements to have some surface discoloration, gross color changes, mottled or dark blotches whether are extracted-off-mold or smooth hand trowel finish or even after the final surface finish eg: Sandblasted elements, that will be in conjunction and in accordance with ASTM / PCI / ACI, PCBS products shall not exceeding the accepted tolerance as instructed in the mentioned codes, moreover, any required of surface preparation before paint or color treatment are not included in our scope of works.",
      ],
    }),
    item("b3", "Cement: Grey Cement (OPC TYPE I).", {
      heading: "SPECIFICATION OF PRECAST CONCRETE ELEMENTS", edit: true,
      sub: [
        "Compressive Strength: Cylindrical shall be 35 MPa at 28 days for PC Elements.",
        "Cementitious Materials: The concrete mix will be normal without any special additive.",
        "Finishes will be the following: Grey Cement Smooth as extracted from the molds and steel-troweled finish as per ACI-PCI standard.",
        "Reinforcement: Uncoated deformed carbon steel bars conforming to ASTM A615 with Grade 60.",
      ],
    }),
    item("b4", "", { heading: "LIST OF P.C. PRODUCTS:", edit: true }),
  ], true),
  section("sec-c", "SCOPE OF WORK", [
    item("c1", "PCBS offer includes Production only. (Some deviations or more details may be mentioned in Clause D. PRICE / BILL OF QUANTITY.", { edit: true }),
    item("c2", "", { heading: "SCOPE OF WORKS MATRIX:" }),
  ], true),
  matrix("mx-eng", "ENGINEERING", ["Prepare the shop drawings", "Obtain the client approval of the shop drawings"]),
  matrix("mx-prod", "PRODUCTION _ SCOPE OF WORK", [
    "Manufacture of Precast Elements as per Approved Shop Drawings and relevant documents",
    "Supply and verify of MEP items",
    "Installing the Supplied MEP items as per approved shop drawings",
    "Provide sample for finish surface approval",
    "Bitumen Paint (SIKA TOP 550)",
    "All tests and inspections in-house PCBS Laboratory & Inspection of Products",
    "Testing by third party",
    "Any Anchor bolts, dowels, steel plates embedded, etc..",
    "At factory, Loading the elements on the trailer",
  ]),
  matrix("mx-del", "DELIVERY _ SCOPE OF WORK", ["Transport the elements to site", "Unloading at site"]),
  matrix("mx-ere", "ERECTION _ SCOPE OF WORK", ["Erect the elements as per approved drawings", "Grouting and joints"]),
  section("sec-d", "PRICE / BILL OF QUANTITY", [
    item("d1", "", { heading: "EX-FACTORY (PRODUCTION) ONLY", band: true, edit: true }),
  ]),
  {
    id: "line_items", type: "line_items", visible: true,
    data: { preset: "boq", total_label: "TOTAL AMOUNT FOR {QTY} {UOM}", note: "NOTE: According to the General Authority of Zakat & Tax, a VAT will be imposed in invoices for the above amounts." },
  },
  { id: "totals", type: "totals", visible: true },
  section("sec-e", "COMMERCIAL TERMS (EXCEPTIONS & DEVIATIONS)", [
    item("e1", "Our offer includes the items described in the Bill of Quantities only; hence, any items not mentioned herein are not included in our price."),
    item("e2", "PCBS offer has prepared based on the drawings and documents provided by you, so, any change or deviation it maybe makes variation cost accordingly."),
    item("e3", "Whereas this commercial offer is integrated part of any prospected agreement, the acknowledgment scope of work has fixed between both organizations contractually; thus, in the event that the client want to reduce the scope of works, the approval of PCBS Co. is mandatory."),
    item("e4", "The offered Rates has provided based on awarding of all figured quantities so, if the actual QTY (based on final design and acceptance method of measurement) was less than 100% from the quotation's BOQ therefore, PCBS has the right escalate the Rates according to cost impact resulting by reducing these quantities."),
    item("e5", "The cost of engineering works has included in our price, it includes if some revisions for the mark-up of MEP as well as if some reasonable adjustment happened. Any changes/cancelation in IFC Drawings after PCBS start preparation of GAD will be subjected to time and cost variation equal to the time invested in engineering works from the schedule start date. As the engineering cost does not anticipate any major changes to the input information on which the design & drawing work is based which may warrant substantial rework. Hence, in case of any such rework, it is right to PCBS to charge a design variation order accordingly. Further, the engineering Man-Hour rate is (410 SAR/Hr). (Also, See Clause G. Program, how the Timeline may be impacted!)."),
    item("e6", "Some Moulds will be fabricating particularly on the tables of PCBS plant in order to manufacture your precast elements such as required, the cost of these Moulds has included in our Price. But, in case the design has been adjusted after Moulds fabrication or if the production has been suspended or canceled hence, it is right to PCBS to charge the cost of fabricating the moulds and the reservation of the mentioned tables without running of production. (Also, see Clause G. PROGRAM how the timeline may be impacted!)."),
    item("e7", "In event that the Client delayed PCBS trailer to turnaround more than 2 hour, the time above this will be subject to a demurrage-charge of SAR 100 per hour or part of this time."),
    item("e8", "Timbers (woods) used for protection of P.C. during the transportation, which retained by the client on-site, it will be right to PCBS to charge an extra-cost (not before the Client has properly notified to avoid retained it)."),
    item("e9", "PCBS will coordinate (in advance) with the Client regarding the time of delivery and erection, Hence, if the client failed (for any reason related to his scope) to receive the elements and doing his obligation which resulting to return the batch (loads) to PCBS factory, in this case, the direct and indirect cost will be charged accordingly."),
    item("e10", "In the event, that client has a failure in his obligation at the site to receive precast elements: An additional 3% of the rates will charge for every week for produced precast elements that stored at PCBS stockyard will be imposed after stocked more than twenty-one (21) days."),
    item("e11", "This quotation is based on the current price only. Due to continuous increase of the major construction raw-materials price (such as Sand & Coarse aggregates, Cement, Reinforcement Bars / Wire Meshes, Pre-stressed Strands, Diesel/ Steel/ Timber moulds, Accessories/ fixing and Inserts in the PC elements, Transportation and Crane), any increase of the base prices (with a proof via letters from suppliers, Purchase Orders, etc.) greater than 5% we would be submitted and subsequently would be added to the value of this quotation for the affected activity or activities."),
    item("e12", "Steel Reinforcement (Uncoated): 10mm: SAR 3,100/Ton; 12-32mm: SAR 2,900/Ton.", { heading: "Key Materials Base Rates:", edit: true }),
    item("e13", "The quantities are approximately estimated, however, it should be re-measuring upon receipt of final approved drawings.", { heading: "Method of Measurement:" }),
    item("e14", "N/A", { heading: "Remarks for the Lift Equipment:", edit: true }),
  ]),
  section("sec-f", "PAYMENT TERMS", [
    item("f1", "50% Advance Payment upon signing of the contract.", { heading: "ADVANCE", edit: true }),
    item("f2", "50% for Upon Production before delivery, Progress invoices payable in seven days from the date of invoice.", { heading: "PROGRESS INVOICE", edit: true }),
  ], true),
  section("sec-g", "DURATION", [
    item("g1", "The Job will be complete as per the agreed program and subject to the following:", {
      sub: [
        "Releasing all due payment as mentioned in F1 above.",
        "Site readiness including access, with no restriction for moving products, equipment, etc.",
        "Maintain the Client obligations and responsibilities and any suspensions of the production may consider into account.",
        "The project schedule and duration will be determined based on allocation and release sequence of the villas.",
      ],
    }),
  ]),
  section("sec-h", "VALIDITY", [item("h1", "Our offer is valid for 20 days from the date of this quotation.")]),
  {
    id: "closing", type: "closing", visible: true,
    data: {
      text: "We trust our offer is of interest and a demonstration of our commitment to support you on this particular project. Should you wish to discuss any aspect of this offer please don't hesitate to contact us on Tel: +966 13 820 7470 Ext: 103; or email us on sales@pcbs.com.sa.",
      regards: "BEST REGARDS,", signatory_title: "Chief Executive Officer",
    },
  },
];

/** What a quotation of the sample holds per document (fixture for tests and sample PDFs; never seeded). */
export const PCBS_SAMPLE_DOC_SECTIONS: DocSections = {
  "sec-b": {
    items: {
      b1: { text: "Our price is based on the provided drawings on 05 Aug, 2026 by email." },
      b4: { text: "P.C. Foundation" },
    },
  },
  "sec-d": { items: { d1: { text: "" } } },
  "sec-e": {
    items: {
      e12: {
        text: "Steel Reinforcement (Uncoated)",
        sub: [
          "10mm: SAR 3,100/Ton",
          "12-32mm: SAR 2,900/Ton",
          "Welded Wire mesh (Uncoated): A146 6mm @ 200 x 200mm, Size: 2 x 5m: SAR 90/Sheet; A252 8mm @ 200 x 200mm: SAR 115/Sheet; A393 10mm @ 200 x 200mm: SAR 165/Sheet",
          "Strands 12.7mm: SAR 4,460/Ton",
          "Cement, Grey: SAR 225/Ton",
          "Diesel: SAR 1.90/Litre",
        ],
      },
    },
  },
  "mx-eng": { not_applicable: "CLIENT HAS TO PROVIDE APPROVED SHOP DRAWINGS" },
  "mx-prod": {
    ticks: { r1: 0, r2: 1, r3: 1, r4: 0, r5: 0, r6: 0, r7: 1, r8: 0, r9: 0 },
    remarks: { r5: "Max. 2 Coats", r7: "Except the General Tests (Technical Submission)" },
  },
  "mx-del": { not_applicable: "N/A" },
  "mx-ere": { not_applicable: "N/A" },
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** The text of scripts/seed-pcbs-pdf-design.sql. Generated, so the data above and the script cannot disagree. */
export function buildPcbsSeedSql(): string {
  return `-- Seed: the PCBS page frame and quotation layout, as DATA for the workspace with slug 'pcbs' (PDF redesign, slice 1).
-- GENERATED from scripts/pcbs-pdf-design.data.ts; scripts/pcbsPdfSeed.test.ts fails if this file drifts from it.
-- Idempotent: running it twice leaves one frame and one layout (the layout is matched by its name and rewritten).
-- Needs no migration: the frame is a key in tenants.config, the layout is a row of standard_quote_templates (0054).
-- It does not create the legal entities. Type the entity details (address, C.R. No., VAT No., and the vendor-number id set to
-- "selected customers") in Settings > Company > Entities, then tick the id on the accounts that should print it.
-- Does nothing when no tenant has the slug 'pcbs'. Run by the owner by hand, on the database that holds that workspace.

do $seed$
declare
  t uuid;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No tenant with slug pcbs: nothing seeded.';
    return;
  end if;

  update tenants
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{pdf_design}', $design$${json(PCBS_PDF_DESIGN)}$design$::jsonb, true)
   where id = t;

  update standard_quote_templates set is_default = false where tenant_id = t and name <> '${PCBS_LAYOUT_NAME}' and is_default;

  insert into standard_quote_templates (tenant_id, name, is_default, accent_color, logo_position, blocks)
  values (t, '${PCBS_LAYOUT_NAME}', true, '#7f7f7f', 'left', $blocks$${json(PCBS_BLOCKS)}$blocks$::jsonb)
  on conflict (tenant_id, name) do update
     set blocks = excluded.blocks, accent_color = excluded.accent_color, logo_position = excluded.logo_position,
         is_default = true, updated_at = now();
end
$seed$;
`;
}
