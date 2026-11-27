import type { Account, Contact, DocSections, StandardQuote, StandardQuoteLine, StandardQuoteTemplateBlock } from "@/lib/types";
import { CURRENCIES, type CurrencyCode } from "@/lib/currency";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { documentTotal, selectedLines } from "@/lib/sales/lineTotals";
import { hasClientItemNumbers, itemNumber } from "@/lib/sales/lineItemNumbers";
import { linesForPdf, parsePrintOptions } from "@/lib/sales/printOptions";
import { boqTotalLabel, frontValue, resolveFramedBlocks } from "@/lib/pdf/framedQuote";

// The body of a quotation printed inside a page frame (PDF redesign, slice 1). The frame draws the letterhead, the title band
// and the footer, so this is only the document: front block, lettered clause sections, scope matrices, the bill of quantities
// and the closing. Pure of hooks, so it renders on the server for the print page and in the browser for the Settings preview.
// The styling lives in the frame's body stylesheet (.pf), never inline colours here.

type Props = {
  quote: StandardQuote;
  lines: StandardQuoteLine[];
  account: Account | null;
  contact: Contact | null;
  blocks: StandardQuoteTemplateBlock[];
  docSections: DocSections | null | undefined;
  currency: CurrencyCode;
  taxLabel?: string;
};

const pre = { whiteSpace: "pre-line" as const };
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 3 });

export default function StandardQuoteFramedBody({ quote, lines, account, contact, blocks, docSections, currency, taxLabel = "Tax" }: Props) {
  const cur = CURRENCIES[currency];
  const resolved = resolveFramedBlocks(blocks, docSections);
  const hasFront = resolved.some((r) => r.kind === "front");
  const src = { quote, account, contact };

  const subtotal = documentTotal(lines);
  const totals = computeStandardQuoteTotals(subtotal, quote.header_discount_pct, quote.tax_pct, quote.shipping_amount);
  const hasBreakdown = quote.header_discount_pct > 0 || quote.tax_pct > 0 || quote.shipping_amount > 0;
  const clientNumbers = hasClientItemNumbers(lines);
  const printLines = linesForPdf(lines, parsePrintOptions(quote.print_options));
  const chosenGroupIds = new Set(selectedLines(lines).filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id as string));
  const boq = resolved.some((r) => r.kind === "lines" && r.data.preset === "boq");

  return (
    <div className="pf" data-guide="framed-quote-body">
      {resolved.map((r) => {
        switch (r.kind) {
          case "front": {
            const rows = r.data.rows.map((row) => ({ row, v1: frontValue(row.field, src), v2: row.field2 ? frontValue(row.field2, src) : "" })).filter((x) => x.v1 || x.v2);
            return (
              <div key={r.block.id}>
                {rows.map(({ row, v1, v2 }, i) => (
                  <div key={i} className="kv">
                    <span><b>{row.label}:</b> <span dir="auto">{v1}</span></span>
                    {row.field2 && v2 && <span style={{ marginInlineStart: "6mm" }}><b>{row.label2}:</b> <span dir="auto">{v2}</span></span>}
                  </div>
                ))}
                {r.data.greeting && <p style={{ marginTop: "4mm" }}>{r.data.greeting}</p>}
                {r.data.opening && <p style={pre}>{r.data.opening}</p>}
              </div>
            );
          }
          case "section": {
            const { section } = r;
            return (
              <section key={section.block.id} style={section.data.page_break ? { breakBefore: "page" } : undefined}>
                <div className="band">{section.letter}. {section.data.title}</div>
                {section.items.map((it, i) => (
                  <div key={it.id}>
                    {it.heading && (it.band
                      ? <div className="subband">{it.heading}</div>
                      : <div className="ci-head">{section.data.numbered ? `${section.letter}${i + 1}. ` : ""}{it.heading}</div>)}
                    {it.text.trim() !== "" && (
                      <p style={pre} dir="auto">{section.data.numbered && !it.heading ? <b>{section.letter}{i + 1}. </b> : null}{it.text}</p>
                    )}
                    {it.sub.map((t, j) => <p key={j} style={pre} dir="auto">{t}</p>)}
                  </div>
                ))}
              </section>
            );
          }
          case "matrix": {
            const { matrix } = r;
            const cols = matrix.data.columns;
            if (!matrix.applicable) {
              return <div key={matrix.block.id} className="subband">{matrix.number} {matrix.data.title}: {matrix.reason}</div>;
            }
            return (
              <div key={matrix.block.id} style={{ marginTop: "3mm" }}>
                <table>
                  <thead>
                    <tr><th colSpan={matrix.data.remark ? 5 : 4} className="mxt">{matrix.number} {matrix.data.title}</th></tr>
                    <tr className="th">
                      <th className="th" style={{ width: matrix.data.remark ? "51%" : "70%", textAlign: "left" }}>DESCRIPTION</th>
                      <th className="th" style={{ width: "8%" }}>{cols[0]}</th>
                      <th className="th" style={{ width: "9%" }}>{cols[1]}</th>
                      <th className="th" style={{ width: "5%" }}>{cols[2]}</th>
                      {matrix.data.remark && <th className="th" style={{ width: "27%" }}>REMARK</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr key={row.id}>
                        <td dir="auto">{row.text}</td>
                        {[0, 1, 2].map((k) => <td key={k} className="ctr">{row.tick === k ? "●" : ""}</td>)}
                        {matrix.data.remark && <td dir="auto">{row.remark}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "lines": {
            const isBoq = r.data.preset === "boq";
            const label = boqTotalLabel(r.data.total_label, selectedLines(lines));
            return (
              <div key={r.block.id} style={{ marginTop: "2mm" }}>
                <table>
                  <thead>
                    <tr>
                      <th className="th" style={{ width: "5%" }}>{isBoq ? "SL" : clientNumbers ? "Item" : "Sl"}</th>
                      <th className="th" style={{ width: "50%", textAlign: "left" }}>{isBoq ? "DESCRIPTION" : "Description"}</th>
                      <th className="th" style={{ width: "7%" }}>{isBoq ? "UNIT" : "UOM"}</th>
                      <th className="th" style={{ width: "8%" }}>{isBoq ? "QTY" : "Qty"}</th>
                      <th className="th" style={{ width: "12%" }}>{isBoq ? "U/RATE" : "Rate"}</th>
                      <th className="th" style={{ width: "18%" }}>{isBoq ? `T/VALUE (${cur.code})` : `Amount (${cur.code})`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printLines.map((l, i) => {
                      const groupNotChosen = l.group_type === "alternative" && !!l.group_id && !chosenGroupIds.has(l.group_id);
                      return (
                        <tr key={l.id} style={{ opacity: groupNotChosen ? 0.55 : 1 }}>
                          <td className="ctr">{itemNumber(l, i + 1, clientNumbers)}</td>
                          <td dir="auto" style={pre}>
                            {l.group_type === "alternative" && <b>{l.group_label || "Option"}{groupNotChosen ? " (not selected)" : ""}: </b>}
                            {l.break_of ? <b>Option, qty {l.qty}: </b> : null}
                            {l.description}
                          </td>
                          <td className="ctr">{l.uom ?? ""}</td>
                          <td className="num">{qtyFmt(l.qty)}</td>
                          <td className="num">{money(l.rate)}</td>
                          <td className="num">{money(l.amount)}</td>
                        </tr>
                      );
                    })}
                    {isBoq && (
                      <tr style={{ breakBefore: "avoid" }}>
                        <td colSpan={5} style={{ fontWeight: 700, textTransform: "uppercase" }}>{label}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(hasBreakdown ? totals.total : subtotal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {r.data.note && <p style={{ marginTop: "2mm" }}>{r.data.note}</p>}
              </div>
            );
          }
          case "closing":
            return (
              <div key={r.block.id} className="closing">
                {r.data.text && <p style={pre}>{r.data.text}</p>}
                {r.data.regards && <p style={{ marginTop: "4mm", fontWeight: 700, textTransform: "uppercase" }}>{r.data.regards}</p>}
                {r.data.signatory_name && <p style={{ marginTop: "10mm", marginBottom: 0 }}>{r.data.signatory_name}</p>}
                {r.data.signatory_title && <p>{r.data.signatory_title}</p>}
              </div>
            );
          case "plain": {
            const b = r.block;
            switch (b.type) {
              case "bill_to":
                if (hasFront) return null;
                return account ? <div key={b.id} className="kv"><span><b>Quote for:</b> <span dir="auto">{account.name}</span></span></div> : null;
              case "intro_text": {
                const t = quote.intro_text?.trim() || b.content?.trim();
                return t ? <p key={b.id} style={pre}>{t}</p> : null;
              }
              case "totals":
                if (!hasBreakdown && boq) return null;
                return (
                  <table key={b.id} style={{ width: "70mm", marginLeft: "auto", marginTop: "3mm" }}>
                    <tbody>
                      {hasBreakdown && <tr><td>Subtotal</td><td className="num">{money(totals.subtotal)}</td></tr>}
                      {quote.header_discount_pct > 0 && <tr><td>Discount ({quote.header_discount_pct}%)</td><td className="num">- {money(totals.discountAmount)}</td></tr>}
                      {quote.tax_pct > 0 && <tr><td>{taxLabel} ({quote.tax_pct}%)</td><td className="num">{money(totals.taxAmount)}</td></tr>}
                      {quote.shipping_amount > 0 && <tr><td>Shipping / Handling</td><td className="num">{money(totals.shipping)}</td></tr>}
                      <tr><td><b>Total ({cur.code})</b></td><td className="num"><b>{money(totals.total)}</b></td></tr>
                    </tbody>
                  </table>
                );
              case "notes":
                return quote.notes ? <div key={b.id}><div className="ci-head">Notes</div><p style={pre}>{quote.notes}</p></div> : null;
              case "terms":
                return quote.terms ? <div key={b.id}><div className="ci-head">Terms &amp; Conditions</div><p style={pre}>{quote.terms}</p></div> : null;
              case "footer_text":
                return b.content?.trim() ? <p key={b.id} style={pre}>{b.content}</p> : null;
              case "cta_banner":
                return b.content?.trim() ? <p key={b.id}><b>{b.content}</b></p> : null;
              case "specs_table": {
                const rows = (b.content ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
                return rows.length ? <div key={b.id}>{rows.map((x, i) => <div key={i} className="kv">{x}</div>)}</div> : null;
              }
              case "signature":
                return <div key={b.id} className="closing"><p style={{ marginTop: "12mm" }}>Authorized Signatory</p></div>;
              default:
                return null;
            }
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
