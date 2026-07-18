"use client";

import InvoicePrintDocument, { type InvoicePrintDocumentProps } from "./InvoicePrintDocument";

type Props = InvoicePrintDocumentProps;

export default function InvoicePrint(props: Props) {
  const { invoice } = props;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 15mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
        }
        body { margin: 0; background: #e8ecf0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1c2733; }
        .doc { background: #fff; max-width: 800px; margin: 0 auto; }
        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }
      `}</style>

      <div className="no-print" style={{ background: "#152233", padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
        <a
          href={`/api/invoices/${invoice.id}/pdf`}
          style={{ background: "#378ADD", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none", display: "inline-block" }}
        >
          ⬇ Download PDF
        </a>
        <button onClick={() => window.print()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>
          Print / Save PDF (browser)
        </button>
        <button onClick={() => window.close()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>

      <InvoicePrintDocument {...props} />
    </>
  );
}
