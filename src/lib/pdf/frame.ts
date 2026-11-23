import type { PdfDesign, PdfFrameToken, TenantEntity } from "@/lib/constants";
import type { CompanyInfo } from "@/lib/tenant";

// The page frame (PDF redesign, slice 1): header, footer, margins, type and colours that every framed document wears, held
// as data in tenants.config.pdf_design. PURE: no fetching, no fonts read from disk (the caller passes them in), so the
// Settings preview, the print page and the PDF route all build the same thing.
//
// resolvePdfFrame returns null when the workspace has no design. Each renderer then takes today's code path with today's
// margins -- not a default design that imitates it -- so a workspace that never chose a frame gets the same bytes it always did.

export type FrameFonts = { regular: string; bold: string } | null;

export type FrameInput = {
  design: PdfDesign | null | undefined;
  /** The legal entity that issues the document (config.entities); null = the workspace itself. */
  entity: TenantEntity | null;
  companyInfo: CompanyInfo;
  tenantName: string;
  /** The logo as a data: URI, fetched server-side. The header template cannot load a remote image. */
  logoDataUri: string | null;
  /** Ids from the account's "Print on documents" pick. */
  printIds: string[];
  title: string;
  referenceLabel: string;
  reference: string;
  /** "Rev. No. 01" or null when the workspace does not keep revisions. */
  revision: string | null;
  /** Bundled body font as data: URIs for the header/footer templates (they cannot see the page's @font-face). */
  fonts: FrameFonts;
};

export type PdfFrame = {
  pageFormat: "A4" | "Letter";
  marginsMm: { top: number; right: number; bottom: number; left: number };
  headerHtml: string;
  footerHtml: string;
  /** Stylesheet of the print body (type, colours, table style), scoped to `.pf`. */
  bodyCss: string;
  /** The bundled font as inline @font-face rules, for the print page (it must not depend on a login-gated font URL). */
  fontFaceCss: string;
  /** The same header and footer markup the template shows, for the in-page preview and Ctrl+P. */
  previewHeaderHtml: string;
  previewFooterHtml: string;
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT_STACK = {
  arial_like: `"BpmArimo", Arial, "Liberation Sans", Arimo, Helvetica, "DejaVu Sans", sans-serif`,
  print_sans: `"PrintSans", "DejaVu Sans", -apple-system, "Segoe UI", Roboto, sans-serif`,
} as const;

/** Lines a token prints, as { label?, value } pairs. Empty when the entity has nothing for it. */
type Line = { label?: string; value: string };

function tokenLines(tok: PdfFrameToken, f: FrameInput, area: "header" | "footer"): Line[] {
  const e = f.entity;
  const ci = f.companyInfo;
  if (tok.startsWith("text:")) return [{ value: tok.slice(5) }];
  switch (tok) {
    case "entity_name": return [{ value: e?.name || ci.name || f.tenantName }].filter((l) => l.value);
    case "entity_name_ar": return e?.name_ar ? [{ value: e.name_ar }] : [];
    case "address": {
      const a = (e?.address || ci.address || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      return a.map((value) => ({ value }));
    }
    case "phones": {
      const phone = e?.phone || (ci.phones ?? []).map((p) => p.number).filter(Boolean).join(" / ") || ci.landline || "";
      return phone ? [{ label: "Tel", value: phone }] : [];
    }
    case "email": {
      const email = e?.email || ci.email || "";
      return email ? [{ label: "Email", value: email }] : [];
    }
    case "web": return ci.web ? [{ label: "Web", value: ci.web }] : [];
    case "cr": return e?.crn ? [{ label: "C.R. No.", value: e.crn }] : [];
    case "vat": {
      const vat = e?.vat_number || e?.gstin || ci.gstin || "";
      return vat ? [{ label: "VAT No.", value: vat }] : [];
    }
    case "extra_ids": {
      const ids = (e?.extra_ids ?? []).filter((x) => x.value.trim() && (x.print === "always" || f.printIds.includes(x.id)));
      return ids.map((x) => ({ label: x.label, value: x.value }));
    }
    default: return area === "header" ? [] : [];
  }
}

const linesOf = (toks: PdfFrameToken[], f: FrameInput, area: "header" | "footer") => toks.flatMap((t) => tokenLines(t, f, area));

/** Footer: "Label: value" on one line. */
const footerLine = (l: Line) => `<div class="pff-fl">${l.label ? `<b>${esc(l.label)}:</b> ` : ""}<span dir="auto">${esc(l.value)}</span></div>`;
/** Header: a labelled id stacks label over value, as the sample's vendor number does. */
const headerLine = (l: Line) => l.label
  ? `<div class="pfh-hl"><div class="pfh-hk" dir="auto">${esc(l.label)}</div><div class="pfh-hv" dir="auto">${esc(l.value)}</div></div>`
  : `<div class="pfh-hl"><div class="pfh-hv" dir="auto">${esc(l.value)}</div></div>`;

function fontFace(fonts: FrameFonts): string {
  if (!fonts) return "";
  return `@font-face{font-family:"BpmArimo";font-weight:400;src:url(${fonts.regular}) format("woff2");}`
    + `@font-face{font-family:"BpmArimo";font-weight:700;src:url(${fonts.bold}) format("woff2");}`;
}

export function resolvePdfFrame(f: FrameInput): PdfFrame | null {
  const d = f.design;
  if (!d) return null;
  const { colors: c } = d;
  const stack = FONT_STACK[d.font];
  const pt = d.base_pt;

  const brandName = f.entity?.name || f.companyInfo.name || f.tenantName;
  const nameAr = f.entity?.name_ar ?? "";
  const rightLines = linesOf(d.header.lines, f, "header");
  const leftFoot = linesOf(d.footer.left, f, "footer");
  const rightFoot = linesOf(d.footer.right, f, "footer");

  // Heights in mm, from what is printed, so the margins always hold the header and footer (a template taller than its
  // margin is clipped by the browser).
  const logoMm = d.header.logo === "none" ? 0 : d.header.logo_height_mm;
  const idMm = rightLines.reduce((n, l) => n + (l.label ? 8 : 4.6), 0);
  const nameMm = 5 + (nameAr ? 4.6 : 0);
  const topRowMm = Math.max(logoMm, idMm, nameMm);
  const headerMm = 5 + topRowMm + (d.header.title_band ? 12 : 3);
  const footRows = Math.max(leftFoot.length, rightFoot.length, d.footer.page_numbers ? 1 : 0);
  const footerMm = footRows * 4.1 + (d.footer.rule ? 2 : 0) + (d.footer.strip ? 4 : 0) + 4;
  const m = d.page.margins_mm;
  const marginsMm = { top: Math.max(m.top, Math.ceil(headerMm)), right: m.right, bottom: Math.max(m.bottom, Math.ceil(footerMm)), left: m.left };

  const baseCss = `html,body{margin:0;padding:0;}*{box-sizing:border-box;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:${stack};color:${c.text};}`;

  const headerInner = `<div class="pfh">
  <div class="pfh-row">
    ${d.header.logo === "none" ? "" : `<div class="pfh-brand">${f.logoDataUri ? `<img class="pfh-logo" src="${esc(f.logoDataUri)}" alt="">` : ""}<div class="pfh-nm"><div class="pfh-n1" dir="auto">${esc(brandName)}</div>${nameAr ? `<div class="pfh-n2" dir="auto">${esc(nameAr)}</div>` : ""}</div></div>`}
    <div class="pfh-ids">${rightLines.map(headerLine).join("")}</div>
  </div>
  ${d.header.title_band ? `<div class="pfh-band"><span class="pfh-bt">${esc(f.title)}</span><span class="pfh-br">${esc([f.referenceLabel, f.reference].filter(Boolean).join(" "))}${f.revision ? ` ${esc(f.revision)}` : ""}</span></div>` : ""}
</div>`;
  const justify = d.header.logo === "center" ? "center" : d.header.logo === "right" ? "flex-end" : "flex-start";
  const headerCss = `.pfh{width:100%;padding:5mm ${m.right}mm 0 ${m.left}mm;font-size:8pt;}
.pfh-row{display:flex;align-items:flex-start;justify-content:space-between;gap:6mm;min-height:${topRowMm}mm;${d.header.logo === "right" ? "flex-direction:row-reverse;" : ""}}
.pfh-brand{display:flex;align-items:center;gap:3mm;${d.header.logo === "center" ? "margin:0 auto;" : ""}justify-content:${justify};}
.pfh-logo{height:${logoMm}mm;width:auto;max-width:60mm;object-fit:contain;}
.pfh-n1{font-size:10pt;font-weight:700;line-height:1.2;}.pfh-n2{font-size:9pt;font-weight:700;line-height:1.3;}
.pfh-ids{text-align:right;}.pfh-hl{margin-bottom:1mm;}.pfh-hk{font-size:7.5pt;font-weight:700;text-transform:uppercase;line-height:1.1;}.pfh-hv{font-size:9pt;font-weight:700;line-height:1.2;}
.pfh-band{margin-top:2mm;background:${c.band};color:${c.band_text};display:flex;justify-content:space-between;align-items:center;padding:1.3mm 2.5mm;}
.pfh-bt{font-size:15pt;font-weight:700;letter-spacing:.3pt;}.pfh-br{font-size:10pt;font-weight:700;text-decoration:underline;}`;

  const strip = d.footer.strip ? `<div class="pff-strip">${d.footer.strip.map((col) => `<i style="background:${col}"></i>`).join("")}</div>` : "";
  const footerInner = `<div class="pff">
  ${d.footer.rule ? `<div class="pff-rule"></div>` : ""}
  <div class="pff-cols"><div class="pff-col">${leftFoot.map(footerLine).join("")}</div><div class="pff-col r">${rightFoot.map(footerLine).join("")}${d.footer.page_numbers ? `<div class="pff-pg">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` : ""}</div></div>
  ${strip}
</div>`;
  const footerCss = `.pff{width:100%;padding:0 ${m.right}mm 0 ${m.left}mm;font-size:7.5pt;line-height:1.3;}
.pff-rule{border-top:.3mm solid ${c.rule};margin-bottom:1mm;}
.pff-cols{display:flex;justify-content:space-between;gap:6mm;}.pff-col{flex:1;}.pff-col.r{text-align:right;}
.pff-fl b{font-weight:700;}.pff-pg{font-size:8.5pt;margin-top:.8mm;}
.pff-strip{display:flex;height:2.2mm;margin-top:1.5mm;}.pff-strip i{flex:1;display:block;}`;

  const templateWrap = (css: string, inner: string) => `<style>${baseCss}${fontFace(f.fonts)}${css}</style>${inner}`;

  const bodyCss = `.pf{font-family:${stack};font-size:${pt}pt;color:${c.text};line-height:1.35;}
.pf table{border-collapse:collapse;width:100%;}
.pf th,.pf td{vertical-align:top;padding:1.2mm 1.6mm;${d.table.borders === "grid" ? `border:.25mm solid ${c.text};` : `border-bottom:.25mm solid ${c.rule};`}}
.pf thead{display:table-header-group;}.pf tr{break-inside:avoid;}
.pf .th{background:${c.table_head};font-weight:700;text-align:center;}
.pf .band{background:${c.band};color:${c.band_text};font-weight:700;text-transform:uppercase;padding:1.3mm 2.5mm;margin:5mm 0 2mm;break-after:avoid;break-inside:avoid;display:block;}
.pf th.mxt{background:${c.sub_band};text-align:left;text-transform:uppercase;}
.pf .subband{background:${c.sub_band};font-weight:700;text-transform:uppercase;padding:1mm 2.5mm;margin:3mm 0 0;break-after:avoid;}
.pf h4,.pf .ci-head{font-weight:700;margin:2.5mm 0 1mm;break-after:avoid;}
.pf p{margin:0 0 1.6mm;orphans:3;widows:3;}
.pf .kv{display:flex;gap:2mm;margin:0 0 .6mm;}.pf .kv b{flex:0 0 auto;}
.pf .num{text-align:right;white-space:nowrap;}.pf .ctr{text-align:center;}
.pf .closing{break-inside:avoid;margin-top:5mm;}
${d.table.zebra ? `.pf tbody tr:nth-child(even) td{background:#f6f6f6;}` : ""}`;

  return {
    pageFormat: d.page.size,
    marginsMm,
    headerHtml: templateWrap(headerCss, headerInner),
    footerHtml: templateWrap(footerCss, footerInner),
    bodyCss,
    fontFaceCss: fontFace(f.fonts),
    previewHeaderHtml: `<style>${headerCss}</style>${headerInner}`,
    previewFooterHtml: `<style>${footerCss}</style>${footerInner.replace('<span class="pageNumber"></span>', "1").replace('<span class="totalPages"></span>', "1")}`,
  };
}

/** The pieces of the reference printed in the title band: label ("RFQ #"), the number, and the revision text. */
export function revisionText(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  return `Rev. No. ${String(n).padStart(2, "0")}`;
}
