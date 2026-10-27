import type { StandardQuoteTemplateBlock, StandardQuoteTemplateBlockType } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import type { SalesOrder, SalesOrderLine } from "@/lib/salesOrders/types";
import { Mail, Globe, MapPin } from "@/components/Icons";
import { CURRENCIES, moneyFormatter, moneyLabel, type CurrencyCode } from "@/lib/currency";
import { defaultStandardQuoteBlocks, STANDARD_QUOTE_BLOCK_TYPES } from "@/lib/standardQuoteTemplateBlocks";
import { fmtDate } from "./logic";

export type PrintTemplate = { blocks: unknown[]; accent_color?: string | null; logo_position?: "left" | "center" | "right" } | null;
export type PrintParty = { name: string; city?: string | null; phone?: string | null; email?: string | null; address?: string | null };

export type SalesOrderPrintDocumentProps = {
  order: SalesOrder;
  lines: SalesOrderLine[];
  account: PrintParty | null;
  contact: { name: string } | null;
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  /** The order TYPE's template (blocks, accent colour, logo position): the same mechanism as Standard Quote templates. */
  template?: PrintTemplate;
  currency?: CurrencyCode;
};

// Paper is white in every colour mode, so the printed document keeps its own palette (as the quote and invoice
// documents do); the screens use theme variables only.
const PAPER = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9", ink: "#1c2733", muted: "#5f6b7a", hint: "#8a96a5" };

/** The template's blocks, with anything that is not a known block type dropped; empty = the default layout. */
export function printBlocks(template: PrintTemplate | undefined): StandardQuoteTemplateBlock[] {
  const raw = Array.isArray(template?.blocks) ? template.blocks : [];
  const blocks = raw.flatMap((b, i): StandardQuoteTemplateBlock[] => {
    const r = b as { id?: unknown; type?: unknown; visible?: unknown; content?: unknown };
    if (typeof r?.type !== "string" || !STANDARD_QUOTE_BLOCK_TYPES.has(r.type)) return [];
    return [{ id: typeof r.id === "string" ? r.id : `${r.type}-${i}`, type: r.type as StandardQuoteTemplateBlockType, visible: r.visible !== false, content: typeof r.content === "string" ? r.content : undefined }];
  });
  return blocks.length > 0 ? blocks : defaultStandardQuoteBlocks();
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Label({ children, accent }: { children: React.ReactNode; accent: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{children}</div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: "2px 0", fontSize: 12, color: PAPER.muted }}>{label}</td>
      <td style={{ padding: "2px 0", fontSize: 12, color: PAPER.muted, textAlign: "right" }}>{value}</td>
    </tr>
  );
}
const parseSpecs = (content: string) =>
  content.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return i === -1 ? { label: line, value: "" } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  });

/**
 * The order on paper. The layout is the order TYPE's block list (letterhead, order number, customer, lines, totals,
 * notes, terms, ...); every line prints its "printed text" under the line. Renders under the bare (print) layout and in
 * the Order types preview alike, so the currency is a prop, not a hook.
 */
export default function SalesOrderPrintDocument({ order, lines, account, contact, companyInfo = {}, logoUrl, template, currency = "INR" }: SalesOrderPrintDocumentProps) {
  const cur = CURRENCIES[currency];
  const money = moneyFormatter(cur, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const co = {
    name: companyInfo.name ?? "", tagline: companyInfo.tagline ?? "", address: companyInfo.address ?? "", email: companyInfo.email ?? "",
    email2: companyInfo.email2 ?? "", web: companyInfo.web ?? "", logo_url: companyInfo.logo_url ?? logoUrl ?? null, logo_bg: companyInfo.logo_bg ?? PAPER.blue,
  };
  const accent = template?.accent_color || PAPER.blue;
  const logoPosition = template?.logo_position ?? "left";
  const blocks = printBlocks(template);
  const ship = order.ship_to;
  const bill = order.bill_to;

  const logoBlock = co.logo_url ? (
    <img src={co.logo_url} alt={co.name} style={{ height: 60, maxWidth: 80, objectFit: "contain", flexShrink: 0 }} />
  ) : (
    <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, background: co.logo_bg || PAPER.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff" }}>
      {initials(co.name || "?")}
    </div>
  );
  const nameBlock = (
    <div style={{ textAlign: logoPosition === "center" ? "center" : logoPosition === "right" ? "right" : "left" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: PAPER.dark, letterSpacing: 0.4, lineHeight: 1.15 }}>{co.name}</div>
      {co.tagline && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 3 }}>{co.tagline}</div>}
    </div>
  );
  const titleBlock = <div style={{ fontSize: 17, fontWeight: 800, color: PAPER.dark, letterSpacing: 2, textTransform: "uppercase" }}>Sales Order</div>;

  function renderBlock(block: StandardQuoteTemplateBlock) {
    if (!block.visible) return null;
    switch (block.type) {
      case "letterhead":
        return (
          <div key={block.id} style={{ background: "#fff", borderBottom: `2px solid ${PAPER.dark}`, breakInside: "avoid" }}>
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
              {(co.email || co.email2) && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={10} color="#888" />{co.email}{co.email2 ? <span style={{ color: "#888" }}> | {co.email2}</span> : ""}</span>}
              {co.web && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Globe size={10} color="#888" /> {co.web}</span>}
            </div>
          </div>
        );

      case "quote_meta":
        return (
          <div key={block.id} style={{ padding: "7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: `1px solid ${PAPER.line}`, background: "#fff", breakInside: "avoid" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              Order No: <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{order.ref}</span>
              {order.customer_po && <span style={{ marginLeft: 24, fontWeight: 400, color: PAPER.muted }}>Your PO: {order.customer_po}</span>}
            </span>
            <span style={{ fontSize: 12.5 }}>
              Date: <strong>{fmtDate(order.created_at)}</strong>
              {order.requested_date && <span style={{ marginLeft: 24, color: PAPER.muted }}>Requested: {fmtDate(order.requested_date)}</span>}
            </span>
          </div>
        );

      case "bill_to":
        return (
          <div key={block.id} style={{ padding: "11px 28px", borderBottom: `1px solid ${PAPER.line}`, breakInside: "avoid", display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div style={{ minWidth: 200, flex: 1 }}>
              <Label accent={accent}>{bill ? "Sold to" : "Customer"}</Label>
              {account ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{account.name}</div>
                  {(account.address || account.city) && <div style={{ color: PAPER.muted, marginTop: 2, whiteSpace: "pre-wrap" }}>{account.address || account.city}</div>}
                  {account.phone && <div style={{ color: PAPER.muted, fontSize: 12 }}>{account.phone}</div>}
                  {account.email && <div style={{ color: PAPER.muted, fontSize: 12 }}>{account.email}</div>}
                  {contact && <div style={{ color: PAPER.muted, fontSize: 12, marginTop: 4 }}>Attn: {contact.name}</div>}
                </>
              ) : <div style={{ color: PAPER.hint }}>—</div>}
            </div>
            {bill && (
              <div style={{ minWidth: 200, flex: 1 }}>
                <Label accent={accent}>Bill to</Label>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{bill.name}</div>
                {bill.address && <div style={{ color: PAPER.muted, marginTop: 2, whiteSpace: "pre-wrap" }}>{bill.address}</div>}
              </div>
            )}
            {ship && (
              <div style={{ minWidth: 200, flex: 1 }}>
                <Label accent={accent}>Ship to</Label>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ship.name}</div>
                {ship.address && <div style={{ color: PAPER.muted, marginTop: 2, whiteSpace: "pre-wrap" }}>{ship.address}</div>}
              </div>
            )}
          </div>
        );

      case "intro_text": {
        const text = block.content?.trim();
        if (!text) return null;
        return <div key={block.id} style={{ margin: "12px 28px 0", color: "#3a4652", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", breakInside: "avoid" }}>{text}</div>;
      }

      case "line_items": {
        const anyDiscount = lines.some((l) => l.discount_pct > 0);
        const th = { padding: "7px 12px", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" as const };
        return (
          <table key={block.id}>
            <thead>
              <tr style={{ background: "#e6f1fb" }}>
                <th style={{ ...th, padding: "7px 12px 7px 28px", textAlign: "left", width: 32 }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Description</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>{moneyLabel("Rate", cur)}</th>
                {anyDiscount && <th style={{ ...th, textAlign: "right" }}>Disc %</th>}
                <th style={{ ...th, padding: "7px 28px 7px 12px", textAlign: "right" }}>{moneyLabel("Amount", cur)}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff", breakInside: "avoid" }}>
                  <td style={{ padding: "7px 12px 7px 28px", color: PAPER.hint, fontSize: 11, fontFamily: "monospace" }}>{i + 1}</td>
                  <td style={{ padding: "7px 12px", fontSize: 12.5 }}>
                    {l.description}
                    {l.printed_text && <div style={{ marginTop: 3, fontSize: 11.5, color: PAPER.muted, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{l.printed_text}</div>}
                  </td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: PAPER.muted, fontSize: 12, whiteSpace: "nowrap" }}>{l.qty}{l.uom ? ` ${l.uom}` : ""}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", color: PAPER.muted, fontSize: 12 }}>{l.unit_price.toLocaleString(cur.locale)}</td>
                  {anyDiscount && <td style={{ padding: "7px 12px", textAlign: "right", color: PAPER.muted, fontSize: 12 }}>{l.discount_pct > 0 ? l.discount_pct : ""}</td>}
                  <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{money(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case "totals": {
        const breakdown = order.discount_total > 0 || order.tax_total > 0 || order.shipping_amount > 0;
        return (
          <div key={block.id} style={{ borderTop: `1px solid ${PAPER.line}`, padding: "9px 28px", display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
            <table style={{ width: 300 }}>
              <tbody>
                {breakdown && (
                  <>
                    <Row label="Subtotal" value={money(order.subtotal)} />
                    {order.discount_total > 0 && <Row label="Discount" value={`− ${money(order.discount_total)}`} />}
                    {order.tax_total > 0 && <Row label="Tax" value={money(order.tax_total)} />}
                    {order.shipping_amount > 0 && <Row label="Shipping / Handling" value={money(order.shipping_amount)} />}
                  </>
                )}
                <tr>
                  <td colSpan={2} style={{ paddingTop: 6 }}>
                    <div style={{ background: PAPER.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>{money(order.total)}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case "notes":
        if (!order.notes) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: PAPER.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${accent}`, breakInside: "avoid" }}>
            <Label accent={accent}>Notes</Label>
            <div style={{ color: PAPER.muted, fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{order.notes}</div>
          </div>
        );

      case "terms":
        if (!order.terms) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", background: PAPER.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${PAPER.amber}`, breakInside: "avoid" }}>
            <Label accent={accent}>Terms &amp; Conditions</Label>
            <div style={{ color: PAPER.muted, fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{order.terms}</div>
          </div>
        );

      case "signature":
        return (
          <div key={block.id} style={{ margin: "8px 28px 16px", display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
            <div style={{ width: 220, textAlign: "center" }}>
              <div style={{ borderBottom: `1px solid ${PAPER.hint}`, height: 40 }} />
              <div style={{ fontSize: 11, color: PAPER.muted, marginTop: 4 }}>Authorized Signatory</div>
            </div>
          </div>
        );

      case "footer_text":
        if (!block.content?.trim()) return null;
        return <div key={block.id} style={{ margin: "0 28px 12px", color: PAPER.muted, fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: "center", breakInside: "avoid" }}>{block.content}</div>;

      case "specs_table": {
        const specs = parseSpecs(block.content ?? "");
        if (specs.length === 0) return null;
        return (
          <div key={block.id} style={{ margin: "0 28px 12px", breakInside: "avoid" }}>
            <Label accent={accent}>Specifications</Label>
            <table style={{ width: "100%" }}>
              <tbody>
                {specs.map((sp, i) => (
                  <tr key={i} style={{ borderBottom: i < specs.length - 1 ? `1px solid ${PAPER.line}` : "none" }}>
                    <td style={{ padding: "5px 10px 5px 0", fontSize: 12, color: PAPER.muted, width: "40%" }}>{sp.label}</td>
                    {sp.value && <td style={{ padding: "5px 0", fontSize: 12.5, color: PAPER.dark, fontWeight: 500 }}>{sp.value}</td>}
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
    <div className="doc" data-doc="sales-order">
      {blocks.map(renderBlock)}
      <div style={{ background: PAPER.dark, borderTop: `2px solid ${co.logo_bg}`, breakInside: "avoid" }}>
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
