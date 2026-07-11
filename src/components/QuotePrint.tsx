"use client";

import type { Quote, QuoteLine, QuoteRevision, Account, Contact, Site } from "@/lib/types";
// QuoteLine is used via inline cast for group_description field added in migration 0012
import type { CompanyInfo } from "@/lib/tenant";
import type { TenantEntity, TenantTaxConfig } from "@/lib/constants";
import { MapPin, Mail, Phone, Globe, MessageSquare } from "@/components/Icons";

const STATUS_LABEL: Record<Quote["status"], string> = {
  draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected",
};

const OFFER_TITLE: Record<string, string> = {
  quotation: "Quotation",
  technical: "Technical Offer",
  budgetary: "Budgetary Offer",
  supply: "Supply Quotation",
  repair: "Repair Quotation",
};

type Props = {
  quote: Quote;
  account: Account | null;
  contact: Contact | null;
  site: Site | null;
  lines: QuoteLine[];
  revisions: QuoteRevision[];
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  tenantEntities?: TenantEntity[];
  tenantTax?: TenantTaxConfig;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default function QuotePrint({
  quote, account, contact, site, lines, revisions,
  companyInfo = {}, logoUrl, tenantEntities = [], tenantTax,
}: Props) {
  const isTechnical = quote.type === "technical";

  // If quote has an entity_id, override company details from that entity
  const entity = tenantEntities.find((e) => e.id === quote.entity_id) ?? null;

  const co = {
    name:           entity?.name             ?? companyInfo.name           ?? "",
    tagline:        entity?.tagline          ?? companyInfo.tagline        ?? "",
    address:        entity?.address          ?? companyInfo.address        ?? "",
    phone:          entity?.phone            ?? null,
    email:          entity?.email            ?? companyInfo.email          ?? "",
    web:            companyInfo.web          ?? "",
    gstin:          entity?.gstin            ?? companyInfo.gstin          ?? "",
    logo_url:       companyInfo.logo_url     ?? logoUrl                    ?? null,
    logo_bg:        companyInfo.logo_bg      ?? brand.blue,
    undertaking:    companyInfo.undertaking  ?? "",
    iso:            companyInfo.iso          ?? "",
    footer_tagline: companyInfo.footer_tagline ?? "",
    partners:       companyInfo.partners     ?? [],
    // Generic phones list; fall back to legacy fields if present
    phones: companyInfo.phones ?? [
      companyInfo.phone_dir_tech    ? { label: "Dir / Tech",   number: companyInfo.phone_dir_tech }    : null,
      companyInfo.phone_commercial  ? { label: "Commercial",   number: companyInfo.phone_commercial }  : null,
      companyInfo.phone_work        ? { label: "Work",         number: companyInfo.phone_work }        : null,
      companyInfo.landline          ? { label: "Landline",     number: companyInfo.landline }          : null,
    ].filter((p): p is { label: string; number: string } => p !== null),
    tax_label: companyInfo.tax_label ?? tenantTax?.label ?? "GST",
    tax_rate:  companyInfo.tax_rate  ?? tenantTax?.rate  ?? 18,
    email2: companyInfo.email2 ?? "",
  };

  const selectedAltId = quote.selected_option_id ?? null;
  const subtotal = lines
    .filter((l) => !l.group_id || l.group_type !== "alternative" || l.group_id === selectedAltId)
    .reduce((s, l) => s + l.amount, 0);
  const discountAmt =
    quote.discount_type === "pct"   ? Math.round(subtotal * (quote.discount_pct ?? 0) / 100) :
    quote.discount_type === "fixed" ? (quote.discount_fixed ?? 0) : 0;
  const afterDiscount = subtotal - discountAmt;
  const tax = Math.round(afterDiscount * co.tax_rate / 100);
  const grandTotal = afterDiscount + tax;

  const logoIni = initials(co.name || "?");

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

      {/* Screen-only toolbar */}
      <div className="no-print" style={{ background: brand.dark, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
        <button onClick={() => window.print()} style={{ background: brand.blue, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          ↓ Print / Save PDF
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          Email quote
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>SOON</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          <MessageSquare size={13} color="#6b8099" style={{ marginRight: 4 }} /> WhatsApp
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>SOON</span>
        </span>
        <button onClick={() => window.close()} style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Close</button>
        <span style={{ marginLeft: "auto", color: "#4a6278", fontSize: 11 }}>Save as PDF · use browser print dialog</span>
      </div>

      {/* A4 Document */}
      <div className="doc">

        {/* ── WHITE LETTERHEAD HEADER ── */}
        <div style={{ background: "#fff", borderBottom: `2px solid ${brand.dark}` }}>

          {/* Row 1: ISO / accreditation (left) | GST (right) */}
          <div style={{ padding: "6px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #dde2e8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {co.iso && (
                <span style={{ fontSize: 9, fontWeight: 700, color: "#333", border: "1px solid #999", padding: "1px 6px", borderRadius: 2, letterSpacing: 0.4 }}>
                  {co.iso}
                </span>
              )}
            </div>
            {co.gstin && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1a2733" }}>GST No. {co.gstin}</span>
            )}
          </div>

          {/* Row 2: Logo + Company name + tagline | Doc title */}
          <div style={{ padding: "14px 22px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>

            {/* Left: logo + name + tagline */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {co.logo_url ? (
                <img src={co.logo_url} alt={co.name} style={{ height: 72, maxWidth: 90, objectFit: "contain", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 72, height: 72, borderRadius: 10, flexShrink: 0, background: co.logo_bg || brand.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900, color: "#fff" }}>
                  {logoIni}
                </div>
              )}
              <div>
                <div style={{ fontSize: 21, fontWeight: 900, color: "#B91C1C", letterSpacing: 0.4, textTransform: "uppercase", lineHeight: 1.15 }}>
                  {co.name}
                </div>
                {co.tagline && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 5 }}>
                    {co.tagline}
                  </div>
                )}
              </div>
            </div>

            {/* Right: document type + ref */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: brand.dark, letterSpacing: 2, textTransform: "uppercase" }}>
                {OFFER_TITLE[quote.type] ?? "Quotation"}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#5f6b7a", marginTop: 3 }}>{quote.ref}</div>
              <div style={{ display: "inline-block", background: brand.amber, color: brand.dark, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 3, marginTop: 4 }}>
                Rev. {quote.revision}
              </div>
            </div>
          </div>

          {/* Row 3: Authorised Channel Partner pill + partner logos */}
          {co.partners.length > 0 && (
            <>
              <div style={{ borderTop: "1px solid #dde2e8", margin: "0 22px" }} />
              <div style={{ padding: "7px 22px 3px", textAlign: "center" }}>
                <span style={{ display: "inline-block", border: "1px solid #555", borderRadius: 20, padding: "2px 16px", fontSize: 9.5, fontWeight: 700, color: "#333", letterSpacing: 0.6 }}>
                  Authorised Channel Partner
                </span>
              </div>
              <div style={{ padding: "6px 22px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                {co.partners.map((p, i) => (
                  p.logo_url ? (
                    <img key={i} src={p.logo_url} alt={p.name} title={p.name} style={{ height: 32, maxWidth: 88, objectFit: "contain" }} />
                  ) : (
                    <span key={i} style={{ fontSize: 11, fontWeight: 800, color: "#111", letterSpacing: 0.1 }}>{p.name}</span>
                  )
                ))}
              </div>
            </>
          )}

          {/* Row 4: Undertaking strip */}
          {co.undertaking && (
            <div style={{ borderTop: "1px solid #dde2e8", padding: "5px 22px", textAlign: "center", fontSize: 9.5, color: "#444", background: "#f8f9fb" }}>
              We Undertake: {co.undertaking}
            </div>
          )}

          {/* Row 5: Email | Web contact strip */}
          <div style={{ borderTop: "1px solid #dde2e8", padding: "5px 22px", display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", fontSize: 10, color: "#555", background: "#f4f5f7" }}>
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

        {/* Ref / Date row */}
        <div style={{ padding: "10px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${brand.line}`, background: "#fff" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Ref No: <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{quote.ref}</span></span>
          <span style={{ fontSize: 12.5 }}>Date: <strong>{fmtDate(quote.created_at)}</strong>{quote.valid_until ? <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Valid until: {fmtDate(quote.valid_until)}</span> : ""}</span>
        </div>

        {/* Bill To / Attention */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: `1px solid ${brand.line}` }}>
          <div style={{ padding: "16px 28px", borderRight: `1px solid ${brand.line}` }}>
            <SectionLabel>Bill to</SectionLabel>
            {account ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{account.name}</div>
                {account.city && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{account.city}</div>}
                {account.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.phone}</div>}
                {account.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.email}</div>}
                {quote.pr_no && <div style={{ color: "#5f6b7a", fontSize: 12, marginTop: 4 }}>PR No.: <strong style={{ color: "#1c2733" }}>{quote.pr_no}</strong></div>}
              </>
            ) : <div style={{ color: "#8a96a5" }}>—</div>}
          </div>
          <div style={{ padding: "16px 28px" }}>
            <SectionLabel>Attention</SectionLabel>
            {contact ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{contact.name}</div>
                {contact.role && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{contact.role}</div>}
                {contact.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{contact.phone}</div>}
                {contact.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{contact.email}</div>}
              </>
            ) : <div style={{ color: "#8a96a5" }}>—</div>}
            {site && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${brand.line}` }}>
                <SectionLabel>Site</SectionLabel>
                <div style={{ fontWeight: 500 }}>{site.label}</div>
                {site.address && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{site.address}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Subject & salutation */}
        {quote.name && (
          <div style={{ padding: "12px 28px", borderBottom: `1px solid ${brand.line}` }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>Subject:</strong> {quote.name}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Dear Sir,</div>
            <div style={{ fontSize: 12.5, color: "#5f6b7a", marginTop: 4, lineHeight: 1.6 }}>
              With reference to the above subject, we are herewith submitting our quotation for the above said work.
            </div>
          </div>
        )}

        {/* Line items */}
        <table>
          <thead>
            <tr style={{ background: "#e6f1fb" }}>
              <th style={{ padding: "9px 28px 9px 28px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600, width: 32 }}>#</th>
              <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Description</th>
              <th style={{ padding: "9px 12px", textAlign: "center", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>UOM</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Qty</th>
              {!isTechnical && <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Rate (₹)</th>}
              {!isTechnical && <th style={{ padding: "9px 28px 9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Amount (₹)</th>}
              {isTechnical && <th style={{ padding: "9px 28px 9px 12px" }} />}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const out: React.ReactNode[] = [];
              const seenGroups = new Set<string>();
              let standaloneNum = 0;
              const groupItemCount: Record<string, number> = {};
              const colSpan = isTechnical ? 4 : 6;

              // Pre-compute per-group totals for subtotal rows
              const groupTotals: Record<string, number> = {};
              for (const l of lines) {
                if (l.group_id) groupTotals[l.group_id] = (groupTotals[l.group_id] ?? 0) + l.amount;
              }

              // Track which groups we've already emitted a subtotal for
              const closedGroups = new Set<string>();

              for (let idx = 0; idx < lines.length; idx++) {
                const line = lines[idx];
                const nextLine = lines[idx + 1];

                if (line.group_id) {
                  const isAlt = line.group_type === "alternative";
                  const isSelected = !isAlt || line.group_id === selectedAltId;
                  const headerBg    = isAlt ? (isSelected ? "#fffbeb" : "#fafafa") : "#eaf2fb";
                  const headerColor = isAlt ? (isSelected ? "#92400e" : "#9ca3af") : "#0c447c";
                  const rowOpacity  = isAlt && !isSelected ? 0.45 : 1;

                  if (!seenGroups.has(line.group_id)) {
                    seenGroups.add(line.group_id);
                    standaloneNum++;
                    groupItemCount[line.group_id] = 0;
                    const groupDesc = line.group_description;
                    out.push(
                      <tr key={`gh-${line.group_id}`} style={{ background: headerBg }}>
                        <td colSpan={colSpan} style={{ padding: "7px 28px", fontWeight: 700, fontSize: 11.5, color: headerColor, letterSpacing: 0.3 }}>
                          <span>{isAlt ? (isSelected ? "✓ " : "✗ ") : ""}{line.group_label ?? (isAlt ? "Option" : "Group")}</span>
                          {groupDesc && <span style={{ fontWeight: 400, color: isAlt ? "#92400e" : "#3a6fa8", marginLeft: 8, fontSize: 11 }}>— {groupDesc}</span>}
                          {isAlt && !isSelected && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 8 }}>(not selected)</span>}
                        </td>
                      </tr>
                    );
                  }
                  groupItemCount[line.group_id] = (groupItemCount[line.group_id] ?? 0) + 1;
                  const slNo = line.sl_no || `${standaloneNum}.${groupItemCount[line.group_id]}`;
                  out.push(
                    <tr key={line.id} style={{ opacity: rowOpacity }}>
                      <td style={{ padding: "7px 12px 7px 40px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{slNo}</td>
                      <td style={{ padding: "7px 12px 7px 8px", fontSize: 12.5 }}>{line.description}</td>
                      <td style={{ padding: "7px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{line.uom ?? ""}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                      {!isTechnical && <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>}
                      {!isTechnical && <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>}
                      {isTechnical && <td />}
                    </tr>
                  );

                  // Emit group subtotal when this is the last line in the group
                  const isLastInGroup = !nextLine || nextLine.group_id !== line.group_id;
                  if (isLastInGroup && !closedGroups.has(line.group_id) && !isTechnical) {
                    closedGroups.add(line.group_id);
                    out.push(
                      <tr key={`gt-${line.group_id}`} style={{ background: headerBg }}>
                        <td colSpan={colSpan - 1} style={{ padding: "6px 12px 6px 28px", textAlign: "right", fontSize: 11.5, fontWeight: 600, color: headerColor }}>
                          {line.group_label ?? "Group"} Total
                        </td>
                        <td style={{ padding: "6px 28px 6px 12px", textAlign: "right", fontSize: 12.5, fontWeight: 700, color: headerColor }}>
                          {inr(groupTotals[line.group_id] ?? 0)}
                        </td>
                      </tr>
                    );
                  }
                } else {
                  standaloneNum++;
                  const slNo = line.sl_no || String(standaloneNum);
                  const i = standaloneNum - 1;
                  out.push(
                    <tr key={line.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff" }}>
                      <td style={{ padding: "9px 12px 9px 28px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{slNo}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12.5 }}>{line.description}</td>
                      <td style={{ padding: "9px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{line.uom ?? ""}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                      {!isTechnical && <td style={{ padding: "9px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>}
                      {!isTechnical && <td style={{ padding: "9px 28px 9px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>}
                      {isTechnical && <td style={{ padding: "9px 28px" }} />}
                    </tr>
                  );
                }
              }
              return out;
            })()}
          </tbody>
        </table>

        {/* Totals — hidden for technical offers */}
        {!isTechnical && (
          <div style={{ borderTop: `1px solid ${brand.line}`, padding: "12px 28px", display: "flex", justifyContent: "flex-end" }}>
            <table style={{ width: 300 }}>
              <tbody>
                <TotalRow label="Subtotal" value={inr(subtotal)} />
                {discountAmt > 0 && (
                  <TotalRow
                    label={quote.discount_type === "pct"
                      ? `Discount @ ${quote.discount_pct}%`
                      : "Discount"}
                    value={`− ${inr(discountAmt)}`}
                    muted
                  />
                )}
                {discountAmt > 0 && <TotalRow label="Net cost after discount" value={inr(afterDiscount)} />}
                <TotalRow label={`${co.tax_label} @ ${co.tax_rate}%`} value={inr(tax)} muted />
                <tr>
                  <td colSpan={2} style={{ paddingTop: 6 }}>
                    <div style={{ background: brand.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: brand.amber }}>{inr(grandTotal)}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Closing sentence */}
        <div style={{ padding: "10px 28px 14px", borderTop: `1px solid ${brand.line}` }}>
          <div style={{ fontSize: 12.5, color: "#5f6b7a", fontStyle: "italic" }}>
            We kindly request you to give us an opportunity to serve your organization.
          </div>
        </div>

        {/* Scope of work — after totals, per reference layout */}
        {quote.scope_of_work && (
          <div style={{ padding: "12px 28px 14px", borderTop: `1px solid ${brand.line}` }}>
            <SectionLabel>Scope of work</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{quote.scope_of_work}</div>
          </div>
        )}

        {/* Notes */}
        {quote.notes && (
          <div style={{ margin: "0 28px 16px", background: brand.bg2, borderRadius: 6, padding: "12px 14px", borderLeft: `3px solid ${brand.blue}` }}>
            <SectionLabel>Notes</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{quote.notes}</div>
          </div>
        )}

        {/* Terms & Conditions */}
        {quote.terms && (
          <div style={{ margin: "0 28px 16px", background: brand.bg2, borderRadius: 6, padding: "12px 14px", borderLeft: `3px solid ${brand.amber}` }}>
            <SectionLabel>Terms &amp; Conditions</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{quote.terms}</div>
          </div>
        )}

        {/* Revision history */}
        {revisions.length > 0 && (
          <div style={{ margin: "0 28px 16px" }}>
            <SectionLabel>Revision history</SectionLabel>
            <table style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${brand.line}` }}>
              <thead>
                <tr style={{ background: brand.bg2 }}>
                  <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#5f6b7a", fontWeight: 600, width: 60 }}>Rev</th>
                  <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#5f6b7a", fontWeight: 600, width: 110 }}>Date</th>
                  <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#5f6b7a", fontWeight: 600 }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${brand.line}`, background: r.rev === quote.revision ? "#fffdf5" : "#fff" }}>
                    <td style={{ padding: "8px 12px", fontSize: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        Rev. {r.rev}
                        {r.rev === quote.revision && (
                          <span style={{ fontSize: 9, background: brand.amber, color: brand.dark, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>current</span>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: "#5f6b7a" }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: "8px 12px", fontSize: 12 }}>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Signature block */}
        <div style={{ margin: "8px 28px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div style={{ border: `1px solid ${brand.line}`, borderRadius: 6, padding: "16px 14px" }}>
            <div style={{ fontSize: 11, color: "#8a96a5", marginBottom: 36 }}>For {co.name}</div>
            <div style={{ borderTop: `1px solid ${brand.dark}`, paddingTop: 6, fontSize: 11, color: "#5f6b7a" }}>Authorised Signatory</div>
          </div>
          <div style={{ border: `1px solid ${brand.line}`, borderRadius: 6, padding: "16px 14px" }}>
            <div style={{ fontSize: 11, color: "#8a96a5", marginBottom: 36 }}>Customer acceptance — {account?.name ?? ""}</div>
            <div style={{ borderTop: `1px solid ${brand.line}`, paddingTop: 6, fontSize: 11, color: "#5f6b7a" }}>Name, Designation &amp; Stamp</div>
          </div>
        </div>

        {/* Footer — mirrors the PDF sample: address row · phones grid · tagline */}
        <div style={{ background: brand.dark, borderTop: `2px solid ${co.logo_bg}` }}>
          {/* Address row */}
          {co.address && (
            <div style={{ padding: "8px 28px 4px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#8aa0b8" }}>
              <MapPin size={10} color="#8aa0b8" style={{ flexShrink: 0 }} />
              <span>{co.address}</span>
              {co.gstin && <span style={{ marginLeft: "auto", color: brand.amber, fontWeight: 600 }}>GSTIN: {co.gstin}</span>}
            </div>
          )}
          {/* Phones grid row */}
          {co.phones.length > 0 && (
            <div style={{ padding: "6px 28px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", flexWrap: "wrap", gap: "4px 28px", fontSize: 10.5 }}>
              {co.phones.map((p, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#8aa0b8" }}>{p.label}</span>
                  <span style={{ color: "#b0c4d8", fontWeight: 600 }}> — {p.number}</span>
                </span>
              ))}
              {co.phone && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#8aa0b8" }}>Phone</span>
                  <span style={{ color: "#b0c4d8", fontWeight: 600 }}> — {co.phone}</span>
                </span>
              )}
            </div>
          )}
          {/* Tagline + ref row */}
          <div style={{ padding: "7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5 }}>
            {co.footer_tagline
              ? <span style={{ color: brand.amber, fontStyle: "italic", fontWeight: 500 }}>{co.footer_tagline} ☺</span>
              : <span style={{ color: "#5a7494" }}>{co.name}</span>
            }
            <span style={{ color: "#5a7494" }}>{quote.ref} · Rev. {quote.revision}</span>
          </div>
        </div>

      </div>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#8a96a5", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontWeight: 500, fontSize: 12.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "4px 0", fontSize: 12.5, color: muted ? "#8a96a5" : "#1c2733" }}>{label}</td>
      <td style={{ padding: "4px 0", fontSize: 12.5, textAlign: "right", color: muted ? "#8a96a5" : "#1c2733" }}>{value}</td>
    </tr>
  );
}
