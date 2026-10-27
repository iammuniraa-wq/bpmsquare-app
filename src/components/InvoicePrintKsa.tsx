import type { Invoice, InvoiceLine, InvoicePayment, Account, Contact } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import type { CurrencyCode } from "@/lib/currency";
import { DOC_TITLE, PRINT_LABELS, VAT_CATEGORY_LABEL, type Bilingual, type PrintLabelKey } from "@/lib/einvoicing/labels";
import { printDate, printTime, type KsaPrintData } from "@/lib/einvoicing/printData";
import { fromHalalas } from "@/lib/einvoicing/totals";
import type { StructuredAddress } from "@/lib/einvoicing/rules";

// The bilingual (Arabic right-to-left + English) printed invoice for a Saudi e-invoicing workspace. Pure markup over data the
// server already computed (KsaPrintData); every label comes from src/lib/einvoicing/labels.ts. The font is the "PrintSans"
// face the print page already loads (DejaVu Sans, which carries the Arabic letters and their joining forms), so the PDF
// renderer needs nothing new. The QR is a clearly marked placeholder: the signed QR arrives with clearance (phase E3).

export type InvoicePrintKsaProps = {
  invoice: Invoice;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  account: Account | null;
  contact: Contact | null;
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  currency?: CurrencyCode;
  ksa: KsaPrintData;
};

const ink = "#1c2733";
const muted = "#5f6b7a";
const line = "#d0d7e0";
const dark = "#152233";

const amount = (halalas: number) =>
  fromHalalas(halalas).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function Bi({ k, strong, onDark }: { k: PrintLabelKey | Bilingual; strong?: boolean; onDark?: boolean }) {
  const l = typeof k === "string" ? PRINT_LABELS[k] : k;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", fontWeight: strong ? 700 : 600 }}>
      <span>{l.en}</span>
      <span dir="rtl" lang="ar" style={{ color: onDark ? "inherit" : muted, fontWeight: 400, opacity: onDark ? 0.85 : 1 }}>{l.ar}</span>
    </span>
  );
}

function Th({ k, align = "left" }: { k: PrintLabelKey; align?: "left" | "right" | "center" }) {
  const l = PRINT_LABELS[k];
  return (
    <th style={{ padding: "6px 8px", textAlign: align, fontSize: 10.5, color: "#0c447c", fontWeight: 600, verticalAlign: "bottom" }}>
      <div>{l.en}</div>
      <div dir="rtl" lang="ar" style={{ fontWeight: 400, color: muted }}>{l.ar}</div>
    </th>
  );
}

function addressLine(a: StructuredAddress): string {
  const first = [a.building_number, a.street].filter(Boolean).join(" ");
  return [first, a.district, a.city, a.postal_code, a.country].filter(Boolean).join(", ");
}

function Party({ title, name, nameAr, vat, crn, address }: { title: PrintLabelKey; name: string | null; nameAr: string | null; vat: string | null; crn: string | null; address: StructuredAddress }) {
  const addr = addressLine(address);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}><Bi k={title} /></div>
      {name && <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>}
      {nameAr && <div dir="rtl" lang="ar" style={{ fontWeight: 600, fontSize: 13 }}>{nameAr}</div>}
      {vat && <div style={{ fontSize: 11.5, color: muted, marginTop: 3 }}>{PRINT_LABELS.vatNumber.en} / <span dir="rtl" lang="ar">{PRINT_LABELS.vatNumber.ar}</span>: <span style={{ fontFamily: "monospace", color: ink }}>{vat}</span></div>}
      {crn && <div style={{ fontSize: 11.5, color: muted }}>{PRINT_LABELS.crn.en} / <span dir="rtl" lang="ar">{PRINT_LABELS.crn.ar}</span>: <span style={{ fontFamily: "monospace", color: ink }}>{crn}</span></div>}
      {addr && <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>{addr}</div>}
    </div>
  );
}

export default function InvoicePrintKsa({ invoice, lines, payments, companyInfo = {}, logoUrl, currency = "SAR", ksa }: InvoicePrintKsaProps) {
  const { totals, seller, buyer } = ksa;
  const title = DOC_TITLE[ksa.docType];
  const logo = companyInfo.logo_url ?? logoUrl ?? null;
  const sellerName = seller.name ?? companyInfo.name ?? "";
  const isNote = ksa.docType === "credit_note" || ksa.docType === "debit_note";
  const paid = invoice.paid_amount ?? 0;
  const payable = fromHalalas(totals.grandTotal);
  const balance = Math.max(0, payable - paid);
  const issued = ksa.issuedAt ?? invoice.issued_at ?? null;

  return (
    <div className="doc" lang="en" data-einvoice="ksa">
      {/* Title bar: English left, Arabic right */}
      <div style={{ background: dark, color: "#fff", padding: "12px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, breakInside: "avoid" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {logo && <img src={logo} alt={sellerName} style={{ height: 44, maxWidth: 64, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 3 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{sellerName}</div>
            {seller.name_ar && <div dir="rtl" lang="ar" style={{ fontSize: 14, fontWeight: 700 }}>{seller.name_ar}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1 }}>{title.en}</div>
          <div dir="rtl" lang="ar" style={{ fontSize: 17, fontWeight: 800 }}>{title.ar}</div>
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding: "8px 22px", display: "flex", flexWrap: "wrap", gap: "4px 28px", borderBottom: `1px solid ${line}`, fontSize: 12, breakInside: "avoid" }}>
        <span><Bi k="invoiceNumber" />: <span style={{ fontFamily: "monospace" }}>{invoice.ref}</span></span>
        <span><Bi k="issueDate" />: <strong>{printDate(issued) || "—"}</strong>{printTime(issued) && <> · <Bi k="issueTime" /> {printTime(issued)}</>}</span>
        {ksa.supplyDate && <span><Bi k="supplyDate" />: {printDate(ksa.supplyDate)}</span>}
        {invoice.due_date && <span><Bi k="dueDate" />: {printDate(invoice.due_date)}</span>}
        {isNote && ksa.originalRef && <span><Bi k="originalInvoice" />: <span style={{ fontFamily: "monospace" }}>{ksa.originalRef}</span></span>}
        {isNote && ksa.reason && <span><Bi k="reason" />: {ksa.reason}</span>}
      </div>

      {/* Parties */}
      <div style={{ padding: "10px 22px", display: "flex", gap: 24, borderBottom: `1px solid ${line}`, breakInside: "avoid" }}>
        <Party title="seller" name={sellerName || null} nameAr={seller.name_ar} vat={seller.vat_number} crn={seller.crn} address={seller.address} />
        <Party title="buyer" name={buyer.name} nameAr={buyer.name_ar} vat={buyer.vat_number} crn={buyer.crn} address={buyer.address} />
      </div>

      {/* Lines */}
      <table>
        <thead>
          <tr style={{ background: "#e6f1fb" }}>
            <Th k="lineNo" />
            <Th k="description" />
            <Th k="qty" align="right" />
            <Th k="rate" align="right" />
            <Th k="taxRate" align="right" />
            <Th k="amount" align="right" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff", breakInside: "avoid" }}>
              <td style={{ padding: "6px 8px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{l.sl_no ?? i + 1}</td>
              <td style={{ padding: "6px 8px", fontSize: 12 }}>{l.description}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, color: muted }}>{number(l.qty)}{l.uom ? ` ${l.uom}` : ""}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, color: muted }}>{number(l.rate)}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, color: muted }}>
                {l.vat_category ? `${l.vat_category} ${number(l.vat_rate ?? 0)}%` : "—"}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, fontWeight: 500 }}>{number(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* VAT by rate + totals */}
      <div style={{ borderTop: `1px solid ${line}`, padding: "10px 22px", display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-between", breakInside: "avoid" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}><Bi k="vatBreakdown" /></div>
          <table>
            <thead>
              <tr>
                <Th k="category" />
                <Th k="taxRate" align="right" />
                <Th k="taxable" align="right" />
                <Th k="vat" align="right" />
              </tr>
            </thead>
            <tbody>
              {totals.groups.map((g, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 8px", fontSize: 11.5 }}>
                    {g.category ? <Bi k={VAT_CATEGORY_LABEL[g.category]} /> : <Bi k="notSet" />}
                    {g.reasons.length > 0 && <div style={{ color: muted, fontSize: 10.5 }}>{g.reasons.join("; ")}</div>}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 11.5 }}>{g.rate == null ? "—" : `${number(g.rate)}%`}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 11.5 }}>{amount(g.taxable)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 11.5 }}>{amount(g.vat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ flex: "0 1 320px", minWidth: 0 }}>
          <table>
            <tbody>
              <TotalRow k="subtotal" value={amount(totals.subtotal)} />
              {totals.discount > 0 && <TotalRow k="discount" value={`− ${amount(totals.discount)}`} muted />}
              <TotalRow k="taxableTotal" value={amount(totals.taxableTotal)} />
              <TotalRow k="vatTotal" value={amount(totals.vatTotal)} />
              <tr>
                <td colSpan={2} style={{ paddingTop: 6 }}>
                  <div style={{ background: dark, color: "#fff", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12 }}><Bi k="grandTotal" strong onDark /></span>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{currency} {amount(totals.grandTotal)}</span>
                  </div>
                </td>
              </tr>
              {!isNote && paid > 0 && <TotalRow k="paid" value={`− ${number(paid)}`} muted />}
              {!isNote && paid > 0 && <TotalRow k="balance" value={number(balance)} />}
            </tbody>
          </table>
        </div>
      </div>

      {payments.length > 0 && !isNote && (
        <div style={{ padding: "6px 22px 8px", borderTop: `1px solid ${line}`, fontSize: 11.5, color: muted, breakInside: "avoid" }}>
          {payments.map((p) => <div key={p.id}>{printDate(p.paid_on)}{p.method ? ` — ${p.method}` : ""}{p.reference ? ` (${p.reference})` : ""}: {number(p.amount)}</div>)}
        </div>
      )}

      {invoice.notes && (
        <div style={{ margin: "0 22px 10px", background: "#f4f6f9", borderRadius: 6, padding: "8px 12px", borderLeft: "3px solid #378ADD", breakInside: "avoid" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}><Bi k="notes" /></div>
          <div style={{ color: muted, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{invoice.notes}</div>
        </div>
      )}
      {invoice.terms && (
        <div style={{ margin: "0 22px 10px", background: "#f4f6f9", borderRadius: 6, padding: "8px 12px", borderLeft: "3px solid #F6B23C", breakInside: "avoid" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}><Bi k="terms" /></div>
          <div style={{ color: muted, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{invoice.terms}</div>
        </div>
      )}

      {/* QR placeholder + identity */}
      <div style={{ borderTop: `1px solid ${line}`, padding: "10px 22px", display: "flex", gap: 16, alignItems: "center", breakInside: "avoid" }}>
        <div
          data-einvoice-qr="placeholder"
          style={{ width: 96, height: 96, flexShrink: 0, border: `2px dashed ${line}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 9, color: "#8a96a5", padding: 6 }}
        >
          QR
        </div>
        <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.5, minWidth: 0 }}>
          <div>{PRINT_LABELS.qrNotice.en}</div>
          <div dir="rtl" lang="ar">{PRINT_LABELS.qrNotice.ar}</div>
          {ksa.uuid && <div style={{ marginTop: 4 }}>{PRINT_LABELS.uuid.en}: <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{ksa.uuid}</span></div>}
          {ksa.seq != null && <div>{PRINT_LABELS.counter.en} / <span dir="rtl" lang="ar">{PRINT_LABELS.counter.ar}</span>: <span style={{ fontFamily: "monospace" }}>{ksa.seq}</span></div>}
        </div>
      </div>

      <div style={{ background: dark, padding: "6px 22px", textAlign: "center", fontSize: 10.5, color: "#8aa0b8", breakInside: "avoid" }}>
        {sellerName}{seller.vat_number ? ` · ${PRINT_LABELS.vatNumber.en} ${seller.vat_number}` : ""}
      </div>
    </div>
  );
}

function TotalRow({ k, value, muted: dim }: { k: PrintLabelKey; value: string; muted?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "3px 0", fontSize: 11.5, color: dim ? "#8a96a5" : ink }}><Bi k={k} /></td>
      <td style={{ padding: "3px 0", fontSize: 12, textAlign: "right", color: dim ? "#8a96a5" : ink, whiteSpace: "nowrap" }}>{value}</td>
    </tr>
  );
}
