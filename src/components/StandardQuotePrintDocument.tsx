import type { StandardQuote, StandardQuoteLine, Account, Contact, StandardQuoteTemplate, StandardQuoteTemplateBlock } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import { Mail, Globe, MapPin } from "@/components/Icons";
import { defaultStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";

export type StandardQuotePrintDocumentProps = {
  quote: StandardQuote;
  lines: StandardQuoteLine[];
  account: Account | null;
  contact: Contact | null;
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  template?: StandardQuoteTemplate | null;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function SectionLabel({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
      {children}
    </div>
  );
}

// Standard Quote's own print layout -- deliberately not QuotePrintDocument.tsx
// or InvoicePrintDocument.tsx (both carry customization this object is meant
// to stay free of). Shared only with the generic tenant letterhead data
// (company name/logo/address) every printable document in this app already
// draws from, and now driven by a per-tenant, per-quote-optional
// StandardQuoteTemplate -- an ordered, toggleable block list (see
// src/lib/standardQuoteTemplateBlocks.ts) rather than a fixed layout.
export default function StandardQuotePrintDocument({
  quote, lines, account, contact, companyInfo = {}, logoUrl, template,
}: StandardQuotePrintDocumentProps) {
  const co = {
    name: companyInfo.name ?? "",
    tagline: companyInfo.tagline ?? "",
    address: companyInfo.address ?? "",
    email: companyInfo.email ?? "",
    email2: companyInfo.email2 ?? "",
    web: companyInfo.web ?? "",
    logo_url: companyInfo.logo_url ?? logoUrl ?? null,
    logo_bg: companyInfo.logo_bg ?? brand.blue,
  };

  const accent = template?.accent_color || brand.blue;
  const logoPosition = template?.logo_position ?? "left";
  const blocks = template?.blocks?.length ? template.blocks : defaultStandardQuoteBlocks();

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const logoIni = initials(co.name || "?");

  const logoBlock = co.logo_url ? (
    <img src={co.logo_url} alt={co.name} style={{ height: 60, maxWidth: 80, objectFit: "contain", flexShrink: 0 }} />
  ) : (
    <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, background: co.logo_bg || brand.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff" }}>
      {logoIni}
    </div>
  );
  const nameBlock = (
    <div style={{ textAlign: logoPosition === "center" ? "center" : logoPosition === "right" ? "right" : "left" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: brand.dark, letterSpacing: 0.4, lineHeight: 1.15 }}>{co.name}</div>
      {co.tagline && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 3 }}>{co.tagline}</div>
      )}
    </div>
  );
  const titleBlock = (
    <div style={{ fontSize: 17, fontWeight: 800, color: brand.dark, letterSpacing: 2, textTransform: "uppercase" }}>
      Standard Quote
    </div>
  );

  function renderBlock(block: StandardQuoteTemplateBlock) {
    if (!block.visible) return null;

    switch (block.type) {
      case "letterhead":
        return (
          <div key={block.id} style={{ background: "#fff", borderBottom: `2px solid ${brand.dark}`, breakInside: "avoid" }}>
            {logoPosition === "center" ? (
              <div style={{ padding: "10px 22px 9px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                {logoBlock}
                {nameBlock}
                <div style={{ marginTop: 4 }}>{titleBlock}</div>
              </div>
            ) : (
              <div style={{ padding: "10px 22px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexDirection: logoPosition === "right" ? "row-reverse" : "row" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexDirection: logoPosition === "right" ? "row-reverse" : "row" }}>
                  {logoBlock}
                  {nameBlock}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>{titleBlock}</div>
              </div>
            )}
            <div style={{ borderTop: "1px solid #dde2e8", padding: "2.5px 22px", display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", fontSize: 10, color: "#555", background: "#f4f5f7" }}>
              {(co.email || co.email2) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Mail size={10} color="#888" />
                  {co.email}{co.email2 ? <span style={{ color: "#888" }}> | {co.email2}</span> : ""}
                </span>
              )}
              {co.web && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Globe size={10} color="#888" /> {co.web}
                </span>
              )}
            </div>
          </div>
        );

      case "quote_meta":
        return (
          <div key={block.id} style={{ padding: "7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${brand.line}`, background: "#fff", breakInside: "avoid" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Quote No: <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{quote.ref}</span></span>
            <span style={{ fontSize: 12.5 }}>
              Date: <strong>{fmtDate(quote.created_at)}</strong>
              {quote.valid_until && <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Valid until: {fmtDate(quote.valid_until)}</span>}
            </span>
          </div>
        );

      case "bill_to":
        return (
          <div key={block.id} style={{ padding: "11px 28px", borderBottom: `1px solid ${brand.line}`, breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Quote for</SectionLabel>
            {account ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{account.name}</div>
                {account.city && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{account.city}</div>}
                {account.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.phone}</div>}
                {account.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.email}</div>}
                {contact && <div style={{ color: "#5f6b7a", fontSize: 12, marginTop: 4 }}>Attn: {contact.name}</div>}
              </>
            ) : <div style={{ color: "#8a96a5" }}>—</div>}
          </div>
        );

      case "intro_text":
        if (!block.content?.trim()) return null;
        return (
          <div key={block.id} style={{ margin: "12px 28px 0", color: "#3a4652", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", breakInside: "avoid" }}>
            {block.content}
          </div>
        );

      case "line_items":
        return (
          <table key={block.id}>
            <thead>
              <tr style={{ background: "#e6f1fb" }}>
                <th style={{ padding: "7px 28px 7px 28px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600, width: 32 }}>#</th>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Description</th>
                <th style={{ padding: "7px 12px", textAlign: "center", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>UOM</th>
                <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Qty</th>
                <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Rate (₹)</th>
                <th style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff", breakInside: "avoid" }}>
                  <td style={{ padding: "7px 12px 7px 28px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{l.sl_no ?? i + 1}</td>
                  <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{l.description}</td>
                  <td style={{ padding: "7px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{l.uom ?? ""}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{l.qty}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{l.rate.toLocaleString("en-IN")}</td>
                  <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );

      case "totals":
        return (
          <div key={block.id} style={{ borderTop: `1px solid ${brand.line}`, padding: "9px 28px", display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
            <table style={{ width: 300 }}>
              <tbody>
                <tr>
                  <td colSpan={2} style={{ paddingTop: 6 }}>
                    <div style={{ background: brand.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>{inr(total)}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );

      case "notes":
        if (!quote.notes) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${accent}`, breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Notes</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{quote.notes}</div>
          </div>
        );

      case "terms":
        if (!quote.terms) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.amber}`, breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Terms &amp; Conditions</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{quote.terms}</div>
          </div>
        );

      case "signature":
        return (
          <div key={block.id} style={{ margin: "8px 28px 16px", display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
            <div style={{ width: 220, textAlign: "center" }}>
              <div style={{ borderBottom: "1px solid #8a96a5", height: 40 }} />
              <div style={{ fontSize: 11, color: "#5f6b7a", marginTop: 4 }}>Authorized Signatory</div>
            </div>
          </div>
        );

      case "footer_text":
        if (!block.content?.trim()) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", color: "#5f6b7a", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: "center", breakInside: "avoid" }}>
            {block.content}
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="doc">
      {blocks.map(renderBlock)}

      {/* Fixed doc chrome -- company address footer, not template-configurable */}
      <div style={{ background: brand.dark, borderTop: `2px solid ${co.logo_bg}`, breakInside: "avoid" }}>
        {co.address && (
          <div style={{ padding: "6px 28px 3px", display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#8aa0b8" }}>
            <MapPin size={10} color="#8aa0b8" style={{ flexShrink: 0 }} />
            <span>{co.address}</span>
          </div>
        )}
        <div style={{ padding: "6px 28px", textAlign: "center", fontSize: 10.5, color: "#5a7494" }}>{co.name}</div>
      </div>
    </div>
  );
}
