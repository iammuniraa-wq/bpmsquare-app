import type { Invoice, InvoiceLine, InvoicePayment, Account, Contact } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import type { TenantEntity, TenantTaxConfig } from "@/lib/constants";
import { Mail, Globe, MapPin } from "@/components/Icons";

export type InvoicePrintDocumentProps = {
  invoice: Invoice;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  account: Account | null;
  contact: Contact | null;
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  tenantEntities?: TenantEntity[];
  tenantTax?: TenantTaxConfig;
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// Pure printable document markup, shared by the on-screen preview (InvoicePrint.tsx) and the
// server-rendered PDF route (api/invoices/[id]/pdf) -- mirrors QuotePrintDocument.tsx.
export default function InvoicePrintDocument({
  invoice, lines, payments, account, contact,
  companyInfo = {}, logoUrl, tenantEntities = [], tenantTax,
}: InvoicePrintDocumentProps) {
  const entity = tenantEntities.find((e) => e.id === invoice.entity_id) ?? null;

  const co = {
    name:     entity?.name    ?? companyInfo.name    ?? "",
    tagline:  entity?.tagline ?? companyInfo.tagline  ?? "",
    address:  entity?.address ?? companyInfo.address  ?? "",
    email:    entity?.email   ?? companyInfo.email    ?? "",
    web:      companyInfo.web ?? "",
    gstin:    entity?.gstin   ?? companyInfo.gstin    ?? "",
    logo_url: companyInfo.logo_url ?? logoUrl ?? null,
    logo_bg:  companyInfo.logo_bg  ?? brand.blue,
    tax_label: companyInfo.tax_label ?? tenantTax?.label ?? "GST",
    tax_rate:  companyInfo.tax_rate  ?? tenantTax?.rate  ?? 18,
    email2: companyInfo.email2 ?? "",
  };

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discountAmt =
    invoice.discount_type === "pct"   ? Math.round(subtotal * (invoice.discount_pct ?? 0) / 100) :
    invoice.discount_type === "fixed" ? (invoice.discount_fixed ?? 0) : 0;
  const afterDiscount = subtotal - discountAmt;
  const tax = Math.round(afterDiscount * co.tax_rate / 100);
  const grandTotal = afterDiscount + tax;
  const balanceDue = grandTotal - (invoice.paid_amount ?? 0);

  const logoIni = initials(co.name || "?");

  return (
    <div className="doc">
      {/* Letterhead */}
      <div style={{ background: "#fff", borderBottom: `2px solid ${brand.dark}`, breakInside: "avoid" }}>
        <div style={{ padding: "4px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #dde2e8" }}>
          <span />
          {co.gstin && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1a2733" }}>GST No. {co.gstin}</span>}
        </div>
        <div style={{ padding: "10px 22px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {co.logo_url ? (
              <img src={co.logo_url} alt={co.name} style={{ height: 60, maxWidth: 80, objectFit: "contain", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, background: co.logo_bg || brand.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff" }}>
                {logoIni}
              </div>
            )}
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#B91C1C", letterSpacing: 0.4, textTransform: "uppercase", lineHeight: 1.15 }}>
                {co.name}
              </div>
              {co.tagline && (
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 3 }}>
                  {co.tagline}
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: brand.dark, letterSpacing: 2, textTransform: "uppercase" }}>
              Tax Invoice
            </div>
          </div>
        </div>
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

      {/* Invoice meta row */}
      <div style={{ padding: "7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${brand.line}`, background: "#fff", breakInside: "avoid" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Invoice No: <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{invoice.ref}</span></span>
        <span style={{ fontSize: 12.5 }}>
          Date: <strong>{fmtDate(invoice.issued_at)}</strong>
          {invoice.due_date && <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Due: {fmtDate(invoice.due_date)}</span>}
        </span>
      </div>

      {/* Bill To */}
      <div style={{ padding: "11px 28px", borderBottom: `1px solid ${brand.line}`, breakInside: "avoid" }}>
        <SectionLabel>Bill to</SectionLabel>
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

      {/* Line items */}
      <table>
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

      {/* Totals */}
      <div style={{ borderTop: `1px solid ${brand.line}`, padding: "9px 28px", display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
        <table style={{ width: 300 }}>
          <tbody>
            <TotalRow label="Subtotal" value={inr(subtotal)} />
            {discountAmt > 0 && (
              <TotalRow
                label={invoice.discount_type === "pct" ? `Discount @ ${invoice.discount_pct}%` : "Discount"}
                value={`− ${inr(discountAmt)}`} muted
              />
            )}
            <TotalRow label={`${co.tax_label} @ ${co.tax_rate}%`} value={inr(tax)} muted />
            <tr>
              <td colSpan={2} style={{ paddingTop: 6 }}>
                <div style={{ background: brand.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: brand.amber }}>{inr(grandTotal)}</span>
                </div>
              </td>
            </tr>
            {invoice.paid_amount > 0 && <TotalRow label="Paid to date" value={`− ${inr(invoice.paid_amount)}`} muted />}
            <tr>
              <td colSpan={2} style={{ paddingTop: 6 }}>
                <div style={{ background: balanceDue > 0 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${balanceDue > 0 ? "#fecaca" : "#bbf7d0"}`, borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: balanceDue > 0 ? "#a32d2d" : "#166534" }}>Balance due</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: balanceDue > 0 ? "#a32d2d" : "#166534" }}>{inr(balanceDue)}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Payment history */}
      {payments.length > 0 && (
        <div style={{ padding: "9px 28px 10px", borderTop: `1px solid ${brand.line}`, breakInside: "avoid" }}>
          <SectionLabel>Payment history</SectionLabel>
          <table>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: "3px 0", fontSize: 12, color: "#5f6b7a" }}>{fmtDate(p.paid_on)}{p.method ? ` — ${p.method}` : ""}{p.reference ? ` (${p.reference})` : ""}</td>
                  <td style={{ padding: "3px 0", fontSize: 12, textAlign: "right", color: "#1c2733" }}>{inr(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes / Terms */}
      {invoice.notes && (
        <div style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.blue}`, breakInside: "avoid" }}>
          <SectionLabel>Notes</SectionLabel>
          <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{invoice.notes}</div>
        </div>
      )}
      {invoice.terms && (
        <div style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.amber}`, breakInside: "avoid" }}>
          <SectionLabel>Terms &amp; Conditions</SectionLabel>
          <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{invoice.terms}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ background: brand.dark, borderTop: `2px solid ${co.logo_bg}`, breakInside: "avoid" }}>
        {co.address && (
          <div style={{ padding: "6px 28px 3px", display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#8aa0b8" }}>
            <MapPin size={10} color="#8aa0b8" style={{ flexShrink: 0 }} />
            <span>{co.address}</span>
            {co.gstin && <span style={{ marginLeft: "auto", color: brand.amber, fontWeight: 600 }}>GSTIN: {co.gstin}</span>}
          </div>
        )}
        <div style={{ padding: "6px 28px", textAlign: "center", fontSize: 10.5, color: "#5a7494" }}>{co.name}</div>
      </div>
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
