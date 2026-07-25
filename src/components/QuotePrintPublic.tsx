"use client";

// Customer-facing counterpart to QuotePrint.tsx -- same underlying document,
// but reached via a signed public link (no login), so it deliberately carries
// none of the rep-only toolbar (Email/WhatsApp/Adapt/Copy). Just the quote.
import QuotePrintDocument, { type QuotePrintDocumentProps } from "./QuotePrintDocument";

export default function QuotePrintPublic(props: QuotePrintDocumentProps) {
  return (
    <>
      <style>{`
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans.ttf") format("truetype"); font-weight: 400; font-display: swap; }
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans-Bold.ttf") format("truetype"); font-weight: 700; font-display: swap; }
        @media print {
          @page { size: A4 portrait; margin: 12mm 15mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        body { margin: 0; background: #e8ecf0; font-family: "PrintSans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1c2733; }
        .doc { background: #fff; max-width: 800px; margin: 0 auto; }
        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }
      `}</style>
      <QuotePrintDocument {...props} />
    </>
  );
}
