import type { StandardQuoteTemplateBlock, StandardQuoteTemplateBlockType } from "@/lib/types";
import { CURRENCIES, moneyLabel } from "@/lib/currency";
import { defaultStandardQuoteBlocks, HEX_COLOR_RE } from "@/lib/standardQuoteTemplateBlocks";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { documentTotal, selectedLines } from "@/lib/sales/lineTotals";
import { hasClientItemNumbers, itemNumber } from "@/lib/sales/lineItemNumbers";
import { linesForPdf, parsePrintOptions } from "@/lib/sales/printOptions";
import type { StandardQuotePrintDocumentProps } from "./StandardQuotePrintDocument";
import type { QuotePrintDefaults } from "@/extensions/types";

// The modern Standard Quote layout. Same data, same block list and the same totals arithmetic as the classic one
// (StandardQuotePrintDocument): only the look differs. A workspace gets it through its extension.

const DEFAULT_ACCENT = "#378ADD";

export const MODERN_QUOTE_CSS = `
  @font-face { font-family: "QDisplay"; src: url("/fonts/poppins-latin-500.woff2") format("woff2"); font-weight: 500; font-display: block; }
  @font-face { font-family: "QDisplay"; src: url("/fonts/poppins-latin-600.woff2") format("woff2"); font-weight: 600; font-display: block; }
  @font-face { font-family: "QDisplay"; src: url("/fonts/poppins-latin-700.woff2") format("woff2"); font-weight: 700; font-display: block; }
  @font-face { font-family: "QText"; src: url("/fonts/arimo-latin-400.woff2") format("woff2"); font-weight: 400; font-display: block; }
  @font-face { font-family: "QText"; src: url("/fonts/arimo-latin-700.woff2") format("woff2"); font-weight: 700; font-display: block; }
  @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans.ttf") format("truetype"); font-weight: 400; font-display: block; }
  @font-face { font-family: "PrintSans"; src: url("/fonts/DejaVuSans-Bold.ttf") format("truetype"); font-weight: 700; font-display: block; }

  html, body { margin: 0; padding: 0; }
  body { background: #e9edf3; font-family: "QText", "PrintSans", Arial, sans-serif; font-size: 12px; line-height: 1.45; color: #101a2b; }
  .qm { --ink: #0d1b2e; --muted: #67748a; --line: #e4e9f1; --soft: #f5f7fb; box-sizing: border-box; background: #fff; width: 210mm; max-width: 100%; min-height: 297mm; margin: 18px auto; padding: 12mm 15mm; box-shadow: 0 12px 40px rgba(13,27,46,.16); display: flex; flex-direction: column; }
  .qm * { box-sizing: border-box; }
  .qm-display { font-family: "QDisplay", "PrintSans", Arial, sans-serif; }

  .qm-hero { position: relative; overflow: hidden; border-radius: 14px; background: linear-gradient(118deg, #0d1b2e 0%, #12294a 62%, #16365f 100%); color: #fff; padding: 20px 24px 22px; break-inside: avoid; }
  .qm-hero::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--accent); }
  .qm-ring { position: absolute; border-radius: 50%; border: 26px solid var(--accent); opacity: .14; width: 190px; height: 190px; right: -52px; top: -96px; }
  .qm-hero-row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .qm-hero-row.right { flex-direction: row-reverse; }
  .qm-hero-row.center { flex-direction: column; text-align: center; }
  .qm-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .qm-plate { background: #fff; border-radius: 10px; padding: 8px 12px; display: flex; align-items: center; justify-content: center; min-height: 50px; }
  .qm-plate img { height: 34px; max-width: 150px; object-fit: contain; display: block; }
  .qm-mono { width: 52px; height: 52px; border-radius: 12px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
  .qm-co { font-size: 19px; font-weight: 700; letter-spacing: .3px; line-height: 1.2; }
  .qm-tag { font-size: 11px; color: #b9c7dc; margin-top: 2px; }
  .qm-title { text-align: right; flex-shrink: 0; }
  .qm-hero-row.right .qm-title { text-align: left; }
  .qm-hero-row.center .qm-title { text-align: center; }
  .qm-word { font-size: 26px; font-weight: 600; letter-spacing: 5px; text-transform: uppercase; line-height: 1.1; }
  .qm-ref { margin-top: 6px; font-size: 12px; font-weight: 500; letter-spacing: 1px; color: #cfdaec; }
  .qm-contact { position: relative; display: flex; gap: 18px; flex-wrap: wrap; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.16); font-size: 10.5px; color: #b9c7dc; }

  .qm-label { font-family: "QDisplay", "PrintSans", Arial, sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 1.6px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .qm-overview { display: flex; gap: 12px; margin-top: 16px; align-items: stretch; break-inside: avoid; }
  .qm-card { border: 1px solid var(--line); border-radius: 12px; padding: 13px 16px; flex: 1 1 0; min-width: 0; }
  .qm-card.soft { background: var(--soft); border-color: var(--soft); }
  .qm-client { font-size: 14.5px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
  .qm-sub { color: var(--muted); font-size: 11px; margin-top: 2px; overflow-wrap: anywhere; }
  .qm-attn { margin-top: 8px; font-size: 11px; }
  .qm-facts { display: grid; grid-template-columns: auto 1fr; gap: 5px 14px; font-size: 11px; }
  .qm-facts dt { color: var(--muted); margin: 0; white-space: nowrap; }
  .qm-facts dd { margin: 0; font-weight: 700; text-align: right; }
  .qm-amount-card { flex: 0 0 31%; border-radius: 12px; padding: 13px 16px; background: var(--ink); color: #fff; display: flex; flex-direction: column; justify-content: center; border-left: 5px solid var(--accent); }
  .qm-amount-card .qm-label { color: #9fb2cf; }
  .qm-amount-cur { font-size: 11px; font-weight: 500; color: #cfdaec; letter-spacing: 1px; }
  .qm-amount { font-size: 25px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .qm-amount-note { font-size: 10px; color: #9fb2cf; margin-top: 2px; }

  .qm-intro { margin-top: 16px; color: #33415a; font-size: 12px; line-height: 1.65; white-space: pre-wrap; }

  .qm-items { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 18px; }
  .qm-items thead { display: table-header-group; }
  .qm-items th { font-family: "QDisplay", "PrintSans", Arial, sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 1.3px; text-transform: uppercase; color: var(--ink); text-align: left; padding: 9px 10px; background: var(--soft); border-bottom: 1.5px solid var(--ink); white-space: nowrap; }
  .qm-items th:first-child { border-top-left-radius: 8px; }
  .qm-items th:last-child { border-top-right-radius: 8px; }
  .qm-items td { padding: 11px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .qm-items tr { break-inside: avoid; }
  .qm-items .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .qm-items .c { text-align: center; white-space: nowrap; }
  .qm-no { color: var(--accent); font-weight: 700; font-size: 11px; white-space: nowrap; width: 1%; }
  .qm-desc { font-size: 12.5px; overflow-wrap: anywhere; }
  .qm-quiet { color: var(--muted); }
  .qm-strong { font-weight: 700; font-size: 12.5px; }
  .qm-option { display: block; font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--accent); margin-bottom: 2px; }
  .qm-off .qm-option { color: var(--muted); }
  .qm-off td { opacity: .5; }

  .qm-totals { display: flex; justify-content: flex-end; margin-top: 12px; break-inside: avoid; }
  .qm-totals-box { width: 290px; max-width: 100%; }
  .qm-total-row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 14px; color: var(--muted); font-size: 11.5px; }
  .qm-total-row span:last-child { color: var(--ink); font-variant-numeric: tabular-nums; }
  .qm-grand { margin-top: 8px; border-radius: 10px; background: var(--ink); color: #fff; padding: 11px 14px; display: flex; justify-content: space-between; align-items: center; gap: 14px; border-bottom: 4px solid var(--accent); }
  .qm-grand-label { font-size: 10px; font-weight: 600; letter-spacing: 1.8px; text-transform: uppercase; }
  .qm-grand-value { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .qm-section { margin-top: 18px; break-inside: avoid; }
  .qm-text { color: #33415a; font-size: 11.5px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .qm-panel { border-left: 3px solid var(--accent); background: var(--soft); border-radius: 0 10px 10px 0; padding: 11px 14px; }
  .qm-specs { width: 100%; border-collapse: collapse; }
  .qm-specs td { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 11.5px; vertical-align: top; }
  .qm-specs td:first-child { color: var(--muted); width: 38%; padding-right: 12px; }

  .qm-sign { display: flex; gap: 14px; margin-top: 22px; break-inside: avoid; }
  .qm-sign-box { flex: 1 1 0; min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 13px 16px; }
  .qm-sign-line { border-bottom: 1px solid #9aa6b8; height: 38px; }
  .qm-sign-cap { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-top: 5px; }

  .qm-cta { margin-top: 18px; border-radius: 12px; background: var(--accent); color: #fff; padding: 13px 18px; text-align: center; font-weight: 700; font-size: 12.5px; white-space: pre-wrap; break-inside: avoid; }
  .qm-note { margin-top: 14px; text-align: center; color: var(--muted); font-size: 11px; white-space: pre-wrap; break-inside: avoid; }

  .qm-footer { margin-top: auto; padding-top: 22px; break-inside: avoid; }
  .qm-footer-bar { border-top: 1px solid var(--line); padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; font-size: 10px; color: var(--muted); }
  .qm-footer-co { color: var(--ink); font-weight: 700; font-size: 11px; }
  .qm-footer-ref { white-space: nowrap; }
  .qm-stripe { height: 4px; border-radius: 4px; margin-top: 10px; background: linear-gradient(90deg, var(--ink) 0 72%, var(--accent) 72% 100%); }

  @media screen and (max-width: 720px) {
    .qm { margin: 0; padding: 14px; min-height: 0; box-shadow: none; }
    .qm-hero-row, .qm-hero-row.right { flex-direction: column; align-items: flex-start; }
    .qm-title, .qm-hero-row.right .qm-title { text-align: left; }
    .qm-overview, .qm-sign { flex-direction: column; }
    .qm-amount-card { flex-basis: auto; }
    .qm-items th, .qm-items td { padding: 8px 5px; font-size: 11px; }
    .qm-uom { display: none; }
    .qm-word { font-size: 20px; letter-spacing: 3px; }
  }
  @media print {
    @page { size: A4 portrait; margin: 12mm 15mm; }
    html, body { background: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .qm { width: auto; margin: 0; padding: 0 .4mm; box-shadow: none; min-height: 270mm; }
    .no-print { display: none !important; }
  }
`;

export type StandardQuoteModernDocumentProps = StandardQuotePrintDocumentProps & { /** The workspace's brand colour, used when the template has none. */ brandColor?: string | null;
  /** Used only where the quote has no template of its own. */
  defaults?: QuotePrintDefaults;
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

const bareWeb = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

const parseSpecs = (content: string) =>
  content.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return i === -1 ? { label: line, value: "" } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  });

export default function StandardQuoteModernDocument({
  quote, lines, account, contact, companyInfo = {}, logoUrl, template, currency = "INR", taxLabel = "Tax", brandColor, defaults,
}: StandardQuoteModernDocumentProps) {
  const cur = CURRENCIES[currency];
  const whole = new Intl.NumberFormat(cur.locale, { maximumFractionDigits: 0 });
  const rateFmt = new Intl.NumberFormat(cur.locale, { maximumFractionDigits: 2 });
  const money = (n: number) => `${currency} ${whole.format(n)}`;

  const companyName = companyInfo.name ?? "";
  const logo = companyInfo.logo_url ?? logoUrl ?? null;
  const accent = [template?.accent_color, defaults?.accent, brandColor].find((c): c is string => !!c && HEX_COLOR_RE.test(c)) ?? DEFAULT_ACCENT;
  const logoPosition = template?.logo_position ?? "left";
  const standardBlocks = () => defaultStandardQuoteBlocks().map((b) => {
    if (b.type === "intro_text" && defaults?.intro) return { ...b, visible: true, content: defaults.intro };
    if (b.type === "signature" && defaults?.signature) return { ...b, visible: true };
    return b;
  });
  const blocks = (template?.blocks?.length ? template.blocks : standardBlocks()).filter((b) => b.visible);

  const totals = computeStandardQuoteTotals(documentTotal(lines), quote.header_discount_pct, quote.tax_pct, quote.shipping_amount);
  const hasBreakdown = quote.header_discount_pct > 0 || quote.tax_pct > 0 || quote.shipping_amount > 0;
  const clientNumbers = hasClientItemNumbers(lines);
  const printLines = linesForPdf(lines, parsePrintOptions(quote.print_options));
  const chosenGroupIds = new Set(selectedLines(lines).filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id as string));

  const showsTotals = blocks.some((b) => b.type === "totals");
  // "Quote for" and the quote's facts sit side by side, wherever the first of the two is in the layout.
  const overviewTypes: StandardQuoteTemplateBlockType[] = ["quote_meta", "bill_to"];
  const overviewAt = blocks.findIndex((b) => overviewTypes.includes(b.type));
  const hasClient = blocks.some((b) => b.type === "bill_to");
  const hasMeta = blocks.some((b) => b.type === "quote_meta");

  const overview = (key: string) => (
    <div key={key} className="qm-overview">
      {hasClient && (
        <div className="qm-card soft">
          <div className="qm-label">Prepared for</div>
          {account ? (
            <>
              <div className="qm-client qm-display">{account.name}</div>
              {account.city && <div className="qm-sub">{account.city}</div>}
              {account.phone && <div className="qm-sub">{account.phone}</div>}
              {account.email && <div className="qm-sub">{account.email}</div>}
              {contact && <div className="qm-attn">Attn: <strong>{contact.name}</strong></div>}
            </>
          ) : <div className="qm-sub">—</div>}
        </div>
      )}
      {hasMeta && (
        <div className="qm-card">
          <div className="qm-label">Quote details</div>
          <dl className="qm-facts">
            <dt>Quote No</dt><dd>{quote.ref}</dd>
            <dt>Date</dt><dd>{fmtDate(quote.created_at)}</dd>
            {quote.valid_until && (<><dt>Valid until</dt><dd>{fmtDate(quote.valid_until)}</dd></>)}
            {quote.inquiry_date && (<><dt>Your inquiry</dt><dd>{fmtDate(quote.inquiry_date)}</dd></>)}
          </dl>
        </div>
      )}
      {showsTotals && (
        <div className="qm-amount-card">
          <div className="qm-label">Quote total</div>
          <div className="qm-amount-cur qm-display">{currency}</div>
          <div className="qm-amount qm-display">{whole.format(totals.total)}</div>
          {quote.tax_pct > 0 && <div className="qm-amount-note">Including {taxLabel} {quote.tax_pct}%</div>}
        </div>
      )}
    </div>
  );

  const hasLetterhead = blocks.some((b) => b.type === "letterhead");

  function render(block: StandardQuoteTemplateBlock, index: number) {
    if (overviewTypes.includes(block.type)) return index === overviewAt ? overview(block.id) : null;
    switch (block.type) {
      case "letterhead": {
        const emails = [companyInfo.email, companyInfo.email2].filter(Boolean).join("  |  ");
        return (
          <div key={block.id} className="qm-hero">
            <div className="qm-ring" />
            <div className={`qm-hero-row${logoPosition === "left" ? "" : ` ${logoPosition}`}`}>
              <div className="qm-brand">
                {logo
                  ? <div className="qm-plate"><img src={logo} alt={companyName} /></div>
                  : <div className="qm-mono qm-display">{initials(companyName || "?")}</div>}
                {(!logo || companyInfo.tagline) && (
                  <div>
                    {!logo && <div className="qm-co qm-display">{companyName}</div>}
                    {companyInfo.tagline && <div className="qm-tag">{companyInfo.tagline}</div>}
                  </div>
                )}
              </div>
              <div className="qm-title">
                <div className="qm-word qm-display">Quotation</div>
                <div className="qm-ref qm-display">{quote.ref}</div>
              </div>
            </div>
            {(emails || companyInfo.web) && (
              <div className="qm-contact">
                {companyInfo.web && <span>{bareWeb(companyInfo.web)}</span>}
                {emails && <span>{emails}</span>}
              </div>
            )}
          </div>
        );
      }

      case "intro_text": {
        const text = quote.intro_text?.trim() || block.content?.trim();
        return text ? <div key={block.id} className="qm-intro">{text}</div> : null;
      }

      case "line_items":
        return (
          <table key={block.id} className="qm-items">
            <thead>
              <tr>
                <th>{clientNumbers ? "Item" : "#"}</th>
                <th>Description</th>
                <th className="c qm-uom">UOM</th>
                <th className="r">Qty</th>
                <th className="r">{moneyLabel("Rate", cur)}</th>
                <th className="r">{moneyLabel("Amount", cur)}</th>
              </tr>
            </thead>
            <tbody>
              {printLines.map((l, i) => {
                const groupNotChosen = l.group_type === "alternative" && !!l.group_id && !chosenGroupIds.has(l.group_id);
                return (
                  <tr key={l.id} className={groupNotChosen ? "qm-off" : undefined}>
                    <td className="qm-no">{clientNumbers ? itemNumber(l, i + 1, true) : String(i + 1).padStart(2, "0")}</td>
                    <td className="qm-desc">
                      {l.group_type === "alternative" && <span className="qm-option">{l.group_label || "Option"}{groupNotChosen ? " — not selected" : ""}</span>}
                      {!!l.break_of && <span className="qm-option">Option — qty {l.qty}</span>}
                      {l.description}
                    </td>
                    <td className="c qm-quiet qm-uom">{l.uom ?? ""}</td>
                    <td className="r qm-quiet">{l.qty}</td>
                    <td className="r qm-quiet">{rateFmt.format(l.rate)}</td>
                    <td className="r qm-strong">{whole.format(l.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );

      case "totals":
        return (
          <div key={block.id} className="qm-totals">
            <div className="qm-totals-box">
              {hasBreakdown && (
                <>
                  <div className="qm-total-row"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
                  {quote.header_discount_pct > 0 && <div className="qm-total-row"><span>Discount ({quote.header_discount_pct}%)</span><span>− {money(totals.discountAmount)}</span></div>}
                  {quote.tax_pct > 0 && <div className="qm-total-row"><span>{taxLabel} ({quote.tax_pct}%)</span><span>{money(totals.taxAmount)}</span></div>}
                  {quote.shipping_amount > 0 && <div className="qm-total-row"><span>Shipping / Handling</span><span>{money(totals.shipping)}</span></div>}
                </>
              )}
              <div className="qm-grand qm-display">
                <span className="qm-grand-label">Total</span>
                <span className="qm-grand-value">{money(totals.total)}</span>
              </div>
            </div>
          </div>
        );

      case "notes":
      case "terms": {
        const text = block.type === "notes" ? quote.notes : quote.terms;
        if (!text) return null;
        return (
          <div key={block.id} className="qm-section qm-panel">
            <div className="qm-label">{block.type === "notes" ? "Notes" : "Terms & Conditions"}</div>
            <div className="qm-text">{text}</div>
          </div>
        );
      }

      case "specs_table": {
        const specs = parseSpecs(block.content ?? "");
        if (specs.length === 0) return null;
        return (
          <div key={block.id} className="qm-section">
            <div className="qm-label">Specifications</div>
            <table className="qm-specs">
              <tbody>
                {specs.map((s, i) => <tr key={i}><td>{s.label}</td><td>{s.value}</td></tr>)}
              </tbody>
            </table>
          </div>
        );
      }

      case "signature":
        return (
          <div key={block.id} className="qm-sign">
            <div className="qm-sign-box">
              <div className="qm-label">For {companyName}</div>
              <div className="qm-sign-line" />
              <div className="qm-sign-cap"><span>Authorized Signatory</span><span>Date</span></div>
            </div>
            <div className="qm-sign-box">
              <div className="qm-label">Accepted by{account ? ` ${account.name}` : ""}</div>
              <div className="qm-sign-line" />
              <div className="qm-sign-cap"><span>Name and signature</span><span>Date</span></div>
            </div>
          </div>
        );

      case "cta_banner":
        return block.content?.trim() ? <div key={block.id} className="qm-cta">{block.content}</div> : null;

      case "footer_text":
        return block.content?.trim() ? <div key={block.id} className="qm-note">{block.content}</div> : null;

      default:
        return null;
    }
  }

  return (
    <div className="qm" style={{ ["--accent" as string]: accent }}>
      {blocks.map(render)}
      <div className="qm-footer">
        <div className="qm-footer-bar">
          <div>
            <div className="qm-footer-co">{companyName}</div>
            {companyInfo.address && <div>{companyInfo.address}</div>}
            {!hasLetterhead && (companyInfo.web || companyInfo.email) && <div>{[companyInfo.web && bareWeb(companyInfo.web), companyInfo.email].filter(Boolean).join("  ·  ")}</div>}
          </div>
          <div className="qm-footer-ref">Quotation {quote.ref}</div>
        </div>
        <div className="qm-stripe" />
      </div>
    </div>
  );
}
