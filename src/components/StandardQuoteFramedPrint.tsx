"use client";

import type { Account, Contact, DocSections, StandardQuote, StandardQuoteLine, StandardQuoteTemplateBlock } from "@/lib/types";
import type { CurrencyCode } from "@/lib/currency";
import StandardQuoteFramedBody from "./StandardQuoteFramedBody";

// The print page of a quotation inside a page frame. For the PDF the server renders this page with ?pdf=1: the browser itself
// draws the running header and footer on every page, so the page carries the body alone. Opened on screen (and Ctrl+P) it
// shows the same header on page one and the footer at the end, as a faithful-enough preview; "Download PDF" is the exact output.

type Props = {
  quote: StandardQuote;
  lines: StandardQuoteLine[];
  account: Account | null;
  contact: Contact | null;
  blocks: StandardQuoteTemplateBlock[];
  docSections: DocSections | null | undefined;
  currency: CurrencyCode;
  taxLabel?: string;
  frame: { bodyCss: string; fontFaceCss: string; previewHeaderHtml: string; previewFooterHtml: string; marginsMm: { top: number; right: number; bottom: number; left: number }; pageFormat: "A4" | "Letter" };
  pdfMode: boolean;
  /** "?rev=" the page is showing, for the Download link. */
  rev?: number | null;
};

export default function StandardQuoteFramedPrint({ quote, lines, account, contact, blocks, docSections, currency, taxLabel, frame, pdfMode, rev }: Props) {
  const m = frame.marginsMm;
  const href = `/api/standard-quotes/${quote.id}/pdf${rev != null ? `?rev=${rev}` : ""}`;
  return (
    <>
      <style>{`
        ${frame.fontFaceCss}
        ${frame.bodyCss}
        @page { size: ${frame.pageFormat} portrait; margin: ${pdfMode ? "0" : `${Math.min(m.top, 14)}mm ${m.right}mm ${Math.min(m.bottom, 14)}mm ${m.left}mm`}; }
        html, body { margin: 0; background: ${pdfMode ? "#fff" : "#e8ecf0"}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .pfsheet { background: #fff; width: ${frame.pageFormat === "A4" ? "210mm" : "216mm"}; margin: 0 auto; box-sizing: border-box; }
        .pfscreen .pfsheet { padding: 0 ${m.right}mm 8mm ${m.left}mm; }
        .pfhead, .pffoot { margin: 0 -${m.right}mm 0 -${m.left}mm; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } .pfscreen .pfsheet { width: auto; } }
        @media (max-width: 800px) { .pfsheet { width: auto; max-width: 100%; } }
      `}</style>
      {!pdfMode && (
        <div className="no-print" style={{ background: "#152233", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
          <a href={href} style={{ background: "#378ADD", color: "#fff", borderRadius: 8, padding: "10px 20px", minHeight: 44, boxSizing: "border-box", fontSize: 13, fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-guide="sq-download-pdf">
            Download PDF
          </a>
          <button onClick={() => window.print()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "0 16px", minHeight: 44, fontSize: 13, cursor: "pointer" }}>
            Print (browser)
          </button>
          <button onClick={() => window.close()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "0 16px", minHeight: 44, fontSize: 13, cursor: "pointer" }}>Close</button>
        </div>
      )}
      <div className={pdfMode ? undefined : "pfscreen"}>
        <div className="pfsheet">
          {!pdfMode && <div className="pfhead" dangerouslySetInnerHTML={{ __html: frame.previewHeaderHtml }} />}
          <StandardQuoteFramedBody quote={quote} lines={lines} account={account} contact={contact} blocks={blocks} docSections={docSections} currency={currency} taxLabel={taxLabel} />
          {!pdfMode && <div className="pffoot" style={{ marginTop: "8mm" }} dangerouslySetInnerHTML={{ __html: frame.previewFooterHtml }} />}
        </div>
      </div>
    </>
  );
}
