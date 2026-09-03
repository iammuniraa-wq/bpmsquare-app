"use client";

import { useEffect, useState } from "react";
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

  // The static 20mm @page bottom margin below assumes a footer that fits in
  // 20mm -- true for a short one-line footer, but Vikas' real footer (a long
  // wrapped address, four phone numbers, a tagline, an email/website row) is
  // taller than that. Since .doc-footer is position:fixed under print (it
  // doesn't reserve its own space), a footer taller than the reserved margin
  // creeps upward and paints OVER whatever normal content sits just above it
  // on the page -- reported live as "the signature is getting overlapped and
  // hidden". Fixed by measuring the ACTUAL rendered footer height and
  // widening the reserved margin to match, per tenant, instead of guessing
  // one fixed number for everyone. A ResizeObserver keeps it correct if the
  // footer's height changes after an image finishes loading late.
  useEffect(() => {
    const footer = document.querySelector<HTMLElement>(".doc-footer");
    if (!footer) return;
    let styleEl = document.getElementById("print-footer-margin") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "print-footer-margin";
      document.head.appendChild(styleEl);
    }
    const apply = () => {
      const heightMm = footer.getBoundingClientRect().height / 96 * 25.4; // px -> mm at 96dpi
      const marginMm = Math.min(60, Math.max(20, Math.ceil(heightMm) + 4)); // +4mm safety buffer
      // Same reserved-space number drives both: the print @page margin
      // (window.print()/Ctrl+P -- the Puppeteer routes compute their own
      // copy, see those files) AND the screen preview's simulated page
      // height (below), so the on-screen gap always matches what will
      // actually print, for this tenant's own footer, not a guessed one.
      styleEl!.textContent =
        `@media print { @page { margin-bottom: ${marginMm}mm; } }` +
        `@media screen { .doc { min-height: calc(297mm - 12mm - ${marginMm}mm); } }`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

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
             footer below, so flowing content never runs under it. 20mm here is
             only the FLOOR/fallback for a tenant with a short footer -- the
             real value is computed per tenant from the footer's actual
             rendered height (a fixed footer doesn't reserve its own space, so
             a too-small reserved band lets it overlap whatever content sits
             just above it) and injected as an override: client-side via the
             ResizeObserver effect below for window.print()/Ctrl+P, and via
             page.pdf()'s own "margin" option (which fully overrides this CSS
             value under Puppeteer, hence the separate computation there) in
             the two PDF routes (quotes/[id]/pdf and pdf-public). */
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
        /* Screen-only WYSIWYG fix (client-reported: "the PDF looks different
           from the screen"). .doc-footer only becomes a page-bottom-pinned
           running footer under @media print (above) -- on a short quote, the
           on-screen view showed the footer flowing right after the content
           (compact, no gap) while the printed/PDF page showed it pinned to
           the bottom of the full A4 sheet, leaving a big blank gap the
           screen never warned anyone about. Rather than touch the print
           layout (which is print's own carefully-tuned position:fixed
           running-footer fix for VIK-12 -- do not revert), this makes the
           SCREEN preview simulate one physical A4 page and pushes the
           footer to the bottom of it via flex, so any gap is visible on
           screen before you print, not a surprise after. The actual page
           height (min-height) is injected by the ResizeObserver effect
           above, computed from THIS tenant's real footer height, same
           number the print margin uses -- not hardcoded here. Deliberately
           scoped to the single-page case -- a quote long enough to
           genuinely paginate on print still just flows normally here
           rather than attempting true multi-page pagination in a
           scrolling browser view, which this isn't trying to solve. */
        @media screen {
          .doc { display: flex; flex-direction: column; box-shadow: 0 1px 4px rgba(21,34,51,.18); }
          .doc-footer { margin-top: auto; }
        }
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
