"use client";

import { useState } from "react";
import QuotePrintDocument, { type QuotePrintDocumentProps } from "./QuotePrintDocument";
import EmailComposeModal from "./EmailComposeModal";
import { MessageSquare } from "@/components/Icons";
import { sanitizePhoneForWhatsApp, buildWhatsAppLink, buildQuoteWhatsAppMessage } from "@/lib/whatsapp";

type Props = QuotePrintDocumentProps & {
  /** Signed, no-login link to this quote's PDF, for the WhatsApp message. Null when
   * QUOTE_PUBLIC_LINK_SECRET isn't configured (see lib/quotePublicLink.ts). */
  publicPdfLink?: string | null;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function QuotePrint(props: Props) {
  const { quote, account, contact, companyInfo, publicPdfLink } = props;
  const recipient = contact?.email || contact?.email2 || account?.email || account?.email2 || null;
  const [emailState, setEmailState] = useState<"idle" | "sent">("idle");
  const [composeOpen, setComposeOpen] = useState(false);

  const emailVars = {
    customer_name: contact?.name ?? "Sir/Madam",
    company_name: companyInfo?.name ?? "our team",
    quote_ref: quote.ref,
    quote_total: inr(quote.total),
    valid_until: quote.valid_until ? fmtDate(quote.valid_until) : "—",
  };

  const waPhone = sanitizePhoneForWhatsApp(contact?.phone || contact?.phone2 || contact?.phone3 || account?.phone || account?.phone2);
  const waLink = waPhone ? buildWhatsAppLink(waPhone, buildQuoteWhatsAppMessage({ ...emailVars, pdfLink: publicPdfLink })) : null;

  return (
    <>
      <style>{`
        /* Self-hosted, not a system font: @sparticuz/chromium (the headless Chromium used
           to render the production PDF) only bundles Open Sans, which has no glyph for the
           Indian Rupee sign -- every "₹" was silently rendering as blank. Loading the actual
           font file over HTTP sidesteps whatever fonts happen to be installed on the render
           host, in dev or production alike. The PDF route awaits document.fonts.ready before
           snapshotting so this is guaranteed loaded by the time the page prints. */
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans.ttf") format("truetype"); font-weight: 400; font-display: swap; }
        @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans-Bold.ttf") format("truetype"); font-weight: 700; font-display: swap; }
        @media print {
          /* Extra bottom margin reserves a band on EVERY page for the running
             footer below, so flowing content never runs under it. Keep this in
             sync with margin.bottom in the two PDF routes (quotes/[id]/pdf and
             pdf-public), which override this @page margin under Puppeteer. */
          @page { size: A4 portrait; margin: 12mm 15mm 20mm 15mm; }
          /* The company footer becomes a running page footer: fixed to the
             bottom of the printable area, repeated on every page (letterhead
             style) instead of flowing once, mid-page, after the last content.
             Centered + max-width to track the .doc column exactly. */
          .doc-footer {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            margin: 0 auto;
            max-width: 800px;
          }
          /* body's on-screen grey (below) is a page-editor backdrop, not
             something that should ever print -- print-color-adjust:exact
             forces backgrounds to actually render (browsers normally strip
             them to save ink), so without overriding it back to white here
             that grey shows through on any page shorter than a full sheet. */
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: #fff !important; }
          .no-print { display: none !important; }
          /* PrintSans (DejaVu Sans Regular) has notably thin strokes -- Chromium's
             grayscale anti-aliasing renders it visibly lighter than the body text
             color value alone would suggest (VIK-13: "content is very light" even
             though body's #1c2733 is already near-black). Forcing antialiased
             (not the default subpixel/grayscale AA) renders fuller, darker strokes
             without changing font size or weight, so it can't reflow any layout. */
          body { -webkit-font-smoothing: antialiased; }
        }
        body { margin: 0; background: #e8ecf0; font-family: "PrintSans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1c2733; }
        .doc { background: #fff; max-width: 800px; margin: 0 auto; }
        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{ background: "#152233", padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
        <a
          href={`/api/quotes/${quote.id}/pdf`}
          style={{ background: "#378ADD", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none", display: "inline-block" }}
        >
          ⬇ Download PDF
        </a>
        <button onClick={() => window.print()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>
          Print / Save PDF (browser)
        </button>
        <button
          onClick={() => setComposeOpen(true)}
          disabled={emailState === "sent"}
          style={{
            background: emailState === "sent" ? "rgba(34,197,94,.15)" : "transparent",
            color: emailState === "sent" ? "#4ade80" : "#aebccd",
            border: `1px solid ${emailState === "sent" ? "rgba(34,197,94,.3)" : "rgba(255,255,255,.2)"}`,
            borderRadius: 8, padding: "8px 16px", fontSize: 13,
            cursor: emailState === "sent" ? "not-allowed" : "pointer",
          }}
        >
          {emailState === "sent" ? "✓ Sent" : "Email quote"}
        </button>
        {waLink ? (
          <a
            href={waLink}
            target="_blank"
            rel="noopener"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, textDecoration: "none" }}
          >
            <MessageSquare size={13} color="#aebccd" /> WhatsApp
          </a>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }} title="No phone number on file for this contact/account">
            <MessageSquare size={13} color="#6b8099" style={{ marginRight: 4 }} /> WhatsApp
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }} title="Meta Business API integration — full inbox, delivery receipts, automated sends">
          <MessageSquare size={13} color="#6b8099" style={{ marginRight: 4 }} /> WhatsApp (embedded)
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>SOON</span>
        </span>
        <button onClick={() => window.close()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>

      <QuotePrintDocument {...props} />

      {composeOpen && (
        <EmailComposeModal
          quoteId={quote.id}
          defaultRecipient={recipient}
          vars={emailVars}
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); setEmailState("sent"); }}
        />
      )}
    </>
  );
}
