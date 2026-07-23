"use client";

import { useState } from "react";
import QuotePrintDocument, { type QuotePrintDocumentProps } from "./QuotePrintDocument";
import { MessageSquare } from "@/components/Icons";

type Props = QuotePrintDocumentProps;

export default function QuotePrint(props: Props) {
  const { quote, account, contact } = props;
  const recipient = contact?.email || contact?.email2 || account?.email || account?.email2 || null;
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");

  async function sendEmail() {
    setEmailState("sending");
    setEmailError("");
    try {
      const res = await fetch(`/api/quotes/${quote.id}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send email");
      setEmailState("sent");
    } catch (e: unknown) {
      setEmailState("error");
      setEmailError(e instanceof Error ? e.message : "Failed to send email");
    }
  }

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
          @page { size: A4 portrait; margin: 12mm 15mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
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
          onClick={sendEmail}
          disabled={!recipient || emailState === "sending" || emailState === "sent"}
          title={recipient ? `Send to ${recipient}` : "No email on file for this contact or account"}
          style={{
            background: emailState === "sent" ? "rgba(34,197,94,.15)" : "transparent",
            color: emailState === "sent" ? "#4ade80" : recipient ? "#aebccd" : "#5a6a7d",
            border: `1px solid ${emailState === "sent" ? "rgba(34,197,94,.3)" : "rgba(255,255,255,.2)"}`,
            borderRadius: 8, padding: "8px 16px", fontSize: 13,
            cursor: !recipient || emailState === "sending" || emailState === "sent" ? "not-allowed" : "pointer",
          }}
        >
          {emailState === "sending" ? "Sending…" : emailState === "sent" ? `✓ Sent to ${recipient}` : "Email quote"}
        </button>
        {emailState === "error" && (
          <span style={{ fontSize: 12, color: "#f87171" }}>{emailError}</span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          <MessageSquare size={13} color="#6b8099" style={{ marginRight: 4 }} /> WhatsApp
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>SOON</span>
        </span>
        <button onClick={() => window.close()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>

      <QuotePrintDocument {...props} />
    </>
  );
}
