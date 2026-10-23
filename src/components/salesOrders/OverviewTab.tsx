import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import type { Attachment, OrderDetail } from "@/lib/salesOrders/client";
import { attention, attentionText, customerPoFact, expectedDelivery, fmtDate, partyBlocks, tagText, type PartyBlock } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

function Party({ label, block }: { label: string; block: PartyBlock }) {
  return (
    <div>
      <div className={s.partyLabel}>{label}</div>
      <div className={s.partyName}>{block.name}</div>
      {block.lines.map((l) => <div key={l} className={s.partyLine}>{l}</div>)}
    </div>
  );
}

/**
 * Overview is lean on purpose (owner, 2026-10-23): Sold to and Bill to (one block when they are the same), Ship to, and
 * three facts. No credit or price chips, no fulfilment bars. The only other thing that can appear is one banner, and
 * only when a line is short or will arrive after the date asked.
 */
export default function OverviewTab({ detail, attachments, currency, onSeeAvailability }: {
  detail: OrderDetail;
  attachments: Attachment[] | null;
  currency: string;
  onSeeAvailability: () => void;
}) {
  const { order, lines } = detail;
  const parties = partyBlocks(detail);
  const banner = attentionText(attention(lines));
  const expected = expectedDelivery(order, lines);
  const po = customerPoFact(order, attachments);

  return (
    <div className={s.overview} data-guide="sales_order.overview">
      {banner && (
        <div className={s.banner} role="status" data-guide="sales_order.attention">
          <span>{banner}</span>
          <button type="button" className={s.bannerLink} onClick={onSeeAvailability} data-guide="sales_order.attention_link">See availability</button>
        </div>
      )}

      <Card padding={16}>
        <div className={s.parties}>
          <Party label={parties.merged ? "Sold to and bill to" : "Sold to"} block={parties.soldTo} />
          {parties.billTo && <Party label="Bill to" block={parties.billTo} />}
          {parties.shipTo ? <Party label="Ship to" block={parties.shipTo} /> : null}
        </div>
      </Card>

      <div className={s.facts}>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_total">
            <div className={s.factLabel}>Total incl. VAT<InfoTip label="Total incl. VAT">{ORDER_TIPS.total}</InfoTip></div>
            <div className={s.factValue}>{fmtMoney(order.total, currency)}</div>
          </div>
        </Card>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_expected">
            <div className={s.factLabel}>Expected delivery<InfoTip label="Expected delivery">{ORDER_TIPS.expected}</InfoTip></div>
            <div className={s.factValue}>{expected.date ? fmtDate(expected.date) : "Not confirmed yet"}</div>
            {expected.date && expected.tag.kind !== "none" && (
              <div className={s.factSub}>
                <span className={`${s.tag} ${expected.tag.kind === "erp" ? s.tagErp : s.tagMaster}`}>{tagText(expected.tag)}</span>
              </div>
            )}
          </div>
        </Card>
        <Card padding={14}>
          <div className={s.fact} data-guide="sales_order.fact_po">
            <div className={s.factLabel}>Customer PO<InfoTip label="Customer PO">{ORDER_TIPS.customerPo}</InfoTip></div>
            <div className={s.factValue}>{po.number ?? "—"}</div>
            {po.files !== null && <div className={s.factSub}>{po.files === 0 ? "No files" : `${po.files} ${po.files === 1 ? "file" : "files"}`}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
