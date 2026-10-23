"use client";

import SalesOrderPrintDocument, { type SalesOrderPrintDocumentProps } from "./SalesOrderPrintDocument";

type Props = SalesOrderPrintDocumentProps & {
  /** Where "Download PDF" points: the signed-in route for staff, the token route for the public page. */
  pdfHref: string;
};

export default function SalesOrderPrint({ pdfHref, ...doc }: Props) {
  return (
    <>
      <style>{`
        /* block, not swap: the self-hosted font carries the currency glyphs the render host lacks; see StandardQuotePrint. */
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans.ttf") format("truetype"); font-weight: 400; font-display: block; }
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans-Bold.ttf") format("truetype"); font-weight: 700; font-display: block; }
        @media print {
          @page { size: A4 portrait; margin: 12mm 15mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: #fff !important; }
          .no-print { display: none !important; }
        }
        body { margin: 0; background: #e8ecf0; font-family: "PrintSans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1c2733; }
        .doc { background: #fff; max-width: 800px; margin: 0 auto; }
        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }
      `}</style>

      <div className="no-print" style={{ background: "#152233", padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
        <a href={pdfHref} style={{ background: "#378ADD", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none", display: "inline-block", minHeight: 20 }}>
          Download PDF
        </a>
        <button onClick={() => window.print()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
          Print / Save PDF (browser)
        </button>
      </div>

      <SalesOrderPrintDocument {...doc} />
    </>
  );
}
