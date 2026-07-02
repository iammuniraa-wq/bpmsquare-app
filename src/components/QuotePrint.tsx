"use client";

import type { Quote, QuoteLine, QuoteRevision, Account, Contact, Site } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import { COMPANY } from "@/lib/constants";

const STATUS_LABEL: Record<Quote["status"], string> = {
  draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected",
};

type Props = {
  quote: Quote;
  account: Account | null;
  contact: Contact | null;
  site: Site | null;
  lines: QuoteLine[];
  revisions: QuoteRevision[];
  companyInfo?: CompanyInfo;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Brand palette used inline so print colours are always exact.
const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

export default function QuotePrint({ quote, account, contact, site, lines, revisions, companyInfo = {} }: Props) {
  // Merge tenant overrides on top of system defaults
  const co = {
    tagline:          companyInfo.tagline          ?? COMPANY.tagline,
    undertaking:      companyInfo.undertaking      ?? COMPANY.undertaking,
    address:          companyInfo.address          ?? COMPANY.address,
    phone_dir_tech:   companyInfo.phone_dir_tech   ?? COMPANY.phone_dir_tech,
    phone_commercial: companyInfo.phone_commercial ?? COMPANY.phone_commercial,
    phone_work:       companyInfo.phone_work       ?? COMPANY.phone_work,
    landline:         companyInfo.landline         ?? COMPANY.landline,
    email:            companyInfo.email            ?? COMPANY.email,
    email2:           companyInfo.email2           ?? COMPANY.email2,
    web:              companyInfo.web              ?? COMPANY.web,
    gstin:            companyInfo.gstin            ?? COMPANY.gstin,
    iso:              companyInfo.iso              ?? COMPANY.iso,
    partners:         companyInfo.partners ?? null,
    partners_text:    COMPANY.partners,
    footer_tagline:   companyInfo.footer_tagline   ?? COMPANY.footer_tagline,
  };

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gst = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + gst;

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

      {/* ── Screen-only toolbar ─────────────────────────────── */}
      <div className="no-print" style={{ background: brand.dark, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => window.print()}
          style={{ background: brand.blue, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
        >
          ↓ Print / Save PDF
        </button>
        {/* Email — Coming Soon */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          📧 Email quote
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>
            SOON
          </span>
        </span>
        {/* WhatsApp — Coming Soon */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", color: "#6b8099", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          💬 WhatsApp
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f6b23c", background: "rgba(246,178,60,.15)", border: "1px solid rgba(246,178,60,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: 0.4 }}>
            SOON
          </span>
        </span>
        <button
          onClick={() => window.close()}
          style={{ background: "transparent", color: "#aebccd", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
        >
          Close
        </button>
        <span style={{ marginLeft: "auto", color: "#4a6278", fontSize: 11 }}>
          Save as PDF · use browser print dialog
        </span>
      </div>

      {/* ── A4 Document ─────────────────────────────────────── */}
      <div className="doc">

        {/* Header — letterhead */}
        <div style={{ background: brand.dark, padding: "20px 28px 16px" }}>
          {/* Top row: logo + identity (left) | quotation title + partners (right) */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>

            {/* Left: logo + company name + tagline + undertaking */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: 1 }}>
              <svg width="54" height="54" viewBox="0 0 100 100" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="50" cy="50" r="50" fill="#E65C00" />
                <circle cx="50" cy="50" r="43" fill="none" stroke="#FFB347" strokeWidth="2.5" />
                <text x="50" y="60" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="34" fill="#fff" letterSpacing="-1">VP</text>
              </svg>
              <div>
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, letterSpacing: 0.6, textTransform: "uppercase" }}>{COMPANY.name}</div>
                <div style={{ color: "#FFB347", fontSize: 11.5, fontWeight: 600, marginTop: 3 }}>{co.tagline}</div>
                <div style={{ color: "#8aa0b8", fontSize: 10, marginTop: 5, lineHeight: 1.55 }}>
                  We undertake: {co.undertaking}
                </div>
              </div>
            </div>

            {/* Right: Quotation title + ref + partners */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ color: "#fff", fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Quotation</div>
              <div style={{ color: brand.amber, fontSize: 13, fontWeight: 600, marginTop: 3, fontFamily: "monospace" }}>{quote.ref}</div>
              <div style={{ display: "inline-block", background: brand.amber, color: brand.dark, fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 4, marginTop: 5 }}>
                Rev. {quote.revision}
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ color: "#FFB347", fontWeight: 600, fontSize: 9.5, marginBottom: 5 }}>Authorised Channel Partner</div>
                {co.partners && co.partners.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                    {co.partners.map((p, i) => (
                      p.logo_url ? (
                        <img
                          key={i}
                          src={p.logo_url}
                          alt={p.name}
                          title={p.name}
                          style={{ height: 22, maxWidth: 52, objectFit: "contain", background: "#fff", borderRadius: 3, padding: "1px 4px" }}
                        />
                      ) : (
                        <span key={i} style={{ fontSize: 9.5, color: "#7a9ab8", background: "rgba(255,255,255,.08)", borderRadius: 3, padding: "2px 6px" }}>{p.name}</span>
                      )
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 9.5, color: "#7a9ab8" }}>{co.partners_text}</div>
                )}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", margin: "14px 0 10px" }} />

          {/* Contact grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 24px", fontSize: 10.5, color: "#8aa0b8", lineHeight: 1.75 }}>
            <span>📍 {co.address}</span>
            <span>✉ {co.email}{co.email2 ? ` · ${co.email2}` : ""}</span>
            <span>📞 Dir/Tech: {co.phone_dir_tech} · Commercial: {co.phone_commercial}</span>
            <span>🌐 {co.web}{co.landline ? ` · ☎ ${co.landline}` : ""}</span>
            <span style={{ color: "#FFB347" }}>GSTIN: {co.gstin}</span>
            {co.iso && <span style={{ color: "#FFB347" }}>{co.iso} Certified</span>}
          </div>
        </div>

        {/* Meta row */}
        <div style={{ background: brand.bg2, padding: "12px 28px", display: "flex", gap: 32, borderBottom: `1px solid ${brand.line}` }}>
          <Meta label="Date" value={fmtDate(quote.created_at)} />
          <Meta label="Valid until" value={quote.valid_until ? fmtDate(quote.valid_until) : "—"} />
          <Meta label="Status" value={STATUS_LABEL[quote.status]} />
          <Meta label="Revision" value={`Rev. ${quote.revision}`} />
        </div>

        {/* Bill To / Site */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: `1px solid ${brand.line}` }}>
          <div style={{ padding: "16px 28px", borderRight: `1px solid ${brand.line}` }}>
            <SectionLabel>Bill to</SectionLabel>
            {account && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{account.name}</div>
                {account.city && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{account.city}</div>}
                {account.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.phone}</div>}
                {account.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.email}</div>}
              </>
            )}
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
            ) : (
              <div style={{ color: "#8a96a5" }}>—</div>
            )}
            {site && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${brand.line}` }}>
                <SectionLabel>Site</SectionLabel>
                <div style={{ fontWeight: 500 }}>{site.label}</div>
                {site.address && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{site.address}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Scope of work heading */}
        <div style={{ padding: "12px 28px 0", borderBottom: `1px solid ${brand.line}` }}>
          <SectionLabel>Scope of work</SectionLabel>
        </div>

        {/* Line items */}
        <table style={{ margin: "0 0 0 0" }}>
          <thead>
            <tr style={{ background: "#e6f1fb" }}>
              <th style={{ padding: "9px 28px 9px 28px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600, width: 32 }}>#</th>
              <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Description</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Qty</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Rate (₹)</th>
              <th style={{ padding: "9px 28px 9px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Build print rows: group headers + indented lines + standalone lines
              const out: React.ReactNode[] = [];
              const seenGroups = new Set<string>();
              let lineNum = 1;

              for (const line of lines) {
                if (line.group_id) {
                  if (!seenGroups.has(line.group_id)) {
                    seenGroups.add(line.group_id);
                    out.push(
                      <tr key={`gh-${line.group_id}`} style={{ background: "#eaf2fb" }}>
                        <td colSpan={5} style={{ padding: "7px 28px", fontWeight: 700, fontSize: 11.5, color: "#0c447c", letterSpacing: 0.3 }}>
                          ▦ {line.group_label ?? "Group"}
                        </td>
                      </tr>
                    );
                  }
                  const n = lineNum++;
                  out.push(
                    <tr key={line.id}>
                      <td style={{ padding: "7px 12px 7px 40px", color: "#8a96a5", fontSize: 11 }}>{n}</td>
                      <td style={{ padding: "7px 12px 7px 8px", fontSize: 12.5 }}>{line.description}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>
                      <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>
                    </tr>
                  );
                } else {
                  const n = lineNum++;
                  const i = n - 1;
                  out.push(
                    <tr key={line.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff" }}>
                      <td style={{ padding: "9px 12px 9px 28px", color: "#8a96a5", fontSize: 11 }}>{n}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12.5 }}>{line.description}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>
                      <td style={{ padding: "9px 28px 9px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>
                    </tr>
                  );
                }
              }
              return out;
            })()}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ borderTop: `1px solid ${brand.line}`, padding: "12px 28px", display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: 260 }}>
            <tbody>
              <TotalRow label="Subtotal" value={inr(subtotal)} />
              <TotalRow label="GST @ 18%" value={inr(gst)} muted />
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

        {/* Notes */}
        {quote.notes && (
          <div style={{ margin: "0 28px 16px", background: brand.bg2, borderRadius: 6, padding: "12px 14px", borderLeft: `3px solid ${brand.blue}` }}>
            <SectionLabel>Notes &amp; terms</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.7 }}>{quote.notes}</div>
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
                {revisions.map((r, i) => (
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
            <div style={{ fontSize: 11, color: "#8a96a5", marginBottom: 36 }}>For {COMPANY.name}</div>
            <div style={{ borderTop: `1px solid ${brand.dark}`, paddingTop: 6, fontSize: 11, color: "#5f6b7a" }}>Authorised Signatory</div>
          </div>
          <div style={{ border: `1px solid ${brand.line}`, borderRadius: 6, padding: "16px 14px" }}>
            <div style={{ fontSize: 11, color: "#8a96a5", marginBottom: 36 }}>Customer acceptance — {account?.name ?? ""}</div>
            <div style={{ borderTop: `1px solid ${brand.line}`, paddingTop: 6, fontSize: 11, color: "#5f6b7a" }}>Name, Designation &amp; Stamp</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: brand.dark, borderTop: `2px solid #E65C00`, padding: "10px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5 }}>
            <span style={{ color: "#FFB347", fontStyle: "italic", fontWeight: 500 }}>{co.footer_tagline}</span>
            <span style={{ color: "#8aa0b8" }}>{quote.ref} · Rev. {quote.revision} · {fmtDate(new Date().toISOString())}</span>
          </div>
          <div style={{ color: "#5a7494", fontSize: 10, marginTop: 4, textAlign: "center" }}>
            {COMPANY.name} · GSTIN: {co.gstin} · {co.web}
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
