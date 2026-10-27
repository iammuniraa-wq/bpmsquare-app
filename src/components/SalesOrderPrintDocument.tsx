import type { Account, Contact, StandardQuoteTemplateBlock } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import { Mail, Globe, MapPin } from "@/components/Icons";
import { CURRENCIES, DEFAULT_CURRENCY, isCurrencyCode, moneyFormatter, moneyLabel } from "@/lib/currency";
import type { OrderParty, SalesOrder, SalesOrderLine } from "@/lib/salesOrders/types";

// The printed sales order: an ordered list of blocks chosen by the order TYPE (the standard-quote block model, so a
// type can hide the intro, the notes or the signature and pick an accent colour and logo side), the order's own lines
// with their printed text under each line, and the totals as stored. Presentational only: no hooks, so it renders both
// in the staff print page and in the signed public page, and in the headless browser that makes the PDF.

export type SalesOrderPrintDocumentProps = {
  order: SalesOrder;
  lines: SalesOrderLine[];
  account: Account | null;
  contact: Contact | null;
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  blocks: StandardQuoteTemplateBlock[];
  accent?: string | null;
  logoPosition?: "left" | "center" | "right";
  /** Workspace currency, used when the order carries none we know. */
  fallbackCurrency?: string;
};

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function SectionLabel({ children, accent }: { children: React.ReactNode; accent: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{children}</div>;
}

function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: "2px 0", fontSize: 12, color: "#5f6b7a" }}>{label}</td>
      <td style={{ padding: "2px 0", fontSize: 12, color: "#5f6b7a", textAlign: "right" }}>{value}</td>
    </tr>
  );
}

function parseSpecs(content: string): { label: string; value: string }[] {
  return content.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return i === -1 ? { label: line, value: "" } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  });
}

function PartyBlock({ title, party, accent }: { title: string; party: OrderParty; accent: string }) {
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <SectionLabel accent={accent}>{title}</SectionLabel>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{party.name}</div>
      {party.address && <div style={{ color: "#5f6b7a", marginTop: 2, whiteSpace: "pre-wrap" }}>{party.address}</div>}
      {party.contact && <div style={{ color: "#5f6b7a", fontSize: 12, marginTop: 4 }}>Attn: {party.contact}</div>}
      {party.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{party.phone}</div>}
      {party.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{party.email}</div>}
      {party.tax_id && <div style={{ color: "#5f6b7a", fontSize: 12 }}>Tax ID: {party.tax_id}</div>}
    </div>
  );
}

export default function SalesOrderPrintDocument({
  order, lines, account, contact, companyInfo = {}, logoUrl, blocks, accent: accentIn, logoPosition = "left", fallbackCurrency = DEFAULT_CURRENCY,
}: SalesOrderPrintDocumentProps) {
  const code = isCurrencyCode(order.currency) ? order.currency : isCurrencyCode(fallbackCurrency) ? fallbackCurrency : DEFAULT_CURRENCY;
  const cur = CURRENCIES[code];
  const money = moneyFormatter(cur, { maximumFractionDigits: 2 });
  const co = {
    name: companyInfo.name ?? "",
    tagline: companyInfo.tagline ?? "",
    address: companyInfo.address ?? "",
    email: companyInfo.email ?? "",
    web: companyInfo.web ?? "",
    logo_url: companyInfo.logo_url ?? logoUrl ?? null,
    logo_bg: companyInfo.logo_bg ?? brand.blue,
  };
  const accent = accentIn || brand.blue;
  const soldTo: OrderParty | null = account ? { name: account.name, address: [account.address_line1, account.address_line2, account.city, account.country].filter(Boolean).join(", ") || null, contact: contact?.name ?? null, phone: account.phone, email: account.email, tax_id: account.gstin } : null;

  const logoBlock = co.logo_url ? (
    <img src={co.logo_url} alt={co.name} style={{ height: 60, maxWidth: 80, objectFit: "contain", flexShrink: 0 }} />
  ) : (
    <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, background: co.logo_bg || brand.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff" }}>
      {initials(co.name || "?")}
    </div>
  );
  const nameBlock = (
    <div style={{ textAlign: logoPosition === "center" ? "center" : logoPosition === "right" ? "right" : "left" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: brand.dark, letterSpacing: 0.4, lineHeight: 1.15 }}>{co.name}</div>
      {co.tagline && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 3 }}>{co.tagline}</div>}
    </div>
  );
  const titleBlock = <div style={{ fontSize: 17, fontWeight: 800, color: brand.dark, letterSpacing: 2, textTransform: "uppercase" }}>Sales Order</div>;

  const showBreakdown = order.discount_total > 0 || order.tax_total > 0 || order.shipping_amount > 0;
  const showDiscountCol = lines.some((l) => Number(l.discount_pct) > 0);
  const showTaxCol = lines.some((l) => Number(l.tax_pct) > 0);

  function renderBlock(block: StandardQuoteTemplateBlock) {
    if (!block.visible) return null;
    switch (block.type) {
      case "letterhead":
        return (
          <div key={block.id} style={{ background: "#fff", borderBottom: `2px solid ${brand.dark}`, breakInside: "avoid" }}>
            {logoPosition === "center" ? (
              <div style={{ padding: "10px 22px 9px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                {logoBlock}{nameBlock}<div style={{ marginTop: 4 }}>{titleBlock}</div>
              </div>
            ) : (
              <div style={{ padding: "10px 22px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexDirection: logoPosition === "right" ? "row-reverse" : "row" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexDirection: logoPosition === "right" ? "row-reverse" : "row" }}>{logoBlock}{nameBlock}</div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>{titleBlock}</div>
              </div>
            )}
            <div style={{ borderTop: "1px solid #dde2e8", padding: "2.5px 22px", display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", fontSize: 10, color: "#555", background: "#f4f5f7" }}>
              {co.email && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={10} color="#888" />{co.email}</span>}
              {co.web && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Globe size={10} color="#888" /> {co.web}</span>}
            </div>
          </div>
        );

      case "quote_meta":
        return (
          <div key={block.id} style={{ padding: "7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: `1px solid ${brand.line}`, background: "#fff", breakInside: "avoid" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              Order No: <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{order.ref}</span>
              {order.customer_po && <span style={{ marginLeft: 24, fontWeight: 400, color: "#5f6b7a" }}>Your PO: {order.customer_po}</span>}
            </span>
            <span style={{ fontSize: 12.5 }}>
              Date: <strong>{fmtDate(order.confirmed_at ?? order.created_at)}</strong>
              {order.requested_date && <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Requested: {fmtDate(order.requested_date)}</span>}
              {order.expected_date && <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Expected: {fmtDate(order.expected_date)}</span>}
            </span>
          </div>
        );

      case "bill_to": {
        const billTo = order.bill_to;
        const shipTo = order.ship_to;
        return (
          <div key={block.id} style={{ padding: "11px 28px", borderBottom: `1px solid ${brand.line}`, breakInside: "avoid", display: "flex", gap: 24, flexWrap: "wrap" }}>
            {soldTo ? <PartyBlock title={billTo ? "Sold to" : "Sold to / Bill to"} party={soldTo} accent={accent} /> : <div style={{ color: "#8a96a5" }}>—</div>}
            {billTo && <PartyBlock title="Bill to" party={billTo} accent={accent} />}
            {shipTo && <PartyBlock title="Ship to" party={shipTo} accent={accent} />}
          </div>
        );
      }

      case "intro_text":
        if (!block.content?.trim()) return null;
        return <div key={block.id} style={{ margin: "12px 28px 0", color: "#3a4652", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", breakInside: "avoid" }}>{block.content}</div>;

      case "line_items":
        return (
          <table key={block.id}>
            <thead>
              <tr style={{ background: "#e6f1fb" }}>
                <th style={{ padding: "7px 12px 7px 28px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600, width: 32 }}>#</th>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Description</th>
                <th style={{ padding: "7px 12px", textAlign: "center", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>UOM</th>
                <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Qty</th>
                <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>{moneyLabel("Unit price", cur)}</th>
                {showDiscountCol && <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Disc.</th>}
                {showTaxCol && <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Tax</th>}
                <th style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>{moneyLabel("Amount", cur)}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff", breakInside: "avoid" }}>
                  <td style={{ padding: "7px 12px 7px 28px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{i + 1}</td>
                  <td style={{ padding: "7px 12px", fontSize: 12.5 }}>
                    {l.description}
                    {l.printed_text && <div style={{ marginTop: 3, fontSize: 11.5, color: "#5f6b7a", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{l.printed_text}</div>}
                  </td>
                  <td style={{ padding: "7px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{l.uom ?? ""}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{Number(l.qty)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{money(Number(l.unit_price))}</td>
                  {showDiscountCol && <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{Number(l.discount_pct) > 0 ? `${Number(l.discount_pct)}%` : ""}</td>}
                  {showTaxCol && <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{Number(l.tax_pct) > 0 ? `${Number(l.tax_pct)}%` : ""}</td>}
                  <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{money(Number(l.line_total))}</td>
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
                {showBreakdown && (
                  <>
                    <TotalsRow label="Subtotal" value={money(Number(order.subtotal))} />
                    {order.discount_total > 0 && <TotalsRow label="Discount" value={`− ${money(Number(order.discount_total))}`} />}
                    {order.tax_total > 0 && <TotalsRow label="Tax" value={money(Number(order.tax_total))} />}
                    {order.shipping_amount > 0 && <TotalsRow label="Shipping / Handling" value={money(Number(order.shipping_amount))} />}
                  </>
                )}
                <tr>
                  <td colSpan={2} style={{ paddingTop: 6 }}>
                    <div style={{ background: brand.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>{money(Number(order.total))}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );

      case "notes":
        if (!order.notes) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${accent}`, breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Notes</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{order.notes}</div>
          </div>
        );

      case "terms":
        if (!order.terms) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.amber}`, breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Terms &amp; Conditions</SectionLabel>
            <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{order.terms}</div>
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
        return <div key={block.id} style={{ margin: "0 28px 12px", color: "#5f6b7a", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: "center", breakInside: "avoid" }}>{block.content}</div>;

      case "specs_table": {
        const specs = parseSpecs(block.content ?? "");
        if (specs.length === 0) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", breakInside: "avoid" }}>
            <SectionLabel accent={accent}>Specifications</SectionLabel>
            <table style={{ width: "100%" }}>
              <tbody>
                {specs.map((s, i) => (
                  <tr key={i} style={{ borderBottom: i < specs.length - 1 ? `1px solid ${brand.line}` : "none" }}>
                    <td style={{ padding: "5px 10px 5px 0", fontSize: 12, color: "#5f6b7a", width: "40%" }}>{s.label}</td>
                    {s.value && <td style={{ padding: "5px 0", fontSize: 12.5, color: brand.dark, fontWeight: 500 }}>{s.value}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case "cta_banner":
        if (!block.content?.trim()) return null;
        return <div key={block.id} style={{ margin: "0 28px 12px", background: accent, color: "#fff", borderRadius: 6, padding: "10px 16px", textAlign: "center", fontSize: 12.5, fontWeight: 600, breakInside: "avoid" }}>{block.content}</div>;

      default:
        return null;
    }
  }

  return (
    <div className="doc">
      {blocks.map(renderBlock)}
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
